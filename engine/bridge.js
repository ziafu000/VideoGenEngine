const { execFileSync } = require('child_process');
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

function syncHardenedProxyScript() {
  const proxyScriptSrc = path.join(__dirname, 'cdp_proxy.js');
  const winUser = String(config.WIN_USER || '').replace(/[^a-zA-Z0-9._ -]/g, '');
  const winProxyPath = `/mnt/c/Users/${winUser}/AppData/Local/Google/Chrome/cdp_proxy.js`;
  if (winUser && fs.existsSync(proxyScriptSrc)) {
    try {
      const destDir = path.dirname(winProxyPath);
      if (fs.existsSync('/mnt/c/Users')) {
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
  const { winUser } = syncHardenedProxyScript();
  const running = await isBridgeRunning();
  if (running) {
    console.log(`    [✓] CDP bridge đã sẵn sàng tại ${config.CDP_URL}`);
  } else {
    console.log('    [-] CDP bridge chưa chạy, đang tự động khởi động Chrome và proxy trên Windows...');

    const safeQuote = (val) => String(val || '').replace(/["'`$;|&<>]/g, '');
    const chromeUserData = safeQuote(process.env.CHROME_USER_DATA_DIR);
    const chromeProfile = safeQuote(process.env.CHROME_PROFILE_DIR);
    const chromeFlags = ['--remote-debugging-port=9222', '--remote-debugging-address=127.0.0.1'];
    if (chromeUserData) chromeFlags.push(`--user-data-dir="${chromeUserData}"`);
    if (chromeProfile) chromeFlags.push(`--profile-directory="${chromeProfile}"`);
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
