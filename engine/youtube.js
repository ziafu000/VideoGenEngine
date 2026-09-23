const path = require('path');
const { fork } = require('child_process');
const config = require('./config');
const jev = require('./jev');

async function uploadVideo({
  videoPath,
  title,
  description = '',
  visibility = 'unlisted',
  thumbnail = null
}) {
  console.log(`=== YOUTUBE STUDIO UPLOAD AUTOMATION ===`);
  console.log(`Video: ${videoPath}`);
  console.log(`Title: ${title}`);
  console.log(`Visibility: ${visibility}`);

  // Pre-flight title/description screening with TypeSafe Jev if available
  try {
    const parsed = jev.screenPrompt(title + ' ' + description);
    if (parsed.safe === false) {
      console.warn(`[!] Cảnh báo kiểm duyệt Jev: Tiêu đề có điểm rủi ro ${parsed.risk_score}: ${parsed.reason}`);
    } else {
      console.log(`[✓] TypeSafe Jev: Tiêu đề video an toàn.`);
    }
  } catch {}

  const uploaderScript = path.join(__dirname, 'youtube_uploader.js');
  const args = ['upload', '--video', videoPath, '--title', title, '--description', description, '--visibility', visibility];
  if (thumbnail) {
    args.push('--thumbnail', thumbnail);
  }

  return new Promise((resolve, reject) => {
    const child = fork(uploaderScript, args, { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`YouTube upload exited with code ${code}`));
    });
  });
}

async function getStatus() {
  const uploaderScript = path.join(__dirname, 'youtube_uploader.js');
  return new Promise((resolve, reject) => {
    const child = fork(uploaderScript, ['status'], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`YouTube status check exited with code ${code}`));
    });
  });
}

module.exports = {
  uploadVideo,
  getStatus
};
