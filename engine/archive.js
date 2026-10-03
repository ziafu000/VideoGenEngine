const fs = require('fs');
const path = require('path');
const config = require('./config');

function cleanDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) return;
  const items = fs.readdirSync(dirPath);
  for (const it of items) {
    if (it === '.gitkeep') continue;
    const p = path.join(dirPath, it);
    try {
      if (fs.statSync(p).isDirectory()) {
        fs.rmSync(p, { recursive: true, force: true });
      } else {
        fs.unlinkSync(p);
      }
    } catch (e) {
      console.warn(`[!] Không thể xóa ${p}:`, e.message);
    }
  }
}

async function archiveProject({
  storyboardPath,
  masterVideoPath,
  videoClipsDir,
  audioDir,
  assSubtitlePath
}) {
  console.log(`\n============================================================`);
  console.log(`        VIDEOGEN: ARCHIVE MATERIALS & REPO CLEANUP          `);
  console.log(`============================================================`);

  if (!fs.existsSync(config.DEST_ORIGINAL) || !fs.existsSync(config.DEST_FINAL)) {
    console.warn('[!] Cảnh báo: Thư mục ổ D: không tồn tại. Bỏ qua bước di chuyển sang D: drive.');
    return false;
  }

  let title = 'video_project';
  if (storyboardPath && fs.existsSync(storyboardPath)) {
    try {
      const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
      title = (sb.project && sb.project.title) || (sb.series && sb.series + ' - ' + sb.episode_title) || sb.title || 'video_project';
    } catch {}
  }

  const safeName = title.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);

  const archiveMatDir = path.join(config.DEST_ORIGINAL, `${safeName}_materials_${timestamp}`);
  fs.mkdirSync(archiveMatDir, { recursive: true });

  console.log(`[-] Thư mục lưu trữ nguyên liệu: ${archiveMatDir}`);

  // 1. Copy raw video clips
  if (videoClipsDir && fs.existsSync(videoClipsDir)) {
    const vFiles = fs.readdirSync(videoClipsDir).filter(f => f.endsWith('.mp4'));
    for (const f of vFiles) {
      fs.copyFileSync(path.join(videoClipsDir, f), path.join(archiveMatDir, f));
    }
    console.log(`  [✓] Đã sao lưu ${vFiles.length} video clip thô`);
  }

  // 2. Copy audio files
  if (audioDir && fs.existsSync(audioDir)) {
    const destAudio = path.join(archiveMatDir, 'audio');
    fs.mkdirSync(destAudio, { recursive: true });
    const aFiles = fs.readdirSync(audioDir).filter(f => f.endsWith('.mp3') || f.endsWith('.wav'));
    for (const f of aFiles) {
      fs.copyFileSync(path.join(audioDir, f), path.join(destAudio, f));
    }
    console.log(`  [✓] Đã sao lưu ${aFiles.length} file audio`);
  }

  // 3. Copy ASS subtitle & Storyboard
  if (assSubtitlePath && fs.existsSync(assSubtitlePath)) {
    fs.copyFileSync(assSubtitlePath, path.join(archiveMatDir, path.basename(assSubtitlePath)));
    console.log(`  [✓] Đã sao lưu file phụ đề ASS`);
  }

  if (storyboardPath && fs.existsSync(storyboardPath)) {
    fs.copyFileSync(storyboardPath, path.join(archiveMatDir, 'storyboard_backup.json'));
    console.log(`  [✓] Đã sao lưu kịch bản storyboard_backup.json`);
  }

  // 4. Copy Master Final Video to DEST_FINAL
  if (masterVideoPath && fs.existsSync(masterVideoPath)) {
    const destMasterTimestamped = path.join(config.DEST_FINAL, `${safeName}_${timestamp}.mp4`);
    const destMasterPrimary = path.join(config.DEST_FINAL, `${safeName}.mp4`);

    fs.copyFileSync(masterVideoPath, destMasterTimestamped);
    fs.copyFileSync(masterVideoPath, destMasterPrimary);

    console.log(`[✓] ĐÃ MIGRATE THÀNH PHẨM MASTER SANG WINDOWS D: DRIVE:`);
    console.log(`  -> ${destMasterPrimary}`);
  }

  // 5. Clean up repo working directories (keep only .gitkeep)
  console.log(`[-] Dọn dẹp sạch repo VideoGen (renders/, audio/, output/)...`);
  cleanDirectory(config.RENDERS_DIR);
  cleanDirectory(config.AUDIO_DIR);
  cleanDirectory(config.OUTPUT_DIR);

  console.log(`✓ Dọn dẹp hoàn tất! Repo siêu nhẹ, sẵn sàng cho tập tiếp theo.`);
  console.log(`============================================================\n`);
  return true;
}

module.exports = {
  archiveProject,
  cleanDirectory
};
