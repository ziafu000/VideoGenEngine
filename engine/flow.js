const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

async function getFlowClient() {
  const client = await getClientForPage('flow.google.com');
  const winDownloads = config.toWinPath(config.WIN_DOWNLOADS_DIR);
  try {
    await client.send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: winDownloads
    });
    await client.send('Browser.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: winDownloads,
      eventsEnabled: true
    });
  } catch {}
  return client;
}

// 1. Get status of Google Flow UI
async function getStatus() {
  const cdp = await getFlowClient();
  try {
    return await cdp.evaluate(`(() => {
      const pm = document.querySelector('.ProseMirror');
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      const videoTiles = document.querySelectorAll('flow-video-tile');
      const pendingTile = document.querySelector('flow-pending-tile');
      const loading = document.querySelectorAll('mat-progress-spinner, mat-progress-bar, .loading, .spinner');
      const activeChips = Array.from(document.querySelectorAll('flow-character-ingredient-chip')).filter(c => !c.innerText.includes('add'));
      const settingsBtn = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');

      return {
        promptValue: pm ? pm.innerText.trim() : null,
        attachedCharacters: activeChips.map(c => c.innerText.trim()),
        generateBtnReady: genBtn ? !genBtn.disabled : false,
        totalVideoTiles: videoTiles.length,
        isGenerating: !!pendingTile || loading.length > 0,
        currentSettings: settingsBtn ? settingsBtn.innerText.replace(/[\\r\\n]+/g, ' ').trim() : ''
      };
    })()`);
  } finally {
    cdp.close();
  }
}

// 2. Clear attached characters and prompt text
async function clearCharacters() {
  const cdp = await getFlowClient();
  try {
    return await cdp.evaluate(`(() => {
      const cancelButtons = Array.from(document.querySelectorAll('flow-ingredient-bar button, .ingredient-bar button, flow-ingredient-chip button, flow-ingredient-chip mat-icon')).filter(b => 
        b.innerText && (b.innerText.includes('cancel') || b.innerText.includes('close'))
      );
      cancelButtons.forEach(b => b.click());

      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Xoá câu lệnh'));
      if (clearBtn) clearBtn.click();

      const pm = document.querySelector('.ProseMirror');
      if (pm) {
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      return true;
    })()`);
  } finally {
    cdp.close();
  }
}

// 3. Add character ingredient chip (@Character)
async function addCharacter(charName) {
  const cdp = await getFlowClient();
  try {
    const res = await cdp.evaluate(`(async () => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };

      pm.focus();
      document.execCommand('insertText', false, '@');
      await new Promise(r => setTimeout(r, 600));

      // Click tab 'Nhân vật' if available in overlay
      const navItems = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-list-item, .cdk-overlay-pane button, .cdk-overlay-pane span'));
      const charTab = navItems.find(i => (i.innerText || '').includes('Nhân vật'));
      if (charTab) {
        charTab.click();
        await new Promise(r => setTimeout(r, 600));
      }

      const options = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="option"], .cdk-overlay-pane .asset-item'));
      const target = options.find(o => (o.innerText || '').toLowerCase().includes(${JSON.stringify(charName.toLowerCase())}));
      if (!target) return { error: 'Không tìm thấy nhân vật ' + ${JSON.stringify(charName)} + ' trong menu' };
      target.click();

      await new Promise(r => setTimeout(r, 600));
      const insertBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Thêm vào câu lệnh'));
      if (insertBtn) insertBtn.click();

      await new Promise(r => setTimeout(r, 400));
      const chips = Array.from(document.querySelectorAll('.chip-container, flow-character-ingredient-chip, flow-ingredient-chip, .mention-chip')).map(c => c.innerText.trim());
      return { ok: true, character: ${JSON.stringify(charName)}, chipsInPrompt: chips };
    })()`);
    return res;
  } finally {
    cdp.close();
  }
}

