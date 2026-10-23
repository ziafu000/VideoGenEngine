const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const { sleep, listPages } = require('./cdp');

async function isBridgeRunning() {
  const candidateUrls = [config.CDP_URL];
  if (process.platform === 'win32' || process.platform === 'darwin' || config.WIN_HOST === '127.0.0.1') {
    for (const port of [9222, 9223]) {
      const localUrl = `http://127.0.0.1:${port}`;
      if (!candidateUrls.includes(localUrl)) {
        candidateUrls.push(localUrl);
      }
    }
  }

  for (const url of candidateUrls) {
    try {
      const res = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        if (config.CDP_URL !== url) {
          config.CDP_URL = url;
          try {
            const parsed = new URL(url);
            if (parsed.port) config.CDP_PORT = parseInt(parsed.port, 10);
          } catch {}
        }
        return true;
      }
    } catch {}
  }
  return false;
}

function syncHardenedProxyScript() {
  const winUser = String(config.WIN_USER || '').replace(/[^a-zA-Z0-9._ -]/g, '');
  if (process.platform === 'darwin') {
    return { winUser, winProxyPath: null };
  }
  const proxyScriptSrc = path.join(__dirname, 'cdp_proxy.js');
  const winProxyPath = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'cdp_proxy.js')
    : `/mnt/c/Users/${winUser}/AppData/Local/Google/Chrome/cdp_proxy.js`;
  if (winUser && fs.existsSync(proxyScriptSrc)) {
    try {
      const destDir = path.dirname(winProxyPath);
      if (process.platform === 'win32' || fs.existsSync('/mnt/c/Users')) {
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(proxyScriptSrc, winProxyPath);
      }
    } catch (e) {
      console.warn('    [!] Không thể copy cdp_proxy.js sang Windows AppData:', e.message);
    }
  }
  return { winUser, winProxyPath };
}

async function ensureBridge() {
  console.log(`[-] [1/3] Kiểm tra kết nối tới CDP bridge (${config.CDP_URL})...`);
  const running = await isBridgeRunning();
  if (running) {
    console.log(`    [✓] CDP bridge đã sẵn sàng tại ${config.CDP_URL}`);
  } else {
    const { winUser } = syncHardenedProxyScript();
    console.log('    [-] CDP bridge chưa chạy, đang tự động khởi động Chrome...');

    const safeQuote = (val) => String(val || '').replace(/["'`$;|&<>]/g, '');
    const chromeUserData = safeQuote(process.env.CHROME_USER_DATA_DIR);
    const chromeProfile = safeQuote(process.env.CHROME_PROFILE_DIR);
    const chromeFlags = ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'];
    if (chromeUserData) chromeFlags.push(`--user-data-dir="${chromeUserData}"`);
    if (chromeProfile) chromeFlags.push(`--profile-directory="${chromeProfile}"`);

    if (process.platform === 'darwin') {
      const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      const defaultMacDataDir = chromeUserData || path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', 'AutomationProfile');
      const macFlags = ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${defaultMacDataDir}`];
      if (chromeProfile) macFlags.push(`--profile-directory=${chromeProfile}`);
      try {
        if (fs.existsSync(macChrome)) {
          const child = spawn(macChrome, macFlags, { detached: true, stdio: 'ignore' });
          child.unref();
        } else {
          execFileSync('open', ['-na', 'Google Chrome', '--args', ...macFlags], { stdio: 'ignore' });
        }
      } catch (err) {
        console.warn('    [!] Lỗi khi khởi động Google Chrome trên macOS:', err.message);
      }
    } else if (process.platform === 'linux' && !fs.existsSync('/mnt/c/Windows') && !process.env.WSL_DISTRO_NAME) {
      const defaultLinuxDataDir = chromeUserData || path.join(os.homedir(), '.config', 'google-chrome-automation');
      const linuxFlags = ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${defaultLinuxDataDir}`];
      if (chromeProfile) linuxFlags.push(`--profile-directory=${chromeProfile}`);
      for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium-browser', 'chromium']) {
        try {
          execFileSync('which', [bin], { stdio: 'ignore', timeout: 500 });
          const child = spawn(bin, linuxFlags, { detached: true, stdio: 'ignore' });
          child.unref();
          break;
        } catch {}
      }
    } else {
      const psChromeArgList = chromeFlags.map(f => `'${f}'`).join(', ');
      const psCmd = `
      $listening = Get-NetTCPConnection -LocalPort 9222 -State Listen -ErrorAction SilentlyContinue
      if (-not $listening) {
          $chromeLnk = if ($env:CHROME_SHORTCUT_PATH -and (Test-Path $env:CHROME_SHORTCUT_PATH)) { $env:CHROME_SHORTCUT_PATH } else { (Get-ChildItem -Path "C:\\Users\\${winUser}\\Desktop\\*Chrome*.lnk" -ErrorAction SilentlyContinue | Select-Object -First 1).FullName }
          if ($chromeLnk -and (Test-Path $chromeLnk)) {
              $sh = New-Object -ComObject WScript.Shell
              $target = $sh.CreateShortcut($chromeLnk)
              $lnkArgs = $target.Arguments
              if ($lnkArgs -notmatch '--remote-debugging-port=') { $lnkArgs += ' --remote-debugging-port=9222' }
              if ($lnkArgs -notmatch '--remote-debugging-address=') { $lnkArgs += ' --remote-debugging-address=127.0.0.1' }
              Start-Process $target.TargetPath -ArgumentList $lnkArgs.Trim()
          } else {
              Start-Process 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' -ArgumentList @(${psChromeArgList})
          }
          Start-Sleep -Seconds 3
      }
      # Find WSL guest IP to explicitly authorize in CDP_ALLOWED_CLIENTS
      $wslHostIp = ${JSON.stringify(String(config.WIN_HOST || ''))}
      $wslGuestIp = ${JSON.stringify(String(config.getWslGuestIp ? config.getWslGuestIp() : ''))}
      if ($wslHostIp) { $env:CDP_PROXY_BIND = $wslHostIp }
      if ($wslGuestIp -and $wslHostIp) {
          $env:CDP_ALLOWED_CLIENTS = "$wslHostIp,$wslGuestIp,127.0.0.1"
      } elseif ($wslHostIp) {
          $env:CDP_ALLOWED_CLIENTS = "$wslHostIp,127.0.0.1"
      }

      $proxyConns = Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue
      $hasHostBind = $false
      foreach ($conn in $proxyConns) {
          if ($conn.LocalAddress -eq '0.0.0.0' -or $conn.LocalAddress -eq '::') {
              Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
          } elseif ($wslHostIp -and $conn.LocalAddress -eq $wslHostIp) {
              $hasHostBind = $true
          }
      }
      if ($wslHostIp -and -not $hasHostBind -and $proxyConns) {
          foreach ($conn in $proxyConns) {
              Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
          }
          Start-Sleep -Milliseconds 300
      }
      $proxyListening = Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue
      if (-not $proxyListening) {
          Start-Process node -ArgumentList "C:\\Users\\${winUser}\\AppData\\Local\\Google\\Chrome\\cdp_proxy.js" -WindowStyle Hidden
      }
    `;

      const psExec = config.getPowerShellCmd();
      try {
        execFileSync(psExec, ['-NoProfile', '-Command', psCmd], { stdio: 'inherit' });
      } catch (err) {
        console.warn('    [!] Lỗi khi chạy powershell khởi động Chrome:', err.message);
      }
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
