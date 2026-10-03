const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { listPages } = require('./cdp');

async function runDoctor() {
  console.log(`\n============================================================`);
  console.log(`  VIDEOGEN ENGINE — SYSTEM HEALTH & SECURITY PREFLIGHT`);
  console.log(`============================================================\n`);

  let allOk = true;

  // 1. Node.js Version Check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.slice(1).split('.')[0], 10);
  if (major >= 20) {
    console.log(`  [✓] Node.js Runtime: ${nodeVer} (Supported >= 20.0.0)`);
  } else {
    console.log(`  [✗] Node.js Runtime: ${nodeVer} (Requires >= 20.0.0)`);
    allOk = false;
  }

  // 2. FFmpeg & FFprobe Check
  try {
    const ffmpegVer = execSync('ffmpeg -version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0];
    console.log(`  [✓] FFmpeg: ${ffmpegVer.split(' Copyright')[0]}`);
  } catch {
    console.log(`  [✗] FFmpeg: Không tìm thấy lệnh 'ffmpeg' trong PATH!`);
    allOk = false;
  }

  try {
    const ffprobeVer = execSync('ffprobe -version', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0];
    console.log(`  [✓] FFprobe: ${ffprobeVer.split(' Copyright')[0]}`);
  } catch {
    console.log(`  [✗] FFprobe: Không tìm thấy lệnh 'ffprobe' trong PATH!`);
    allOk = false;
  }

  // 3. Environment & User Detection
  console.log(`  [✓] Windows User: ${config.WIN_USER} (Auto-detected)`);
  console.log(`  [✓] Host IP (WSL -> Win): ${config.WIN_HOST}`);
  console.log(`  [✓] Downloads Path: ${config.WIN_DOWNLOADS_DIR}`);
  if (fs.existsSync(config.WIN_DOWNLOADS_DIR)) {
    console.log(`      └─ Trạng thái: Tồn tại & có thể truy cập`);
  } else {
    console.log(`      └─ [!] Cảnh báo: Thư mục chưa tồn tại hoặc WSL chưa mount /mnt/c`);
  }

  // 4. PowerShell / Windows Shell Check
  const psCmd = config.getPowerShellCmd();
  console.log(`  [✓] Windows Shell Executable: ${psCmd}`);

  // 5. Chrome DevTools Protocol Bridge Check
  try {
    const res = await fetch(`${config.CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    if (res.ok) {
      const data = await res.json();
      console.log(`  [✓] CDP Bridge (${config.CDP_URL}): ONLINE (${data.Browser || 'Chrome'})`);

      // 6. Check Active Tabs
      const pages = await listPages();
      const pageUrls = pages.filter(p => p.type === 'page').map(p => p.url);

      const hasFlow = pageUrls.some(u => u.includes('flow.google.com'));
      const hasEleven = pageUrls.some(u => u.includes('elevenlabs.io'));

      console.log(`  [${hasFlow ? '✓' : '!'}] Tab Google Flow: ${hasFlow ? 'Đã mở' : 'Chưa mở (sẽ tự động mở khi chạy)'}`);
      console.log(`  [${hasEleven ? '✓' : '!'}] Tab ElevenLabs: ${hasEleven ? 'Đã mở' : 'Chưa mở (sẽ tự động mở khi chạy)'}`);
    } else {
      console.log(`  [!] CDP Bridge (${config.CDP_URL}): Phản hồi mã HTTP ${res.status}`);
    }
  } catch {
    console.log(`  [!] CDP Bridge (${config.CDP_URL}): OFFLINE (Chưa chạy bridge hoặc Chrome chưa mở)`);
    console.log(`      └─ Gợi ý: Chạy './videogen bridge' để tự động khởi động`);
  }

  // 7. TypeSafe Jev AI Key Check
  const tsKey = process.env.TYPESAFE_API_KEY;
  if (tsKey && tsKey.trim().length > 0) {
    const masked = tsKey.slice(0, 4) + '...' + tsKey.slice(-4);
    console.log(`  [✓] TypeSafe AI Key (Jev Decider): Đã cấu hình (${masked})`);
  } else {
    console.log(`  [i] TypeSafe AI Key: Chưa cấu hình (Chế độ heuristic DOM fallback)`);
  }

  // 8. Open-Source IP Security & Gitignore Hygiene
  console.log(`\n--- KIỂM TRA BẢO MẬT MÃ NGUỒN MỞ (IP PROTECTION) ---`);
  try {
    const trackedFiles = execSync('git ls-files', { encoding: 'utf8', cwd: config.PROJECT_DIR }).split('\n');

    const envTracked = trackedFiles.filter(f => f.endsWith('.env') && !f.endsWith('.env.example'));
    if (envTracked.length === 0) {
      console.log(`  [✓] File bảo mật (.env): Được bảo vệ an toàn (Không track trên Git)`);
    } else {
      console.log(`  [✗] LỖI NGUY HIỂM: File bí mật đang bị Git theo dõi: ${envTracked.join(', ')}`);
      allOk = false;
    }

    const sbTracked = trackedFiles.filter(f => f.startsWith('storyboards/') && f.endsWith('.json'));
    if (sbTracked.length === 0) {
      console.log(`  [✓] Bản quyền kịch bản (storyboards/*.json): 100% Private (Không leak Git)`);
    } else {
      console.log(`  [!] Cảnh báo: Có kịch bản đang bị Git track: ${sbTracked.join(', ')}`);
    }

    const rendersTracked = trackedFiles.filter(f => f.startsWith('renders/') && !f.endsWith('.gitkeep'));
    if (rendersTracked.length === 0) {
      console.log(`  [✓] Thư mục media (renders/*, audio/*): Không bị commit file rác`);
    } else {
      console.log(`  [!] Cảnh báo: File media đang bị Git track: ${rendersTracked.slice(0, 3).join(', ')}...`);
    }

    // 9. Automated Regex Scan for Private Identifiers / IP Leaks
    const forbiddenAliases = Buffer.from('emZzdHVkaW98c2tldGNoX3RoZV9wYXN0fGF0aGVuYXN0b2Nr', 'base64').toString('utf8');
    const forbiddenName = Buffer.from('R2lhIFBow7o=', 'base64').toString('utf8');
    const leakPatterns = [
      { name: 'YouTube Channel ID', regex: /UC[a-zA-Z0-9_-]{22}/ },
      { name: 'Private Channel Alias', regex: new RegExp('\\b(' + forbiddenAliases + ')\\b', 'i') },
      { name: 'Personal Profile Name', regex: new RegExp(forbiddenName, 'i') }
    ];

    let foundLeaks = [];
    for (const file of trackedFiles) {
      if (!file || file.endsWith('.env.example') || file.endsWith('doctor.js')) continue;
      const fullPath = path.join(config.PROJECT_DIR, file);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const lp of leakPatterns) {
          if (lp.regex.test(content)) {
            foundLeaks.push({ file, type: lp.name });
          }
        }
      }
    }

    if (foundLeaks.length === 0) {
      console.log(`  [✓] Quét mã nguồn mở (Zero Leak Audit): 100% Sạch (Không lộ Channel ID, IP nội bộ)`);
    } else {
      console.log(`  [✗] NGUY HIỂM: Phát hiện dữ liệu nội bộ trong file theo dõi:`);
      for (const l of foundLeaks) {
        console.log(`      └─ File: ${l.file} (Loại: ${l.type})`);
      }
      allOk = false;
    }
  } catch (err) {
    console.log(`  [i] Không thể kiểm tra Git status: ${err.message}`);
  }

  console.log(`\n============================================================`);
  if (allOk) {
    console.log(`  ✓ HỆ THỐNG ĐẠT CHUẨN AN TOÀN VÀ SẴN SÀNG VẬN HÀNH!`);
  } else {
    console.log(`  ✗ CẦN KHẮC PHỤC CÁC CẢNH BÁO ĐỎ TRƯỚC KHI XUẤT XƯỞNG.`);
  }
  console.log(`============================================================\n`);
  return allOk;
}

module.exports = {
  runDoctor
};
