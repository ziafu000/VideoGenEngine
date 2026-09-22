const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
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
  ambientVolume = 0.30
}) {
  const tempDir = path.join(config.PROJECT_DIR, 'renders', 'temp_assemble');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  console.log(`=== BẮT ĐẦU QUÁ TRÌNH GHÉP NỐI & HẬU KỲ (COMPOSITOR) ===`);
  console.log(`Số phân cảnh video: ${videoFiles.length}`);
  console.log(`Số file voiceover: ${audioFiles.length}`);

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
    if (aFile && fs.existsSync(aFile)) {
      aDur = getDuration(aFile);
      execSync(`ffmpeg -y -i ${JSON.stringify(aFile)} -af "adelay=300|300,apad=whole_dur=${vDur}" -ar 44100 -ac 2 -t ${vDur} ${JSON.stringify(paddedAudio)} 2>/dev/null`);
    } else {
      execSync(`ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=stereo -t ${vDur} ${JSON.stringify(paddedAudio)} 2>/dev/null`);
    }

    audioConcatContent += `file '${paddedAudio}'\n`;
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
  execSync(`ffmpeg -y -f concat -safe 0 -i ${JSON.stringify(paddedAudioList)} -c:a pcm_s16le ${JSON.stringify(masterVoice)} 2>/dev/null`);
  console.log(`[✓] Đã tạo master voice track: ${getDuration(masterVoice).toFixed(2)}s`);

  // 3. Concatenate video clips into raw_master.mp4
  const videoConcatList = path.join(tempDir, 'video_concat.txt');
  let videoConcatContent = '';
  for (const vf of videoFiles) {
    videoConcatContent += `file '${vf}'\n`;
  }
  fs.writeFileSync(videoConcatList, videoConcatContent, 'utf8');

  const rawMaster = path.join(tempDir, 'raw_master.mp4');
  console.log(`[-] Đang nối các clip video...`);
  execSync(`ffmpeg -y -f concat -safe 0 -i ${JSON.stringify(videoConcatList)} -c copy ${JSON.stringify(rawMaster)} 2>/dev/null`);
  console.log(`[✓] Đã nối xong raw master video: ${getDuration(rawMaster).toFixed(2)}s`);

  // 4. Final Compositing: Audio mix (voice + ambient) + 1080p Lanczos upscale + Subtitle burn
  console.log(`[-] Đang hòa âm đa tầng, upscale 1080p Full HD và burn phụ đề ASS...`);
  const outDir = path.dirname(outputVideoPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const filterStr = `[0:v]scale=1920:1080:flags=lanczos,subtitles='${assSubtitlePath}'[v];[0:a]volume=${ambientVolume}[a_bg];[1:a]volume=${voiceVolume}[a_voice];[a_bg][a_voice]amix=inputs=2:duration=first:dropout_transition=2[a]`;

  execSync(`ffmpeg -y -i ${JSON.stringify(rawMaster)} -i ${JSON.stringify(masterVoice)} -filter_complex "${filterStr}" -map "[v]" -map "[a]" -c:v libx264 -preset fast -crf 17 -c:a aac -b:a 192k ${JSON.stringify(outputVideoPath)} 2>/dev/null`);

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

module.exports = {
  getDuration,
  compositeVideo,
  extractVerificationFrames
};
