const fs = require('fs');
const path = require('path');
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
  outputVideoPath,
  voiceVolume = 1.0,
  ambientVolume = 0.30,
  delays = [],
  aspectRatio = '16:9',
  burnSubtitles = true
}) {
  const tempDir = path.join(config.PROJECT_DIR, 'renders', 'temp_assemble');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  console.log(`=== BẮT ĐẦU QUÁ TRÌNH GHÉP NỐI & HẬU KỲ (COMPOSITOR) ===`);
  console.log(`Số phân cảnh video: ${videoFiles.length}`);
  console.log(`Số file voiceover: ${audioFiles.length}`);
  console.log(`Tỷ lệ khung hình: ${aspectRatio} | Hardsub: ${burnSubtitles ? 'BẬT' : 'TẮT (Clean Footage)'}`);

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
  const shouldBurnSubtitles = Boolean(burnSubtitles && assSubtitlePath && fs.existsSync(assSubtitlePath));
  const winAssSubtitlePath = shouldBurnSubtitles ? config.toWinPath(assSubtitlePath).replace(/\\/g, '/').replace(/:/g, '\\\\:') : '';
  const winOutputVideoPath = config.toWinPath(outputVideoPath);

  const isVertical = aspectRatio === '9:16';
  const scaleFilter = isVertical ? 'scale=1080:1920:flags=lanczos' : 'scale=1920:1080:flags=lanczos';
  const subFilter = shouldBurnSubtitles ? `,subtitles='${winAssSubtitlePath}'` : '';
  const videoFilter = `${scaleFilter}${subFilter}`;

  let filterStr = '';
  let cmd = '';

  if (hasVoiceTrack) {
    console.log(`    [-] Hòa âm đa tầng: Dải âm gốc Flow (100% SFX & Ambiance) + Voiceover ElevenLabs (100% Lời thoại Studio)...`);
    filterStr = `[0:v]${videoFilter}[v];[0:a]volume=1.0[a_bg];[1:a]volume=${voiceVolume}[a_voice];[a_bg][a_voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]`;
    cmd = `ffmpeg -y -i ${JSON.stringify(winRawMaster)} -i ${JSON.stringify(winMasterVoice)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(winOutputVideoPath)}`;
  } else {
    // 100% pure Flow SFX audio (No dialogue track)
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