// 4. Submit prompt with Zero Physical Descriptors check & chip preservation
async function submitPrompt(promptText) {
  // Pre-flight prompt screening with TypeSafe Jev if available
  try {
    const parsed = jev.screenPrompt(promptText);
    if (parsed.safe === false && parsed.risk_score > 0.70) {
      console.warn(`[!] CẢNH BÁO TYPESAFE JEV: Prompt có rủi ro chính sách cao (${parsed.risk_score}): ${parsed.reason}`);
    }
  } catch {}

  const cdp = await getFlowClient();
  try {
    const inputRes = await cdp.evaluate(`(() => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };
      pm.focus();

      const chips = pm.querySelectorAll('.mention-chip');
      if (chips && chips.length > 0) {
        const lastChip = chips[chips.length - 1];
        const range = document.createRange();
        range.setStartAfter(lastChip);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, ' ' + ${JSON.stringify(promptText)});
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(promptText)});
      }

      pm.dispatchEvent(new Event('input', { bubbles: true }));
      pm.dispatchEvent(new Event('change', { bubbles: true }));
      pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      return {
        ok: true,
        textEntered: pm.innerText.trim().slice(0, 60) + '...',
        chipsCount: pm.querySelectorAll('.mention-chip').length,
        readyToSubmit: genBtn ? !genBtn.disabled : false
      };
    })()`);

    await sleep(1000);

    const clickRes = await cdp.evaluate(`(() => {
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      if (genBtn && !genBtn.disabled) {
        genBtn.click();
        return { submitted: true };
      }
      return { submitted: false, reason: 'Generate button not ready or disabled' };
    })()`);

    // Give 2.5s for Google Flow to register the generation and insert the pending tile
    await sleep(2500);

    return { ...inputRes, ...clickRes };
  } finally {
    cdp.close();
  }
}

// Helper: Classify Google Flow prompt refusal or policy violation using TypeSafe Jev
function classifyPromptRefusal(text) {
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  const res = jev.classify(text, {
    refusal: "prompt was refused, blocked or violates safety policy or community guidelines",
    error: "system error, capacity limit or generation failure occurred",
    neutral: "normal generation or progress status"
  });
  if (res.choice) return res;
  const lower = text.toLowerCase();
  if (lower.includes('không thành công') || lower.includes('vi phạm') || lower.includes('policy') || lower.includes('violate') || lower.includes('blocked') || lower.includes('failed')) {
    return { choice: 'refusal', confidence: 0.9 };
  }
  return { choice: 'neutral', confidence: 0.8 };
}

// 5. Wait for render to complete (pending tile appears then disappears)
async function waitForRender(timeoutSec = 240) {
  const cdp = await getFlowClient();
  try {
    let hasSeenPending = false;
    const start = Date.now();
    process.stdout.write('[-] Đang render trên Google Flow: ');

    while ((Date.now() - start) < timeoutSec * 1000) {
      await sleep(3000);
      const state = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile0 = tiles[0];
        if (!tile0) return { hasPending: false, isReady: false };

        const text = tile0.innerText || '';
        const m = text.match(/\\d+%/);
        const hasVideo = !!tile0.querySelector('video');
        const hasThumb = !!tile0.querySelector('img.thumbnail');
        const hasPending = !!tile0.querySelector('flow-pending-tile');

        const isActivelyPending = (hasPending || !!m) && !hasVideo;
        const isReady = (hasVideo || (hasThumb && !hasPending)) && !isActivelyPending;

        const err = document.querySelector('.error-message, [role="alert"], snack-bar-container, .mat-mdc-snack-bar-container');
        const refusal = Array.from(document.querySelectorAll('*')).find(el => el.innerText && (el.innerText.includes('Không thành công') || el.innerText.includes('vi phạm') || el.innerText.includes('policy') || el.innerText.includes('violate') || el.innerText.includes('failed')));

        return {
          hasPending: isActivelyPending,
          isReady: isReady,
          pct: m ? m[0] : null,
          error: err ? err.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null,
          refusal: refusal ? refusal.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null
        };
      })()`);

      const refusalCandidate = state.refusal || state.error;
      if (refusalCandidate) {
        const jRef = classifyPromptRefusal(refusalCandidate);
        if (jRef.choice === 'refusal' || jRef.choice === 'error') {
          process.stdout.write('\n');
          throw new Error(`Google Flow từ chối câu lệnh chính sách [TypeSafe Jev: ${jRef.choice}]: ${refusalCandidate}`);
        }
      }

      if (state.hasPending) {
        hasSeenPending = true;
        process.stdout.write(state.pct ? `[${state.pct}]` : '*');
      } else if (hasSeenPending && state.isReady) {
        process.stdout.write(' ✓ XONG!\n');
        return true;
      } else {
        process.stdout.write('.');
      }
    }

    process.stdout.write('\n');
    throw new Error(`Timeout ${timeoutSec}s khi chờ Google Flow render!`);
  } finally {
    cdp.close();
  }
}

// Helper: get newest .mp4 in Windows Downloads directory
function getLatestMp4InDownloads() {
  const dir = config.WIN_DOWNLOADS_DIR;
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.mp4') && !f.endsWith('.crdownload'))
    .map(f => {
      const full = path.join(dir, f);
      try {
        return { file: full, name: f, mtime: fs.statSync(full).mtimeMs, size: fs.statSync(full).size };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return files.length > 0 ? files[0] : null;
}

// Helper: check if any Chrome download is currently in progress
function hasActiveCrdownload() {
  const dir = config.WIN_DOWNLOADS_DIR;
  if (!fs.existsSync(dir)) return false;
  return fs.readdirSync(dir).some(f => f.endsWith('.crdownload'));
}

// 6a. Direct signed CDN download (fast 720p source)
async function downloadLatestDirect(targetFile) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cdp = await getFlowClient();
  try {
    let videoSrc = null;
    for (let i = 0; i < 10; i++) {
      videoSrc = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile = tiles.find(t => !t.querySelector('flow-pending-tile')) || tiles[0];
        if (!tile) return null;
        tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const container = tile.querySelector('.container');
        if (container) container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const v = tile.querySelector('video');
        return v && v.src && v.src.startsWith('http') ? v.src : null;
      })()`);

      if (videoSrc) break;
      await sleep(800);
    }

    if (!videoSrc) {
      throw new Error('Không lấy được Direct Signed CDN URL từ thẻ video Flow!');
    }

    console.log(`    [-] Tải nhanh qua Direct CDN (720p): ${videoSrc.slice(0, 60)}...`);
    
    // Lấy cookie xác thực từ Chrome session để curl tải video trực tiếp từ domain flow.google.com mà không bị redirect đăng nhập
    let cookieHeader = '';
    try {
      const cookieRes = await cdp.send('Network.getCookies', { urls: ['https://flow.google.com'] });
      if (cookieRes && cookieRes.cookies && cookieRes.cookies.length > 0) {
        const cookieStr = cookieRes.cookies.map(c => `${c.name}=${c.value}`).join('; ');
        cookieHeader = `-H "Cookie: ${cookieStr}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`;
      }
    } catch {}

    execSync(`curl -s -f -L ${cookieHeader} ${JSON.stringify(videoSrc)} -o ${JSON.stringify(targetFile)}`);

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).size < 1000) {
      throw new Error(`File tải về không hợp lệ hoặc rỗng: ${targetFile}`);
    }
    console.log(`    [✓] Đã lưu video 720p thành công: ${targetFile} (${(fs.statSync(targetFile).size / 1024 / 1024).toFixed(2)} MB)`);
    return targetFile;
  } finally {
    cdp.close();
  }
}

