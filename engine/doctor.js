const { execFileSync } = require('child_process');
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
    const ffmpegVer = execFileSync('ffmpeg', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0];
    console.log(`  [✓] FFmpeg: ${ffmpegVer.split(' Copyright')[0]}`);
  } catch {
    console.log(`  [✗] FFmpeg: Không tìm thấy lệnh 'ffmpeg' trong PATH!`);
    allOk = false;
  }

  try {
    const ffprobeVer = execFileSync('ffprobe', ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0];
    console.log(`  [✓] FFprobe: ${ffprobeVer.split(' Copyright')[0]}`);
  } catch {
    console.log(`  [✗] FFprobe: Không tìm thấy lệnh 'ffprobe' trong PATH!`);
    allOk = false;
  }

  // 3. Environment & User Detection
  const platformLabel = process.platform === 'win32'
    ? 'Windows Native (win32)'
    : process.platform === 'darwin'
      ? 'macOS (darwin)'
      : (fs.existsSync('/mnt/c/Windows') || process.env.WSL_DISTRO_NAME ? 'Linux WSL2' : 'Linux Native');
  console.log(`  [✓] Platform: ${platformLabel}`);
  console.log(`  [✓] OS / Windows User: ${config.WIN_USER} (Auto-detected)`);
  console.log(`  [✓] Host IP (CDP Target): ${config.WIN_HOST}`);
  console.log(`  [✓] Downloads Path: ${config.WIN_DOWNLOADS_DIR}`);
  if (fs.existsSync(config.WIN_DOWNLOADS_DIR)) {
    console.log(`      └─ Trạng thái: Tồn tại & có thể truy cập`);
  } else {
    console.log(`      └─ [!] Cảnh báo: Thư mục Downloads chưa tồn tại (${config.WIN_DOWNLOADS_DIR})`);
  }

  // 4. PowerShell / OS Shell Check
  if (process.platform === 'darwin') {
    console.log(`  [✓] System Shell: ${process.env.SHELL || '/bin/zsh'}`);
  } else {
    const psCmd = config.getPowerShellCmd();
    console.log(`  [✓] Shell / PowerShell Executable: ${psCmd}`);
  }

  // 5. Chrome DevTools Protocol Bridge Check
  try {
    const bridge = require('./bridge');
    await bridge.isBridgeRunning();
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

  // 8. Quota Preflight Audit (quota-axi)
  try {
    const { spawnSync } = require('child_process');
    const res = spawnSync('quota-axi', ['--provider', 'elevenlabs', '--json'], {
      encoding: 'utf8',
      timeout: 5000
    });
    if (res.stdout) {
      try {
        const data = JSON.parse(res.stdout);
        const p = data.providers?.find(item => item.provider === 'elevenlabs');
        if (p) {
          if (p.notSetUp || p.state?.status === 'auth_required') {
            console.log(`  [i] Quota Preflight (ElevenLabs via quota-axi): Chưa cấu hình CLI API key`);
            console.log(`      └─ Chế độ: Sử dụng VieNeu / F5-TTS (0 cost) hoặc ElevenLabs qua phiên trình duyệt CDP`);
          } else {
            const avail = p.quotaSemantics?.effectiveAvailability?.[0];
            const win = p.windows?.[0];
            const pct = avail?.effectivePercentRemaining ?? win?.percentRemaining ?? null;
            const resetsAt = win?.resetsAt || 'N/A';
            if (pct !== null && pct <= 0) {
              console.log(`  [!] Quota Preflight (ElevenLabs): Hạn ngạch cạn (0%)! Reset lúc: ${resetsAt}`);
              console.log(`      └─ Gợi ý: Chuyển sang voice.provider: "f5-tts" hoặc "vieneu"`);
            } else if (pct !== null) {
              console.log(`  [✓] Quota Preflight (ElevenLabs): Còn ~${pct}% quota (Reset: ${resetsAt})`);
            } else {
              console.log(`  [✓] Quota Preflight (ElevenLabs): Trạng thái ${p.state?.status || 'Active'}`);
            }
          }
        } else {
          console.log(`  [i] Quota Preflight: ElevenLabs không có trong danh mục quota-axi`);
        }
      } catch {
        console.log(`  [i] Quota Preflight: Không thể phân tích JSON từ quota-axi`);
      }
    } else {
      console.log(`  [i] Quota Preflight: quota-axi chưa cài đặt (bỏ qua tiền kiểm)`);
    }
  } catch {
    console.log(`  [i] Quota Preflight: quota-axi chưa cài đặt (bỏ qua tiền kiểm)`);
  }

  // 9. Lavish Visual Studio Check (lavish-axi)
  try {
    const lavishVer = execFileSync('lavish-axi', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    }).trim();
    const verStr = lavishVer.startsWith('v') ? lavishVer : `v${lavishVer}`;
    console.log(`  [✓] Lavish Visual Studio: Sẵn sàng (${verStr})`);
  } catch {
    console.log(`  [!] Lavish Visual Studio: Chưa cài đặt (Khuyến nghị: npm install -g lavish-axi)`);
  }

  // 10. Open-Source IP Security & Gitignore Hygiene
  const secOk = await runSecurityChecks(config.PROJECT_DIR);
  if (!secOk) {
    allOk = false;
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

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build Zero-Leak regex patterns using structural rules and optional custom tokens from local .env.
 * Strictly contains zero hardcoded Base64 or plaintext private channel/personal identifiers in tracked code.
 */
function buildLeakPatterns(projectDir = config.PROJECT_DIR) {
  const patterns = [
    {
      name: 'YouTube Channel ID',
      regex: /(?:^|[^a-zA-Z0-9_-])UC[a-zA-Z0-9_-]{22}(?:$|[^a-zA-Z0-9_-])/i
    }
  ];

  const customTokens = new Set();
  const addTokensFromRaw = (raw) => {
    if (!raw || typeof raw !== 'string') return;
    const cleaned = raw.trim().replace(/^['"]|['"]$/g, '');
    for (const part of cleaned.split(/[|,]/)) {
      const tok = part.trim();
      if (tok && tok.length >= 3 && tok !== 'YOUR_YOUTUBE_CHANNEL_ID') {
        customTokens.add(tok);
      }
    }
  };

  addTokensFromRaw(process.env.ZERO_LEAK_BLOCKLIST);
  addTokensFromRaw(process.env.PRIVATE_BLOCKLIST);
  addTokensFromRaw(process.env.LEAK_BLOCKLIST);
  addTokensFromRaw(process.env.YOUTUBE_CHANNEL_ID);

  // Also parse local .env directly if present in projectDir
  const envFile = path.join(projectDir, '.env');
  if (fs.existsSync(envFile)) {
    try {
      const lines = fs.readFileSync(envFile, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        const m = line.match(/^(ZERO_LEAK_BLOCKLIST|PRIVATE_BLOCKLIST|LEAK_BLOCKLIST|YOUTUBE_CHANNEL_ID|YOUTUBE_CHANNELS_JSON)=(.*)$/);
        if (!m) continue;
        const key = m[1];
        const val = m[2].trim().replace(/^['"]|['"]$/g, '');
        if (key === 'YOUTUBE_CHANNELS_JSON') {
          try {
            const parsed = JSON.parse(val);
            for (const [alias, chId] of Object.entries(parsed)) {
              if (alias && alias.length >= 3) customTokens.add(alias);
              if (typeof chId === 'string' && chId.length >= 3) customTokens.add(chId);
            }
          } catch {}
        } else {
          addTokensFromRaw(val);
        }
      }
    } catch {}
  }

  if (customTokens.size > 0) {
    const joined = Array.from(customTokens).map(escapeRegex).join('|');
    patterns.push({
      name: 'Custom Private Token (.env Blocklist)',
      regex: new RegExp(`(${joined})`, 'i')
    });
  }

  return patterns;
}

async function runSecurityChecks(projectDir = config.PROJECT_DIR) {
  let secOk = true;
  console.log(`\n--- KIỂM TRA BẢO MẬT MÃ NGUỒN MỞ (IP PROTECTION) ---`);
  try {
    // 10a. Check and enforce git core.hooksPath (.githooks/pre-commit)
    const hookFile = path.join(projectDir, '.githooks', 'pre-commit');
    let hooksPath = '';
    try {
      hooksPath = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
        encoding: 'utf8',
        cwd: projectDir,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {}

    if (hooksPath !== '.githooks') {
      try {
        execFileSync('git', ['config', '--local', 'core.hooksPath', '.githooks'], {
          cwd: projectDir,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        hooksPath = execFileSync('git', ['config', '--local', '--get', 'core.hooksPath'], {
          encoding: 'utf8',
          cwd: projectDir,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
      } catch {}
    }

    if (fs.existsSync(hookFile)) {
      try {
        const mode = fs.statSync(hookFile).mode;
        if ((mode & 0o111) === 0) {
          fs.chmodSync(hookFile, 0o755);
        }
      } catch {}
    }

    const hookExecOk = fs.existsSync(hookFile) && ((fs.statSync(hookFile).mode & 0o111) !== 0);
    if (hooksPath === '.githooks' && hookExecOk) {
      console.log(`  [✓] Git Pre-Commit Hook (core.hooksPath): Đã kích hoạt (.githooks/pre-commit)`);
    } else {
      console.log(`  [✗] LỖI BẢO MẬT: Git Pre-Commit Hook chưa kích hoạt chuẩn (core.hooksPath=${hooksPath || 'unset'})`);
      secOk = false;
    }

    const trackedFiles = execFileSync('git', ['ls-files'], { encoding: 'utf8', cwd: projectDir })
      .split('\n')
      .map(f => f.trim())
      .filter(Boolean);

    const envTracked = trackedFiles.filter(f => (f === '.env' || f.endsWith('/.env') || f.endsWith('.env')) && !f.endsWith('.env.example'));
    if (envTracked.length === 0) {
      console.log(`  [✓] File bảo mật (.env): Được bảo vệ an toàn (Không track trên Git)`);
    } else {
      console.log(`  [✗] LỖI NGUY HIỂM: File bí mật đang bị Git theo dõi: ${envTracked.join(', ')}`);
      secOk = false;
    }

    const sbTracked = trackedFiles.filter(f => f.startsWith('storyboards/') && f.endsWith('.json'));
    if (sbTracked.length === 0) {
      console.log(`  [✓] Bản quyền kịch bản (storyboards/*.json): 100% Private (Không leak Git)`);
    } else {
      console.log(`  [✗] LỖI NGUY HIỂM: Có kịch bản riêng tư đang bị Git track: ${sbTracked.join(', ')}`);
      secOk = false;
    }

    const rendersTracked = trackedFiles.filter(f =>
      (f.startsWith('renders/') || f.startsWith('audio/') || f.startsWith('output/')) && !f.endsWith('.gitkeep')
    );
    if (rendersTracked.length === 0) {
      console.log(`  [✓] Thư mục media (renders/*, audio/*, output/*): Không bị commit file rác`);
    } else {
      console.log(`  [✗] LỖI NGUY HIỂM: File media đang bị Git track: ${rendersTracked.slice(0, 3).join(', ')}...`);
      secOk = false;
    }

    // Automated Regex Scan for Private Identifiers / IP Leaks (includes .env.example)
    const leakPatterns = buildLeakPatterns(projectDir);

    const foundLeaks = [];
    for (const file of trackedFiles) {
      if (!file || file === 'engine/doctor.js' || file === '.githooks/pre-commit') continue;
      const fullPath = path.join(projectDir, file);
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
      secOk = false;
    }
  } catch (err) {
    console.log(`  [✗] Không thể kiểm tra Git security status: ${err.message}`);
    secOk = false;
  }
  return secOk;
}

module.exports = {
  runDoctor,
  runSecurityChecks,
  buildLeakPatterns
};


