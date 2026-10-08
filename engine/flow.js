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

// 2. Clear attached characters, prompt text, and dismiss any stale error cards/toasts
async function clearCharacters() {
  const cdp = await getFlowClient();
  try {
    return await cdp.evaluate(`(() => {
      // Dismiss any failed generation cards
      const delBtns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText && (b.innerText.includes('delete_forever') || b.innerText.includes('Xóa') || b.getAttribute('aria-label') === 'Xóa'));
      delBtns.forEach(b => b.click());

      // Dismiss any lingering snackbars / toasts
      const snackDismiss = Array.from(document.querySelectorAll('snack-bar-container button, .mat-mdc-snack-bar-container button')).find(b => b.innerText && (b.innerText.includes('Đóng') || b.innerText.includes('Close')));
      if (snackDismiss) snackDismiss.click();

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
  const lower = text.toLowerCase();
  // Upscaling progress toasts or informational notifications are never prompt refusals
  if (lower.includes('đang tăng') || lower.includes('độ phân giải') || lower.includes('upscaling') || lower.includes('quá trình này có thể mất')) {
    return { choice: 'neutral', confidence: 1.0 };
  }
  const res = jev.classify(text, {
    refusal: "prompt was refused, blocked or violates safety policy or community guidelines",
    error: "system error, capacity limit or generation failure occurred",
    neutral: "normal generation or progress status"
  });
  if (res.choice) return res;
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

        const err = tile0.querySelector('.error-message, [role="alert"]');
        const refusal = tile0.innerText && (tile0.innerText.includes('Không thành công') || tile0.innerText.includes('vi phạm chính sách') || tile0.innerText.includes('policy') || tile0.innerText.includes('violate'))
          ? tile0.innerText
          : null;

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
    .filter(f => f.endsWith('.mp4') && !f.endsWith('.crdownload') && !f.includes('why_videogen'))
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
    
    // Lấy cookie xác thực từ Chrome session nếu cần (chỉ cho flow.google.com, không áp dụng cho signed CDN flow-content.google)
    let cookieHeader = '';
    if (!videoSrc.includes('flow-content.google')) {
      try {
        const cookieRes = await cdp.send('Network.getCookies', { urls: ['https://flow.google.com'] });
        if (cookieRes && cookieRes.cookies && cookieRes.cookies.length > 0) {
          const cookieStr = cookieRes.cookies.map(c => `${c.name}=${c.value}`).join('; ');
          cookieHeader = `-H "Cookie: ${cookieStr}" -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"`;
        }
      } catch {}
    }

    try {
      if (fs.existsSync(targetFile) || fs.lstatSync(targetFile).isSymbolicLink()) {
        fs.unlinkSync(targetFile);
      }
    } catch {}

    try {
      execSync(`curl -s -f -L ${cookieHeader} ${JSON.stringify(videoSrc)} -o ${JSON.stringify(targetFile)}`);
    } catch (curlErr) {
      if (cookieHeader) {
        // Fallback tải trực tiếp không kèm cookie
        execSync(`curl -s -f -L ${JSON.stringify(videoSrc)} -o ${JSON.stringify(targetFile)}`);
      } else {
        throw curlErr;
      }
    }

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
  if (typeof text !== 'string') {
    if (text && typeof text === 'object') {
      text = text.value || text.text || text.message || JSON.stringify(text);
    } else {
      return { choice: 'neutral', confidence: 1.0 };
    }
  }
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

    try {
      if (fs.existsSync(targetFile) || fs.lstatSync(targetFile).isSymbolicLink()) {
        fs.unlinkSync(targetFile);
      }
    } catch {}

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

// 7. Generate image via Google Flow (Nano Banana Pro) with in-browser Base64 fetch & Zero-Dupe Guard
async function generateImage({ prompt, outputPath, seenHashes = null, timeoutSec = 50, retries = 3 }) {
  const cdp = await getClientForPage('flow.google.com');
  const crypto = require('crypto');
  try {
    for (let attempt = 1; attempt <= retries; attempt++) {
      const initialUrls = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('flow-image-tile img, flow-media-tile img')).map(i => i.src).filter(Boolean))()`);
      const initialSet = new Set(initialUrls || []);

      // Focus and clear ProseMirror
      const pmRect = await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        if (!pm) return null;
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + 20), y: Math.round(r.y + 20) };
      })()`);
      if (pmRect) await cdp.clickMouse(pmRect.x, pmRect.y);
      await sleep(80);

      await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      })()`);
      await sleep(100);

      // Insert prompt
      await cdp.send('Input.insertText', { text: prompt });
      await sleep(200);

      // Click generate button or dispatch Enter
      const btnRect = await cdp.evaluate(`(() => {
        const b = document.querySelector('button[aria-label="Bắt đầu tạo"], button.generate-icon-button, button.send-button');
        if (!b || b.disabled) return null;
        const r = b.getBoundingClientRect();
        return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2), disabled: b.disabled };
      })()`);

      if (btnRect && !btnRect.disabled) {
        await cdp.clickMouse(btnRect.x, btnRect.y);
      } else {
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, text: '\r' });
      }

      // Wait for image tile
      const startWait = Date.now();
      let freshUrl = null;
      while (Date.now() - startWait < timeoutSec * 1000) {
        await sleep(2000);
        const poll = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('flow-image-tile img, flow-media-tile img')).map(i => i.src).filter(Boolean))()`);
        const fresh = (poll || []).filter(src => !initialSet.has(src) && src.includes('flow-content.google'));
        if (fresh.length > 0) {
          freshUrl = fresh[0];
          break;
        }
      }

      if (!freshUrl) {
        console.warn(`    └─ [!] Timeout khi chờ ảnh (lần thử ${attempt}/${retries}), đang thử lại...`);
        await sleep(2000);
        continue;
      }

      // Fetch base64 directly inside Chrome session
      const b64 = await cdp.evaluate(`(async (url) => {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(r.result.split(',')[1]);
            r.readAsDataURL(blob);
          });
        } catch { return null; }
      })("${freshUrl}")`);

      if (!b64 || b64.length < 5000) {
        console.warn(`    └─ [!] Dữ liệu base64 ảnh không hợp lệ (lần thử ${attempt}/${retries})...`);
        continue;
      }

      const buf = Buffer.from(b64, 'base64');
      const hash = crypto.createHash('md5').update(buf).digest('hex');

      if (seenHashes && seenHashes.has(hash)) {
        console.warn(`    └─ [!] Phát hiện ảnh trùng lặp (${hash.slice(0, 8)}...), tự động sinh lại...`);
        await sleep(2000);
        continue;
      }

      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outputPath, buf);
      if (seenHashes) seenHashes.add(hash);
      console.log(`    [✓] Đã lưu ảnh Nano Banana Pro: ${outputPath} (${(buf.length / 1024).toFixed(1)} KB, MD5: ${hash.slice(0, 8)})`);
      return { path: outputPath, hash, size: buf.length };
    }
    throw new Error(`Thất bại khi sinh ảnh sau ${retries} lần thử!`);
  } finally {
    cdp.close();
  }
}

module.exports = {
  getStatus,
  clearCharacters,
  addCharacter,
  submitPrompt,
  waitForRender,
  downloadLatest,
  downloadCloud1080p,
  downloadLatestDirect,
  generateImage
};
