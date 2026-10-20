const path = require('path');
const { fork } = require('child_process');
const config = require('./config');
const jev = require('./jev');

async function uploadVideo({
  videoPath,
  title,
  description = '',
  visibility = 'unlisted',
  thumbnail = null,
  schedule = null,
  channel = null
}) {
  console.log(`=== YOUTUBE STUDIO UPLOAD AUTOMATION ===`);
  console.log(`Video: ${videoPath}`);
  console.log(`Title: ${title}`);
  console.log(`Visibility: ${schedule ? `SCHEDULED (${schedule})` : visibility}`);

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
  if (schedule) {
    args.push('--schedule', schedule);
  }
  if (channel) {
    args.push('--channel', channel);
  }

  return new Promise((resolve, reject) => {
    let stdoutData = '';
    const child = fork(uploaderScript, args, {
      stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
      timeout: 300000 // 5 minute subprocess timeout (A12)
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdoutData += text;
        process.stdout.write(text);
      });
    }

    child.on('error', (err) => {
      reject(new Error(`YouTube uploader process error: ${err.message}`));
    });

    child.on('exit', (code) => {
      if (code === 0) {
        let parsedResult = null;
        try {
          const jsonMatch = stdoutData.match(/\{[\s\S]*"success":\s*true[\s\S]*\}/);
          if (jsonMatch) {
            parsedResult = JSON.parse(jsonMatch[0]);
          }
        } catch {}

        if (parsedResult && parsedResult.success && parsedResult.video_id) {
          resolve(parsedResult);
        } else if (parsedResult && parsedResult.success) {
          resolve(parsedResult);
        } else {
          // Exit 0 but missing positive proof (A02)
          reject(new Error('YouTube uploader thoát với mã 0 nhưng thiếu bằng chứng xác nhận video_id'));
        }
      } else {
        reject(new Error(`YouTube upload exited with code ${code}`));
      }
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