// Helper: Classify Google Flow toast/message using TypeSafe Jev System One
function classifyUpscaleToast(text) {
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  const res = jev.classify(text, {
    in_progress: "video resolution is currently being upscaled or processed in background",
    error: "an error, quota limit, concurrency warning, refusal or failure occurred",
    neutral: "normal page state or confirmation message"
  });
  if (res.choice) return res;
  const lower = text.toLowerCase();
  if (lower.includes('đang tăng') || lower.includes('tăng độ phân giải') || lower.includes('upscaling') || lower.includes('processing')) {
    return { choice: 'in_progress', confidence: 0.9 };
  }
  if (lower.includes('lỗi') || lower.includes('thất bại') || lower.includes('error') || lower.includes('failed') || lower.includes('quá nhiều yêu cầu')) {
    return { choice: 'error', confidence: 0.9 };
  }
  return { choice: 'neutral', confidence: 0.8 };
}

// 6b. Cloud AI Super-Resolution (1080p Full HD upscale & download)
async function downloadCloud1080p(targetFile, timeoutSec = 240) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const beforeFile = getLatestMp4InDownloads();
  const beforeMtime = beforeFile ? beforeFile.mtime : 0;

  console.log('    [-] Kích hoạt Cloud 1080p Super-Resolution trên Google Flow...');
  const cdp = await getFlowClient();
  const winDownloads = config.toWinPath(config.WIN_DOWNLOADS_DIR);
  try {
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winDownloads });
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: winDownloads, eventsEnabled: true });
  } catch {}

  try {
    // 1. Close overlays
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
    await sleep(400);

    // 2. Click Tải xuống -> 1080p
    const triggerRes = await cdp.evaluate(`(async () => {
      const tile = document.querySelector('flow-video-tile');
      if (!tile) return { error: 'Không tìm thấy thẻ video Flow' };

      tile.scrollIntoView({ block: 'center' });
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      let dlBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tải xuống');
      if (!dlBtn) {
        const moreBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tuỳ chọn khác');
        if (moreBtn) {
          moreBtn.click();
          await new Promise(r => setTimeout(r, 400));
          const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
          dlBtn = menuItems.find(i => (i.innerText || '').includes('Tải xuống'));
        }
      }
      if (!dlBtn) return { error: 'Không tìm thấy nút Tải xuống trên thẻ video' };

      dlBtn.click();
      await new Promise(r => setTimeout(r, 600));

      const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
      const b1080 = items.find(b => b.innerText && b.innerText.includes('1080p'));
      if (!b1080) return { error: 'Không tìm thấy mục 1080p trong menu tải xuống' };

      b1080.click();
      await new Promise(r => setTimeout(r, 1000));

      const snack = document.querySelector('snack-bar-container, .mat-mdc-snack-bar-container');
      const toastText = snack ? snack.innerText.replace(/[\\r\\n]+/g, ' ') : null;

      return { ok: true, toast: toastText };
    })()`);

    if (triggerRes && triggerRes.error) {
      throw new Error(triggerRes.error);
    }

    if (triggerRes && triggerRes.toast) {
      const jClass = classifyUpscaleToast(triggerRes.toast);
      if (jClass.choice === 'error') {
        throw new Error(`Google Flow Cloud Upscale báo lỗi: "${triggerRes.toast}"`);
      }
      if (jClass.choice === 'in_progress') {
        console.log(`    [-] [TypeSafe Jev: ${jClass.choice}] Google Flow đang xử lý tăng độ phân giải trên Cloud...`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
      }
    }

    // 3. Poll for upscale completion & download trigger
    const startWait = Date.now();
    let downloadedFile = null;
    process.stdout.write('    [-] Đang chờ Google Cloud hoàn thành 1080p: ');

    while ((Date.now() - startWait) < timeoutSec * 1000) {
      await sleep(10000);

      const current = getLatestMp4InDownloads();
      if (current && current.mtime > beforeMtime + 500 && !hasActiveCrdownload()) {
        downloadedFile = current;
        process.stdout.write(' ✓ XONG!\n');
        break;
      }

      // Re-trigger 1080p click
      const pollRes = await cdp.evaluate(`(async () => {
        const tile = document.querySelector('flow-video-tile');
        if (!tile) return null;
        let dlBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tải xuống');
        if (!dlBtn) {
          const moreBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tuỳ chọn khác');
          if (moreBtn) {
            moreBtn.click();
            await new Promise(r => setTimeout(r, 400));
            const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
            dlBtn = menuItems.find(i => (i.innerText || '').includes('Tải xuống'));
          }
        }
        if (!dlBtn) return null;
        dlBtn.click();
        await new Promise(r => setTimeout(r, 500));

        const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
        const b1080 = items.find(b => b.innerText && b.innerText.includes('1080p'));
        if (!b1080) return null;
        b1080.click();
        await new Promise(r => setTimeout(r, 800));

        const snack = document.querySelector('snack-bar-container, .mat-mdc-snack-bar-container');
        return snack ? snack.innerText.replace(/[\\r\\n]+/g, ' ') : null;
      })()`);

      if (pollRes) {
        const jPoll = classifyUpscaleToast(pollRes);
        if (jPoll.choice === 'error') {
          process.stdout.write('\n');
          throw new Error(`Google Flow Cloud Upscale báo lỗi khi thăm dò: "${pollRes}"`);
        }
        if (jPoll.choice === 'in_progress') {
          process.stdout.write('*');
          await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
        }
      } else {
        process.stdout.write('.');
      }

      await sleep(2000);
      const afterPoll = getLatestMp4InDownloads();
      if (afterPoll && afterPoll.mtime > beforeMtime + 500 && !hasActiveCrdownload()) {
        downloadedFile = afterPoll;
        process.stdout.write(' ✓ XONG!\n');
        break;
      }
    }

    if (!downloadedFile) {
      process.stdout.write('\n');
      throw new Error(`Timeout ${timeoutSec}s khi chờ Google Cloud upscale 1080p`);
    }

    while (hasActiveCrdownload()) {
      await sleep(1000);
    }

    fs.copyFileSync(downloadedFile.file, targetFile);
    const sizeMb = (fs.statSync(targetFile).size / 1024 / 1024).toFixed(2);
    console.log(`    [✓] Đã lưu video 1080p thành công: ${targetFile} (${sizeMb} MB)`);
    return targetFile;
  } finally {
    cdp.close();
  }
}

// 6. Download latest rendered video (Default: 1080p Cloud with safe 720p fallback)
async function downloadLatest(targetFile, options = {}) {
  const resolution = options.resolution || process.env.VIDEOGEN_RESOLUTION || '1080p';
  const timeoutSec = options.timeoutSec || 240;

  if (resolution === '1080p') {
    try {
      return await downloadCloud1080p(targetFile, timeoutSec);
    } catch (err) {
      console.warn(`    [!] Cảnh báo khi tải 1080p Cloud: ${err.message}`);
      console.warn('    [-] Tự động chuyển sang tải bản 720p gốc làm fallback an toàn...');
      return await downloadLatestDirect(targetFile);
    }
  }

  return await downloadLatestDirect(targetFile);
}

module.exports = {
  getStatus,
  clearCharacters,
  addCharacter,
  submitPrompt,
  waitForRender,
  downloadLatest,
  downloadCloud1080p,
  downloadLatestDirect
};
