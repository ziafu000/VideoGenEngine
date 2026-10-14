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
  bgmVolume = 0.15,
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

  // 0b. MD5 duplicate check across video files (Video Doubling Prevention)
  const seenVideoHashes = new Map();
  for (let i = 0; i < videoFiles.length; i++) {
    const vFile = videoFiles[i];
    if (vFile && fs.existsSync(vFile)) {
      const vHash = crypto.createHash('md5').update(fs.readFileSync(vFile)).digest('hex');
      if (seenVideoHashes.has(vHash)) {
        const prevIdx = seenVideoHashes.get(vHash);
        throw new Error(`PHÁT HIỆN LỖI LẶP VIDEO (Video Doubling): Phân cảnh ${i + 1} (${path.basename(vFile)}) trùng md5 100% với Phân cảnh ${prevIdx + 1}! MD5: ${vHash}. Dừng quy trình xuất master.`);
      }
      seenVideoHashes.set(vHash, i);
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

  // 3. Concatenate video clips into raw_master.mp4 using robust concat filter to prevent timebase mismatch freezes
  const rawMaster = path.join(tempDir, 'raw_master.mp4');
  const winRawMaster = config.toWinPath(rawMaster);
  console.log(`[-] Đang nối các clip video (chuẩn hóa filter concat chống đơ lệch timebase)...`);
  const inputs = videoFiles.map(vf => `-i ${JSON.stringify(config.toWinPath(vf))}`).join(' ');
  const filterInputs = videoFiles.map((_, idx) => `[${idx}:v][${idx}:a]`).join('');
  const concatFilter = `${filterInputs}concat=n=${videoFiles.length}:v=1:a=1[v][a]`;
  execSync(`ffmpeg -y ${inputs} -filter_complex "${concatFilter}" -map "[v]" -map "[a]" -c:v libx264 -preset ultrafast -crf 17 -c:a aac ${JSON.stringify(winRawMaster)}`);
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
  const isBgmDisabled = bgmPath === 'none' || bgmVolume <= 0;
  const effectiveBgm = isBgmDisabled ? null : ((bgmPath && fs.existsSync(bgmPath)) ? bgmPath : (fs.existsSync(defaultBgm) ? defaultBgm : null));
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

  try {
    execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    console.error(`[!] Lỗi ffmpeg xuất master:`, err.stderr ? err.stderr.toString() : err.message);
    throw err;
  }

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

/**
 * Render a 2D still image into a Ken Burns animated MP4 clip matching shot duration.
 */
function renderMotionStill({
  imagePath,
  duration,
  outputPath,
  effect = 'zoom_in',
  fps = 30,
  width = 1920,
  height = 1080
}) {
  const winImagePath = config.toWinPath(imagePath);
  const winOutputPath = config.toWinPath(outputPath);
  const frames = Math.max(1, Math.ceil(duration * fps));

  let filter = '';
  switch (effect) {
    case 'zoom_out':
      filter = `zoompan=z='max(1.25-0.0015*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_left':
      filter = `zoompan=z=1.15:x='max(0,(iw-iw/zoom)*(1-on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_right':
      filter = `zoompan=z=1.15:x='min(iw-iw/zoom,(iw-iw/zoom)*(on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'zoom_in':
    default:
      filter = `zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const cmd = `ffmpeg -y -loop 1 -i ${JSON.stringify(winImagePath)} -vf "${filter},format=yuv420p" -t ${duration.toFixed(3)} -c:v libx264 -preset fast -crf 18 -pix_fmt yuv420p ${JSON.stringify(winOutputPath)}`;
  execSync(cmd, { stdio: ['ignore', 'pipe', 'pipe'] });
  return outputPath;
}

/**
 * Assemble Minimalist Explainer Master Video via FFmpeg Concat Demuxer (Static Hard Cuts, 0 Ken Burns)
 * Rapid 1-pass assembly in ~0.5s - 1.0s directly synchronized to master audio.
 */
function assembleStaticCuts({
  shots, // Array of { imagePath, duration }
  audioMasterPath,
  outputPath,
  aspectRatio = '16:9'
}) {
  if (!shots || shots.length === 0) {
    throw new Error('assembleStaticCuts: Mảng shots rỗng!');
  }
  if (!fs.existsSync(audioMasterPath)) {
    throw new Error(`assembleStaticCuts: Không tìm thấy file audio master tại: ${audioMasterPath}`);
  }

  // 0. MD5 Image Doubling Prevention
  const seenImageHashes = new Map();
  for (let i = 0; i < shots.length; i++) {
    const imgPath = shots[i].imagePath;
    if (!fs.existsSync(imgPath)) {
      throw new Error(`[!] Không tìm thấy ảnh cho shot ${i + 1}: ${imgPath}`);
    }
    const buf = fs.readFileSync(imgPath);
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    if (seenImageHashes.has(hash)) {
      const prevIdx = seenImageHashes.get(hash);
      throw new Error(`PHÁT HIỆN LỖI TRÙNG ẢNH (Image Doubling): Shot ${i + 1} (${path.basename(imgPath)}) trùng md5 100% với Shot ${prevIdx + 1}! MD5: ${hash}. Dừng quy trình xuất master.`);
    }
    seenImageHashes.set(hash, i);
  }

  // 1. Build ffconcat version 1.0
  const concatLines = ['ffconcat version 1.0'];
  for (const s of shots) {
    concatLines.push(`file '${config.toWinPath(s.imagePath).replace(/\\/g, '/')}'`);
    concatLines.push(`duration ${Number(s.duration).toFixed(3)}`);
  }
  const lastImg = shots[shots.length - 1].imagePath;
  concatLines.push(`file '${config.toWinPath(lastImg).replace(/\\/g, '/')}'`);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const concatFile = path.join(outDir, 'concat_plan.txt');
  fs.writeFileSync(concatFile, concatLines.join('\n'), 'utf8');

  const isShorts = aspectRatio === '9:16';
  const scaleFilter = isShorts
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p'
    : 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p';

  console.log(`[-] Running 1-pass FFmpeg Concat Demuxer for ${shots.length} static cuts...`);
  execFileSync('ffmpeg', [
    '-nostdin',
    '-y',
    '-f', 'concat',
    '-safe', '0',
    '-i', config.toWinPath(concatFile),
    '-i', config.toWinPath(audioMasterPath),
    '-vf', scaleFilter,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    config.toWinPath(outputPath)
  ], { stdio: ['ignore', 'inherit', 'inherit'] });

  console.log(`[✓] Master video created: ${outputPath} (${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB)`);
  return outputPath;
}

/**
 * High-level orchestration to assemble an entire storyboard (Static cuts demuxer or Video clip concat).
 */
async function assembleStoryboard(sb, options = {}) {
  const {
    noSubs = false,
    sbPath = ''
  } = options;

  const shots = sb.shots || [];
  const baseName = sbPath ? path.basename(sbPath, '.json') : 'storyboard';
  const episodeName = sb.series_id || (sb.project && sb.project.id ? sb.project.id : '') || baseName;
  let epRenderDir = path.join(config.RENDERS_DIR, episodeName);
  let audioDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(audioDir) && fs.existsSync(path.join(config.AUDIO_DIR, baseName))) {
    audioDir = path.join(config.AUDIO_DIR, baseName);
  }

  const isShorts = (sb.aspect_ratio === '9:16') ||
                   (sb.geometry && sb.geometry.aspect_ratio === '9:16') ||
                   (sb.format === 'shorts_40s') ||
                   (sb.project && (sb.project.mode === 'shorts' || sb.project.aspect_ratio === '9:16'));
  const noHardsub = noSubs || sb.hardsub === false || (sb.subtitles && sb.subtitles.hardsub === false) || (sb.project && sb.project.hardsub === false);

  // 1. Static Cuts Demuxer mode (Minimalist Explainer / Static Hard Cuts)
  const isStaticCuts = (sb.pacing === 'static_cuts' || sb.pacing === 'hard_cuts' || sb.format === 'minimalist_explainer' || sb.motion === 'none');
  if (isStaticCuts) {
    console.log(`\n=== CHẾ ĐỘ DỰNG TĨNH SIÊU TỐC (STATIC HARD CUTS / 1-PASS DEMUXER) ===`);
    const staticShots = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      const possibleImgs = [
        path.join(epRenderDir, `${shotId}.png`),
        path.join(epRenderDir, `${shotId}.jpg`),
        path.join(config.RENDERS_DIR, `${shotId}.png`),
        path.join(config.RENDERS_DIR, `${shotId}.jpg`),
        (s.image ? path.resolve(config.PROJECT_DIR, s.image) : null)
      ].filter(Boolean);
      const foundImg = possibleImgs.find(p => fs.existsSync(p));
      if (!foundImg) {
        throw new Error(`[!] Không tìm thấy ảnh cho shot ${shotId} trong ${epRenderDir}`);
      }
      const aFile = path.join(audioDir, `voice_${shotId}.mp3`);
      const audioDur = fs.existsSync(aFile) ? getDuration(aFile) : 0;
      const shotDur = s.duration || s.duration_seconds || (audioDur > 0 ? audioDur : 2.5);
      staticShots.push({ imagePath: foundImg, duration: shotDur });
    }

    let masterAudio = (sb.audio_master && fs.existsSync(sb.audio_master))
      ? sb.audio_master
      : path.join(audioDir, 'master_voice_tight.wav');
    if (!fs.existsSync(masterAudio)) {
      masterAudio = path.join(audioDir, 'master_voice.wav');
    }
    if (!fs.existsSync(masterAudio)) {
      masterAudio = path.join(audioDir, 'master_voice_clauses.wav');
    }
    if (!fs.existsSync(masterAudio)) {
      try {
        const ttsModule = require('./tts');
        const builtMaster = ttsModule.buildMasterClauseAudio(sb, audioDir, sbPath);
        if (builtMaster && fs.existsSync(builtMaster)) {
          masterAudio = builtMaster;
        }
      } catch {}
    }

    const outVideoName = (sb.project && sb.project.id ? `${sb.project.id}_Master_1080p.mp4` : `${episodeName}_Master_1080p.mp4`);
    const masterOutPath = path.join(config.OUTPUT_DIR, outVideoName);
    return assembleStaticCuts({
      shots: staticShots,
      audioMasterPath: masterAudio,
      outputPath: masterOutPath,
      aspectRatio: sb.aspect_ratio || (sb.project && sb.project.aspect_ratio) || '16:9'
    });
  }

  // 2. Video Clips Concat mode
  const videoFiles = [];
  const audioFiles = [];
  const timelines = [];
  const delays = [];
  let count11LabsVoice = 0;
  let countMissingVoice = 0;

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
    let vFile = path.join(epRenderDir, `${shotId}.mp4`);
    if (!fs.existsSync(vFile)) {
      vFile = path.join(config.RENDERS_DIR, `${shotId}.mp4`);
    }
    const aFile = path.join(audioDir, `voice_${shotId}.mp3`);

    if (!fs.existsSync(vFile)) {
      const possibleImgs = [
        path.join(epRenderDir, `${shotId}.png`),
        path.join(epRenderDir, `${shotId}.jpg`),
        path.join(config.RENDERS_DIR, `${shotId}.png`),
        path.join(config.RENDERS_DIR, `${shotId}.jpg`),
        (s.image ? path.resolve(config.PROJECT_DIR, s.image) : null)
      ].filter(Boolean);
      const foundImg = possibleImgs.find(p => fs.existsSync(p));
      if (foundImg) {
        const audioDur = fs.existsSync(aFile) ? getDuration(aFile) : 0;
        const shotDur = audioDur > 0 ? (audioDur + 0.3) : (s.duration || 2.5);
        const motionEffects = ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'];
        const effect = s.motion_effect || motionEffects[i % motionEffects.length];
        console.log(`    [-] [Motion Stills] Chuyển đổi ảnh tĩnh ${path.basename(foundImg)} sang clip Ken Burns ${shotDur.toFixed(2)}s (${effect})...`);
        renderMotionStill({
          imagePath: foundImg,
          duration: shotDur,
          outputPath: vFile,
          effect,
          width: isShorts ? 1080 : 1920,
          height: isShorts ? 1920 : 1080
        });
      }
    }

    if (fs.existsSync(vFile)) {
      videoFiles.push(vFile);

      const hasSubOrVo = !!(s.vietnamese_subtitles || s.japanese_voiceover || s.voice || s.text || (s.audio && (s.audio.voiceover || s.audio.japanese_voiceover)));
      const hasAudioFile = hasSubOrVo && fs.existsSync(aFile);

      if (hasAudioFile) {
        count11LabsVoice++;
        audioFiles.push(aFile);
      } else {
        if (hasSubOrVo) {
          countMissingVoice++;
          console.warn(`    [!] CẢNH BÁO: ${shotId} có phụ đề/lời thoại nhưng chưa có file voice tại ${aFile}!`);
        }
        audioFiles.push(null);
      }

      const delaySec = (s.voice && typeof s.voice.voice_delay_sec === 'number') 
        ? s.voice.voice_delay_sec 
        : ((s.audio && typeof s.audio.voice_delay_sec === 'number') ? s.audio.voice_delay_sec : 0.0);
      delays.push(delaySec);

      timelines.push({
        shotId,
        duration: getDuration(vFile),
        audioDuration: hasAudioFile ? getDuration(aFile) : 0,
        voiceDelaySec: delaySec
      });
    }
  }

  if (videoFiles.length === 0) {
    throw new Error(`Không tìm thấy file video/clip nào trong ${epRenderDir} hoặc renders/! Vui lòng chạy ./videogen render trước.`);
  }

  console.log(`[-] Tìm thấy ${videoFiles.length} video clips (${count11LabsVoice} shots có file voiceover).`);
  let assPath = path.join(epRenderDir, 'subtitles.ass');
  if (!fs.existsSync(epRenderDir)) assPath = path.join(config.RENDERS_DIR, 'subtitles.ass');

  if (!noHardsub) {
    const subtitlesModule = require('./subtitles');
    subtitlesModule.generateSubtitles(sb, timelines, assPath);
  }

  const safeTitle = ((sb.project && sb.project.title) || sb.title || episodeName).replace(/\s+/g, '_');
  const masterOutput = path.join(config.OUTPUT_DIR, `${safeTitle}_master.mp4`);

  const audioMix = sb.audio_mix || {};
  const ambientVol = typeof audioMix.ambient_volume === 'number' ? audioMix.ambient_volume : 0.25;
  const voiceVol = typeof audioMix.voice_volume === 'number' ? audioMix.voice_volume : 1.0;
  const bgmVol = typeof audioMix.bgm_volume === 'number' ? audioMix.bgm_volume : (typeof sb.bgm_volume === 'number' ? sb.bgm_volume : 0.15);
  const bgmPath = audioMix.bgm_path || sb.bgm || null;

  return compositeVideo({
    videoFiles,
    audioFiles,
    assSubtitlePath: noHardsub ? null : assPath,
    subtitles_path: noHardsub ? null : assPath,
    outputVideoPath: masterOutput,
    ambientVolume: ambientVol,
    voiceVolume: voiceVol,
    bgmVolume: bgmVol,
    bgmPath: bgmPath,
    delays,
    aspectRatio: isShorts ? '9:16' : '16:9',
    burnSubtitles: !noHardsub
  });
}

module.exports = {
  getDuration,
  compositeVideo,
  assembleStaticCuts,
  assembleStoryboard,
  renderMotionStill,
  extractVerificationFrames,
  verifyRenderedShots
};
