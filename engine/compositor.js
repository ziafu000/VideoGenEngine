const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync, execFileSync } = require('child_process');
const config = require('./config');

function getDuration(filePath) {
  try {
    const winPath = config.toWinPath(filePath);
    const out = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ${JSON.stringify(winPath)}`, { encoding: 'utf8' }).trim();
    return parseFloat(out);
  } catch {
    return 0.0;
  }
}

/**
 * Composite entire project: Video clips concat + Voiceover padding/concat + Ambient mixing + Subtitle burn
 */
async function compositeVideo({
  videoFiles,
  audioFiles,
  assSubtitlePath,
  subtitles_path,
  outputVideoPath,
  voiceVolume = 1.0,
  ambientVolume = 0.25,
  bgmPath = null,
  bgmVolume = 0.13,
  delays = [],
  aspectRatio = '16:9',
  burnSubtitles = true
}) {
  const tempDir = path.join(config.PROJECT_DIR, 'renders', 'temp_assemble');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // 0. MD5 duplicate check across audio files (Voice Doubling Prevention)
  const seenAudioHashes = new Map();
  for (let i = 0; i < audioFiles.length; i++) {
    const aFile = audioFiles[i];
    if (aFile && fs.existsSync(aFile)) {
      const hash = crypto.createHash('md5').update(fs.readFileSync(aFile)).digest('hex');
      if (seenAudioHashes.has(hash)) {
        const prevIdx = seenAudioHashes.get(hash);
        throw new Error(`PHÁT HIỆN LỖI LẶP VOICE (Voice Doubling): Phân cảnh ${i + 1} (${path.basename(aFile)}) trùng md5 100% với Phân cảnh ${prevIdx + 1}! MD5: ${hash}. Dừng quy trình xuất master.`);
      }
      seenAudioHashes.set(hash, i);
    }
  }

  const activeSubPath = subtitles_path !== undefined ? subtitles_path : assSubtitlePath;
  const effectiveBurnSubtitles = Boolean(burnSubtitles && activeSubPath && fs.existsSync(activeSubPath));

  console.log(`=== BẮT ĐẦU QUÁ TRÌNH GHÉP NỐI & HẬU KỲ (COMPOSITOR) ===`);
  console.log(`Số phân cảnh video: ${videoFiles.length}`);
  console.log(`Số file voiceover: ${audioFiles.length}`);
  console.log(`Tỷ lệ khung hình: ${aspectRatio} | Hardsub: ${effectiveBurnSubtitles ? 'BẬT' : 'TẮT (Clean Footage)'}`);

  // 1. Measure video durations & prepare audio padding
  const paddedAudioList = path.join(tempDir, 'audio_concat.txt');
  let audioConcatContent = '';
  const timelines = [];

  for (let i = 0; i < videoFiles.length; i++) {
    const vFile = videoFiles[i];
    const vDur = getDuration(vFile);
    const aFile = audioFiles[i];
    const paddedAudio = path.join(tempDir, `padded_${String(i + 1).padStart(2, '0')}.wav`);

    let aDur = 0;
    const delaySec = (delays && delays[i] !== undefined) ? delays[i] : 0.3;
    const delayMs = Math.round(delaySec * 1000);

    if (aFile && fs.existsSync(aFile)) {
      aDur = getDuration(aFile);
      const winAFile = config.toWinPath(aFile);
      const winPaddedAudio = config.toWinPath(paddedAudio);
      execFileSync('ffmpeg', ['-y', '-i', winAFile, '-af', `adelay=${delayMs}|${delayMs},apad=whole_dur=${vDur}`, '-ar', '44100', '-ac', '2', '-t', String(vDur), winPaddedAudio], { stdio: 'ignore' });
    } else {
      const winPaddedAudio = config.toWinPath(paddedAudio);
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', String(vDur), winPaddedAudio], { stdio: 'ignore' });
    }

    audioConcatContent += `file '${config.toWinPath(paddedAudio).replace(/\\/g, '/')}'\n`;
    timelines.push({
      shotIndex: i + 1,
      videoFile: vFile,
      duration: vDur,
      audioDuration: aDur
    });
  }

  fs.writeFileSync(paddedAudioList, audioConcatContent, 'utf8');

  // 2. Concatenate audio into master_voiceover.wav
  const masterVoice = path.join(tempDir, 'master_voice.wav');
  const winPaddedAudioList = config.toWinPath(paddedAudioList);
  const winMasterVoice = config.toWinPath(masterVoice);
  execSync(`ffmpeg -y -f concat -safe 0 -i ${JSON.stringify(winPaddedAudioList)} -c:a pcm_s16le ${JSON.stringify(winMasterVoice)} 2>/dev/null`);
  console.log(`[✓] Đã tạo master voice track: ${getDuration(masterVoice).toFixed(2)}s`);

  // 3. Concatenate video clips into raw_master.mp4
  const videoConcatList = path.join(tempDir, 'video_concat.txt');
  let videoConcatContent = '';
  for (const vf of videoFiles) {
    videoConcatContent += `file '${config.toWinPath(vf).replace(/\\/g, '/')}'\n`;
  }
  fs.writeFileSync(videoConcatList, videoConcatContent, 'utf8');

  const rawMaster = path.join(tempDir, 'raw_master.mp4');
  const winVideoConcatList = config.toWinPath(videoConcatList);
  const winRawMaster = config.toWinPath(rawMaster);
  console.log(`[-] Đang nối các clip video...`);
  execSync(`ffmpeg -y -f concat -safe 0 -i ${JSON.stringify(winVideoConcatList)} -c copy ${JSON.stringify(winRawMaster)} 2>/dev/null`);
  console.log(`[✓] Đã nối xong raw master video: ${getDuration(rawMaster).toFixed(2)}s`);

  // 4. Final Compositing: Audio mix (voice + ambient) + 1080p Lanczos upscale + Optional Subtitle burn
  console.log(`[-] Đang hòa âm đa tầng, upscale 1080p Full HD${burnSubtitles ? ' và burn phụ đề ASS' : ''}...`);
  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const hasVoiceTrack = audioFiles && audioFiles.some(f => f && fs.existsSync(f));
  const shouldBurnSubtitles = effectiveBurnSubtitles;
  const winAssSubtitlePath = shouldBurnSubtitles ? config.toWinPath(activeSubPath).replace(/\\/g, '/').replace(/:/g, '\\\\:') : '';
  const winOutputVideoPath = config.toWinPath(outputVideoPath);

  const isVertical = aspectRatio === '9:16';
  const scaleFilter = isVertical ? 'scale=1080:1920:flags=lanczos' : 'scale=1920:1080:flags=lanczos';
  const subFilter = shouldBurnSubtitles ? `,subtitles='${winAssSubtitlePath}'` : '';
  const videoFilter = `${scaleFilter}${subFilter}`;

  // Resolve BGM (Background Music)
  const defaultBgm = path.join(config.PROJECT_DIR, 'assets', 'bgm.mp3');
  const effectiveBgm = (bgmPath && fs.existsSync(bgmPath)) ? bgmPath : (fs.existsSync(defaultBgm) ? defaultBgm : null);
  const winBgm = effectiveBgm ? config.toWinPath(effectiveBgm) : null;
  const rawDur = getDuration(rawMaster);
  const fadeOutStart = Math.max(0, rawDur - 2.0).toFixed(2);

  let filterStr = '';
  let cmd = '';

  if (hasVoiceTrack && effectiveBgm) {
    console.log(`    [-] Hòa âm đa tầng 3 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX) + Voiceover ElevenLabs (${(voiceVolume * 100).toFixed(0)}% Lời thoại) + BGM (${(bgmVolume * 100).toFixed(0)}% Nhạc nền bí ẩn)...`);
    filterStr = `[0:v]${videoFilter}[v];[0:a]volume=${ambientVolume}[a_sfx];[1:a]volume=${voiceVolume}[a_voice];[2:a]volume=${bgmVolume},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=2[a_bgm];[a_sfx][a_voice][a_bgm]amix=inputs=3:duration=first:dropout_transition=2:normalize=0[a]`;
    cmd = `ffmpeg -y -i ${JSON.stringify(winRawMaster)} -i ${JSON.stringify(winMasterVoice)} -ss 8.5 -stream_loop -1 -i ${JSON.stringify(winBgm)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(winOutputVideoPath)}`;
  } else if (hasVoiceTrack && !effectiveBgm) {
    console.log(`    [-] Hòa âm đa tầng 2 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX) + Voiceover ElevenLabs (${(voiceVolume * 100).toFixed(0)}% Lời thoại)...`);
    filterStr = `[0:v]${videoFilter}[v];[0:a]volume=${ambientVolume}[a_sfx];[1:a]volume=${voiceVolume}[a_voice];[a_sfx][a_voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]`;
    cmd = `ffmpeg -y -i ${JSON.stringify(winRawMaster)} -i ${JSON.stringify(winMasterVoice)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(winOutputVideoPath)}`;
  } else if (!hasVoiceTrack && effectiveBgm) {
    console.log(`    [-] Hòa âm 2 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX) + BGM (${(bgmVolume * 100).toFixed(0)}% Nhạc nền)...`);
    filterStr = `[0:v]${videoFilter}[v];[0:a]volume=${ambientVolume}[a_sfx];[1:a]volume=${bgmVolume},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=2[a_bgm];[a_sfx][a_bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]`;
    cmd = `ffmpeg -y -i ${JSON.stringify(winRawMaster)} -ss 8.5 -stream_loop -1 -i ${JSON.stringify(winBgm)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(winOutputVideoPath)}`;
  } else {
    // 100% pure Flow SFX audio (No dialogue track, no BGM)
    console.log(`    [-] Sử dụng toàn bộ dải âm thanh SFX gốc từ Google Flow (Phim thuần SFX, không có thoại)...`);
    filterStr = `[0:v]${videoFilter}[v];[0:a]volume=1.0[a]`;
    cmd = `ffmpeg -y -i ${JSON.stringify(winRawMaster)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(winOutputVideoPath)}`;
  }

  execSync(`${cmd} 2>/dev/null`);

  const finalDur = getDuration(outputVideoPath);
  const finalSize = (fs.statSync(outputVideoPath).size / 1024 / 1024).toFixed(2);
  console.log(`\n============================================================`);
  console.log(`✓ XUẤT THÀNH PHẨM MASTER THÀNH CÔNG:`);
  console.log(`  File: ${outputVideoPath}`);
  console.log(`  Thời lượng: ${finalDur.toFixed(2)}s | Dung lượng: ${finalSize} MB`);
  console.log(`============================================================`);

  return {
    outputVideoPath,
    duration: finalDur,
    sizeMB: finalSize,
    timelines
  };
}

/**
 * Extract verification keyframes at specific timestamps
 */
function extractVerificationFrames(videoPath, timestamps, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const frames = [];
  const winVideoPath = config.toWinPath(videoPath);

  for (const t of timestamps) {
    const cleanT = t.replace(/:/g, '_');
    const outFile = path.join(outputDir, `frame_${cleanT}.jpg`);
    const winOutFile = config.toWinPath(outFile);
    try {
      execSync(`ffmpeg -y -ss ${t} -i ${JSON.stringify(winVideoPath)} -update 1 -frames:v 1 ${JSON.stringify(winOutFile)} 2>/dev/null`);
      if (fs.existsSync(outFile)) {
        frames.push({ timestamp: t, path: outFile });
      }
    } catch (e) {
      console.warn(`[!] Không thể trích xuất frame tại ${t}:`, e.message);
    }
  }

  return frames;
}

/**
 * Verify integrity and extract QA snapshots for all rendered scene clips
 */
function verifyRenderedShots(rendersDir = config.RENDERS_DIR, qaDir = null) {
  const targetQa = qaDir || path.join(rendersDir, 'qa_inspect');
  if (!fs.existsSync(targetQa)) fs.mkdirSync(targetQa, { recursive: true });

  const files = fs.readdirSync(rendersDir).filter(f => f.startsWith('shot_') && f.endsWith('.mp4')).sort();
  const results = [];

  for (const f of files) {
    const sid = f.replace('.mp4', '');
    const mp4Path = path.join(rendersDir, f);
    const snapPath = path.join(targetQa, `${sid}_mid.jpg`);
    const size = fs.statSync(mp4Path).size;

    if (size > 50000) {
      if (!fs.existsSync(snapPath)) {
        try {
          execSync(`ffmpeg -y -ss 00:00:04 -i ${JSON.stringify(mp4Path)} -frames:v 1 -q:v 2 ${JSON.stringify(snapPath)} 2>/dev/null`);
        } catch {}
      }
      const ok = fs.existsSync(snapPath) && fs.statSync(snapPath).size > 10000;
      results.push({ shotId: sid, sizeMb: (size / 1024 / 1024).toFixed(2), verified: ok, snapshot: snapPath });
    } else {
      results.push({ shotId: sid, sizeMb: (size / 1024 / 1024).toFixed(2), verified: false, error: 'File corrupt or too small' });
    }
  }

  return results;
}

module.exports = {
  getDuration,
  compositeVideo,
  extractVerificationFrames,
  verifyRenderedShots
};
