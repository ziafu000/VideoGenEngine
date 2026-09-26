const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { sleep, listPages } = require('./cdp');

async function isBridgeRunning() {
  try {
    const res = await fetch(`${config.CDP_URL}/json/version`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureBridge() {
  console.log(`[-] [1/3] Kiểm tra kết nối tới CDP bridge (${config.CDP_URL})...`);
  const running = await isBridgeRunning();
  if (running) {
    console.log(`    [✓] CDP bridge đã sẵn sàng tại ${config.CDP_URL}`);
  } else {
    console.log('    [-] CDP bridge chưa chạy, đang tự động khởi động Chrome và proxy trên Windows...');

    // Copy proxy script to Windows if needed
    const proxyScriptSrc = path.join(__dirname, 'cdp_proxy.js');
    const winUser = process.env.WIN_USERNAME || 'ASUS';
    const winProxyPath = `/mnt/c/Users/${winUser}/AppData/Local/Google/Chrome/cdp_proxy.js`;
    if (fs.existsSync(proxyScriptSrc)) {
      try {
        fs.copyFileSync(proxyScriptSrc, winProxyPath);
      } catch (e) {
        console.warn('    [!] Không thể copy cdp_proxy.js sang Windows AppData:', e.message);
      }
    }

    const chromeUserData = process.env.CHROME_USER_DATA_DIR;
    const chromeProfile = process.env.CHROME_PROFILE_DIR;
    let extraChromeArgs = '';
    if (chromeUserData) extraChromeArgs += `, '--user-data-dir=\"${chromeUserData}\"'`;
    if (chromeProfile) extraChromeArgs += `, '--profile-directory=\"${chromeProfile}\"'`;

    const psCmd = `
      $listening = Get-NetTCPConnection -LocalPort 9222 -ErrorAction SilentlyContinue
      if (-not $listening) {
          Start-Process 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' -ArgumentList '--remote-debugging-port=9222'${extraChromeArgs}
          Start-Sleep -Seconds 3
      }
      $proxyListening = Get-NetTCPConnection -LocalPort 9223 -ErrorAction SilentlyContinue
      if (-not $proxyListening) {
          Start-Process node -ArgumentList "C:\\Users\\${winUser}\\AppData\\Local\\Google\\Chrome\\cdp_proxy.js" -WindowStyle Hidden
      }
    `;

    try {
      execSync(`powershell.exe -NoProfile -Command '${psCmd.replace(/'/g, "''")}'`, { stdio: 'inherit' });
    } catch (err) {
      console.warn('    [!] Lỗi khi chạy powershell khởi động Chrome:', err.message);
    }

    console.log('    [-] Đang chờ CDP bridge phản hồi...');
    let connected = false;
    for (let i = 0; i < 15; i++) {
      await sleep(1000);
      if (await isBridgeRunning()) {
        connected = true;
        break;
      }
    }

    if (!connected) {
      throw new Error(`Không thể kết nối tới CDP bridge tại ${config.CDP_URL} sau 15 giây!`);
    }
    console.log(`    [✓] Kết nối thành công tới CDP bridge!`);
  }

  // Check required tabs
  console.log(`[-] [2/3] Kiểm tra các tab cần thiết trong Chrome...`);
  const pages = await listPages();
  const pageUrls = pages.filter(p => p.type === 'page').map(p => p.url);

  // Check Google Flow
  if (!pageUrls.some(u => u.includes('flow.google.com'))) {
    console.log('    [-] Tự động mở tab Google Flow...');
    await fetch(`${config.CDP_URL}/json/new?https://flow.google.com`, { method: 'PUT' });
    await sleep(2000);
  } else {
    console.log('    [✓] Tab Google Flow đã mở');
  }

  // Check ElevenLabs
  if (!pageUrls.some(u => u.includes('elevenlabs.io'))) {
    console.log('    [-] Tự động mở tab ElevenLabs...');
    await fetch(`${config.CDP_URL}/json/new?https://elevenlabs.io/app/speech-synthesis/text-to-speech`, { method: 'PUT' });
    await sleep(2000);
  } else {
    console.log('    [✓] Tab ElevenLabs đã mở');
  }

  console.log(`[-] [3/3] Danh sách các tab đang kết nối:`);
  const updatedPages = await listPages();
  for (const p of updatedPages.filter(p => p.type === 'page')) {
    console.log(`    - [${p.id}] ${p.title} (${p.url.slice(0, 70)}...)`);
  }
}

async function status() {
  const running = await isBridgeRunning();
  console.log(`=== CDP BRIDGE STATUS ===`);
  console.log(`URL: ${config.CDP_URL}`);
  console.log(`Trạng thái: ${running ? 'ĐANG HOẠT ĐỘNG (READY)' : 'CHƯA KẾT NỐI (OFFLINE)'}`);
  if (running) {
    const pages = await listPages();
    console.log(`Tổng số tabs: ${pages.filter(p => p.type === 'page').length}`);
    for (const p of pages.filter(p => p.type === 'page')) {
      console.log(`  * ${p.title} -> ${p.url}`);
    }
  }
}

module.exports = {
  isBridgeRunning,
  ensureBridge,
  status
};
