const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

async function getFlowClient(existingCdp = null) {
  if (existingCdp && typeof existingCdp.isOpen === 'function' && existingCdp.isOpen()) {
    existingCdp.retain();
    return existingCdp;
  }
  const client = await getClientForPage('flow.google.com');
  await client.send('Page.bringToFront').catch(() => {});
  const winDownloads = config.toWinPath(config.WIN_DOWNLOADS_DIR);
  if (client._downloadBehaviorDir !== winDownloads) {
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
      client._downloadBehaviorDir = winDownloads;
    } catch {}
  }
  return client;
}

/**
 * Prune stale offscreen DOM tiles, unload background media elements, and release V8 RemoteObject handles
 * to prevent DOM/Base64 memory bloat during multi-hundred-shot batch runs.
 */
async function pruneFlowDomMemory(cdp, maxTiles = 12) {
  if (!cdp || (typeof cdp.isOpen === 'function' && !cdp.isOpen())) return;
  try {
    await cdp.evaluate(`((limit) => {
      const videoTiles = Array.from(document.querySelectorAll('flow-video-tile'));
      for (let i = limit; i < videoTiles.length; i++) {
        const tile = videoTiles[i];
        const vids = tile.querySelectorAll('video');
        vids.forEach(v => {
          try {
            v.pause();
            v.removeAttribute('src');
            v.load();
          } catch {}
        });
        const imgs = tile.querySelectorAll('img');
        imgs.forEach(img => {
          try { img.removeAttribute('src'); } catch {}
        });
      }
      const imageTiles = Array.from(document.querySelectorAll('flow-image-tile, flow-media-tile'));
      for (let i = limit; i < imageTiles.length; i++) {
        const tile = imageTiles[i];
        const imgs = tile.querySelectorAll('img');
        imgs.forEach(img => {
          try { img.removeAttribute('src'); } catch {}
        });
      }
      return true;
    })(${Number(maxTiles) || 12})`);
  } catch {}
  if (typeof cdp.releaseMemory === 'function') {
    await cdp.releaseMemory();
  }
}

// 1. Get status of Google Flow UI
async function getStatus(options = {}) {
  const cdp = await getFlowClient(options.cdp);
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
async function clearCharacters(options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    return await cdp.evaluate(`(async () => {
      // Dismiss any failed generation cards only (never delete valid tiles or assets)
      const errTiles = Array.from(document.querySelectorAll('flow-error-tile'));
      errTiles.forEach(t => {
        const delBtns = Array.from(t.querySelectorAll('button')).filter(b => {
          const txt = (b.innerText || b.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || '').trim();
          return txt.includes('delete_forever') || txt.includes('Xóa') || txt.includes('Xoá') || aria === 'Xóa' || aria === 'Xoá';
        });
        delBtns.forEach(b => b.click());
      });
      if (errTiles.length > 0) {
        await new Promise(r => setTimeout(r, 600));
      }

      // Dismiss any lingering snackbars / toasts
      const snackDismiss = Array.from(document.querySelectorAll('snack-bar-container button, .mat-mdc-snack-bar-container button')).find(b => b.innerText && (b.innerText.includes('Đóng') || b.innerText.includes('Close')));
      if (snackDismiss) snackDismiss.click();

      const cancelButtons = Array.from(document.querySelectorAll('flow-ingredient-bar button, .ingredient-bar button, flow-ingredient-chip button, flow-ingredient-chip mat-icon, flow-character-ingredient-chip button, flow-character-ingredient-chip mat-icon')).filter(b => 
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
async function addCharacter(charName, options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    const res = await cdp.evaluate(`(async () => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };

      pm.focus();
      const p = pm.querySelector('p') || pm;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      if (pm.querySelectorAll('.mention-chip').length > 0 && !p.innerText.endsWith(' ')) {
        document.execCommand('insertText', false, ' ');
      }
      document.execCommand('insertText', false, '@');
      await new Promise(r => setTimeout(r, 750));

      // Click tab 'Nhân vật' if available in overlay
      const navItems = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-list-item, .cdk-overlay-pane button, .cdk-overlay-pane span'));
      const charTab = navItems.find(i => (i.innerText || '').includes('Nhân vật'));
      if (charTab) {
        charTab.click();
        await new Promise(r => setTimeout(r, 750));
      }

      const cleanName = ${JSON.stringify(charName.replace(/^@/, '').toLowerCase())};
      let options = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="option"], .cdk-overlay-pane .asset-item, .cdk-overlay-pane .character-tile-container'));
      let target = options.find(o => (o.innerText || '').trim().toLowerCase() === cleanName) ||
                   options.find(o => (o.innerText || '').toLowerCase().includes(cleanName));
      if (!target) {
        const searchInput = document.querySelector('.cdk-overlay-pane input[placeholder*="Tìm kiếm"], .cdk-overlay-pane input[placeholder*="Search"], .cdk-overlay-pane input');
        if (searchInput) {
          searchInput.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(searchInput, cleanName);
          else searchInput.value = cleanName;
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 450));
          options = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="option"], .cdk-overlay-pane .asset-item, .cdk-overlay-pane .character-tile-container'));
          target = options.find(o => (o.innerText || '').trim().toLowerCase() === cleanName) ||
                   options.find(o => (o.innerText || '').toLowerCase().includes(cleanName));
        }
      }
      if (!target) return { error: 'Không tìm thấy nhân vật ' + ${JSON.stringify(charName)} + ' trong menu' };
      target.click();

      await new Promise(r => setTimeout(r, 650));
      const insertBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Thêm vào câu lệnh'));
      if (insertBtn) insertBtn.click();

      // Wait for overlay to close and mention-chip to settle in live ProseMirror (up to 2.0s)
      for (let w = 0; w < 14; w++) {
        await new Promise(r => setTimeout(r, 150));
        const mChips = Array.from(document.querySelectorAll('.ProseMirror .mention-chip')).map(c => c.innerText.trim().toLowerCase());
        if (mChips.includes(cleanName)) break;
      }
      await new Promise(r => setTimeout(r, 250));

      const chips = Array.from(document.querySelectorAll('.ProseMirror .mention-chip')).map(c => c.innerText.trim());
      const ingCount = document.querySelectorAll('flow-character-ingredient-chip').length;
      return { ok: true, character: ${JSON.stringify(charName)}, chipsInPrompt: chips, ingCount };
    })()`);
    return res;
  } finally {
    cdp.close();
  }
}

// 4. Submit prompt with Zero Physical Descriptors check & chip preservation
async function submitPrompt(promptText, options = {}) {
  // Pre-flight prompt screening with TypeSafe Jev if available
  try {
    const parsed = jev.screenPrompt(promptText);
    if (parsed.safe === false && parsed.risk_score > 0.70) {
      console.warn(`[!] CẢNH BÁO TYPESAFE JEV: Prompt có rủi ro chính sách cao (${parsed.risk_score}): ${parsed.reason}`);
    }
  } catch {}

  // Pre-flight Timeline Prompting syntax check for multi-second video clips
  const hasTimelineMarkers = /\[?\b\d+(\.\d+)?s?\s*[-–—]\s*\d+(\.\d+)?s?\]?/i.test(promptText);
  if (!hasTimelineMarkers && promptText.length > 60 && !promptText.includes('NO TITLE BANNER')) {
    console.warn(`[!] [SOP TIMELINE PROMPTING] Lưu ý: Prompt video chưa chứa mốc thời gian (ví dụ: [0.0s - 3.0s]). Đảm bảo áp dụng Timeline Prompting theo WORKFLOW.md §8.10 để tối ưu camera choreography.`);
  }

  const cdp = await getFlowClient(options.cdp);
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
async function waitForRender(timeoutSec = 240, options = {}) {
  const cdp = await getFlowClient(options.cdp);
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
        const m = text.match(/\\b(\\d{1,3})%/);
        const pctNum = m ? parseInt(m[1], 10) : null;
        const realVideo = Array.from(tile0.querySelectorAll('video')).find(v => !v.closest('flow-pending-tile') && v.src && v.src.includes('flow-content.google'));
        const hasVideo = !!realVideo;
        const hasThumb = !!tile0.querySelector('img.thumbnail');
        const tile0Pending = tile0.querySelectorAll('flow-pending-tile').length > 0;

        const isActivelyPending = (tile0Pending || (pctNum !== null && pctNum < 100)) && !(hasVideo && pctNum === 100);
        const isReady = (hasVideo || hasThumb) && !isActivelyPending;

        const err = tile0.querySelector('.error-message, [role="alert"]');
        const refusal = tile0.innerText && (tile0.innerText.includes('Không thành công') || tile0.innerText.includes('vi phạm chính sách') || tile0.innerText.includes('policy') || tile0.innerText.includes('violate'))
          ? tile0.innerText
          : null;

        return {
          hasPending: isActivelyPending,
          isReady: isReady,
          pct: m ? m[0] : null,
          error: err ? err.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null,
          refusal: refusal ? refusal.trim().replace(/[\\r\\n]+/g, ' ') : null
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
async function downloadLatestDirect(targetFile, options = {}) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cdp = await getFlowClient(options.cdp);
  try {
    let videoSrc = null;
    for (let i = 0; i < 12; i++) {
      const tileRect = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile = tiles[0];
        if (!tile || tile.querySelector('flow-pending-tile')) return null;
        tile.scrollIntoView({ block: 'center' });
        const r = tile.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      if (tileRect) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.max(10, tileRect.x - 15), y: Math.max(10, tileRect.y - 15) });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tileRect.x, y: tileRect.y });
        await sleep(500);
      }

      videoSrc = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile = tiles[0];
        if (!tile || tile.querySelector('flow-pending-tile')) return null;
        tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const container = tile.querySelector('.container');
        if (container) container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const v = Array.from(tile.querySelectorAll('video')).find(el => !el.closest('flow-pending-tile') && el.src && (el.src.includes('flow-content.google') || (!el.src.includes('/asb/') && el.src.startsWith('http'))));
        return v ? v.src : null;
      })()`);

      if (videoSrc) break;
      await sleep(700);
    }

    if (!videoSrc) {
      throw new Error('Không lấy được Direct Signed CDN URL từ thẻ video Flow!');
    }

    // Validate target URL origin (A04)
    let parsedUrl;
    try {
      parsedUrl = new URL(videoSrc);
    } catch {
      throw new Error(`Đường dẫn video không hợp lệ: ${videoSrc}`);
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Giao thức không an toàn: ${parsedUrl.protocol}`);
    }
    const isGoogleFlow = parsedUrl.hostname === 'flow-content.google' ||
                         parsedUrl.hostname === 'flow.google.com' ||
                         parsedUrl.hostname.endsWith('.google.com') ||
                         parsedUrl.hostname.endsWith('.googleusercontent.com');
    if (!isGoogleFlow) {
      throw new Error(`Origin video không được tin cậy (chỉ chấp nhận domain Google Flow): ${parsedUrl.hostname}`);
    }

    console.log(`    [-] Tải nhanh qua Direct CDN (720p): ${videoSrc.slice(0, 60)}...`);

    // Lấy cookie xác thực từ Chrome session CHỈ KHI host thực sự là flow.google.com (A04)
    let cookieArgs = [];
    if (parsedUrl.hostname === 'flow.google.com') {
      try {
        const cookieRes = await cdp.send('Network.getCookies', { urls: ['https://flow.google.com'] });
        if (cookieRes && cookieRes.cookies && cookieRes.cookies.length > 0) {
          const cookieStr = cookieRes.cookies.map(c => `${c.name}=${c.value}`).join('; ');
          cookieArgs = [
            '-H', `Cookie: ${cookieStr}`,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          ];
        }
      } catch {}
    }

    try {
      if (fs.existsSync(targetFile) || fs.lstatSync(targetFile).isSymbolicLink()) {
        fs.unlinkSync(targetFile);
      }
    } catch {}

    try {
      execFileSync('curl', ['-s', '-f', '-L', '--max-time', '120', ...cookieArgs, videoSrc, '-o', targetFile]);
    } catch (curlErr) {
      if (cookieArgs.length > 0) {
        // Fallback tải trực tiếp không kèm cookie
        execFileSync('curl', ['-s', '-f', '-L', '--max-time', '120', videoSrc, '-o', targetFile]);
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
async function downloadCloud1080p(targetFile, timeoutSec = 240, options = {}) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const beforeFile = getLatestMp4InDownloads();
  const beforeMtime = beforeFile ? beforeFile.mtime : 0;

  console.log('    [-] Kích hoạt Cloud 1080p Super-Resolution trên Google Flow...');
  const cdp = await getFlowClient(options.cdp);

  try {
    // 1. Close overlays
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
    await sleep(400);

    // 2. Click Tải xuống -> 1080p
    const tileRect = await cdp.evaluate(`(() => {
      const tile = document.querySelector('flow-video-tile');
      if (!tile) return null;
      tile.scrollIntoView({ block: 'center' });
      const r = tile.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    })()`);
    if (tileRect) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tileRect.x, y: tileRect.y });
      await sleep(450);
    }

    const triggerRes = await cdp.evaluate(`(async () => {
      const tile = document.querySelector('flow-video-tile');
      if (!tile) return { error: 'Không tìm thấy thẻ video Flow' };

      tile.scrollIntoView({ block: 'center' });
      tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

      let dlBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tải xuống');
      if (!dlBtn) {
        const moreBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tuỳ chọn khác' || (b.innerText || '').includes('more_vert'));
        if (moreBtn) {
          moreBtn.click();
          await new Promise(r => setTimeout(r, 500));
          const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
          dlBtn = menuItems.find(i => (i.innerText || '').includes('Tải xuống'));
        }
      }
      if (!dlBtn) return { error: 'Không tìm thấy nút Tải xuống trên thẻ video' };

      dlBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
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
      return await downloadCloud1080p(targetFile, timeoutSec, options);
    } catch (err) {
      console.warn(`    [!] Cảnh báo khi tải 1080p Cloud: ${err.message}`);
      console.warn('    [-] Tự động chuyển sang tải bản 720p gốc làm fallback an toàn...');
      return await downloadLatestDirect(targetFile, options);
    }
  }

  return await downloadLatestDirect(targetFile, options);
}

// 7. Ensure Flow Settings (Model, Mode, Aspect Ratio)
async function ensureFlowSettings({ mode = 'image', ratio = '16:9', model = 'Nano Banana Pro', cdp: existingCdp = null } = {}) {
  const cdp = await getFlowClient(existingCdp);
  const settingsKey = `${mode}:${ratio}:${model}`;
  try {
    const triggerExists = await cdp.evaluate(`(() => {
      return !!document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
    })()`);
    if (!triggerExists) {
      throw new Error('[Flow Preflight Error] Không tìm thấy settings trigger button trên giao diện Flow (DOM rỗng hoặc chưa tải xong).');
    }

    const curSettings = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    const hasBanana = curSettings.includes('Banana');
    const hasRatio = ratio === '16:9' ? (curSettings.includes('crop_16_9') || curSettings.includes('16:9')) : (curSettings.includes('crop_9_16') || curSettings.includes('9:16'));
    const hasPro = model === 'Nano Banana Pro' ? curSettings.includes('Pro') : true;

    if (hasBanana && hasRatio && hasPro) {
      cdp._verifiedFlowSettings = settingsKey;
      return true;
    }

    console.log(`    [-] [Flow Preflight] Tự động cấu hình chuẩn giao diện Flow: ${model} | ${ratio}...`);

    await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      if (b) b.click();
    })()`);
    await sleep(600);

    if (mode === 'image') {
      await cdp.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-button-toggle, .cdk-overlay-pane button, [role="radio"]'));
        const imgBtn = btns.find(b => (b.innerText || '').includes('Hình ảnh') || (b.innerText || '').includes('Image'));
        if (imgBtn) imgBtn.click();
      })()`);
      await sleep(500);
    }

    await cdp.evaluate(`((targetRatio) => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-button-toggle, .cdk-overlay-pane button, [role="radio"]'));
      const ratioBtn = btns.find(b => (b.innerText || '').includes(targetRatio));
      if (ratioBtn) ratioBtn.click();
    })(${JSON.stringify(ratio)})`);
    await sleep(500);

    if (model === 'Nano Banana Pro') {
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('button[aria-label="Chọn nhóm mô hình"], .model-select-trigger-content, [aria-label*="model"]');
        if (btn) btn.click();
      })()`);
      await sleep(600);

      await cdp.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane mat-option'));
        const proItem = items.find(i => (i.innerText || '').toLowerCase().includes('pro'));
        if (proItem) proItem.click();
      })()`);
      await sleep(500);
    }

    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' });
    await sleep(500);

    const verified = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    if (!verified || (!verified.includes('Banana') && !verified.includes('Pro') && !verified.includes('crop'))) {
      throw new Error(`[Flow Preflight Error] Cài đặt hình ảnh chưa được xác nhận trên giao diện: "${verified || 'DOM trống'}"`);
    }

    cdp._verifiedFlowSettings = settingsKey;
    console.log(`    [✓] [Flow Preflight] Đã kích hoạt cấu hình Flow chuẩn: "${verified}"`);
    return true;
  } finally {
    cdp.close();
  }
}

// 7b. Ensure Flow Video Settings (Duration, Ratio, Model) with Fail-Closed Verification (A11)
async function ensureVideoSettings({ ratio = '9:16', duration = '10 giây', model = 'Omni 1.1 Flash', cdp: existingCdp = null } = {}) {
  const cdp = await getFlowClient(existingCdp);
  const settingsKey = `video:${ratio}:${duration}:${model}`;
  try {
    // Ensure 'Tất cả nội dung nghe nhìn' (All media) tab is selected so flow-video-tile elements render in viewport
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('flow-project-nav-list mat-list-item, .mdc-list-item'));
      const allMedia = items.find(i => (i.innerText || '').includes('Tất cả nội dung') || (i.innerText || '').includes('All media'));
      if (allMedia && !allMedia.classList.contains('mdc-list-item--activated')) {
        allMedia.click();
      }
      const vp = document.querySelector('cdk-virtual-scroll-viewport');
      if (vp) vp.scrollTop = 0;
    })()`);

    const triggerExists = await cdp.evaluate(`(() => {
      if (document.querySelector('.settings-trigger-button, button.prompt-settings-trigger')) return true;
      const createBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText && (b.innerText.includes('Start Creating') || b.innerText.includes('Dự án mới') || b.innerText.includes('New Project')));
      if (createBtn) { createBtn.click(); return 'clicked_create'; }
      return false;
    })()`);
    if (triggerExists === 'clicked_create') {
      await sleep(3500);
    } else if (!triggerExists) {
      throw new Error('[Flow Preflight Error] Không tìm thấy settings trigger button trên giao diện Flow (DOM rỗng hoặc chưa tải xong).');
    }

    const curSettings = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    const hasVideo = curSettings.includes('Video') || curSettings.includes('videocam');
    const hasDuration = curSettings.includes(duration) || (duration.includes('10') && curSettings.includes('10'));
    const hasRatio = ratio === '9:16' ? (curSettings.includes('crop_9_16') || curSettings.includes('9:16')) : (curSettings.includes('crop_16_9') || curSettings.includes('16:9'));

    if (hasVideo && hasDuration && hasRatio) {
      cdp._verifiedFlowSettings = settingsKey;
      return true;
    }

    console.log(`    [-] [Flow Preflight] Tự động cấu hình chuẩn video Flow: ${duration} | ${ratio} (${model})...`);

    const rect = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()`);
    if (rect) {
      await cdp.clickMouse(rect.x, rect.y);
    } else {
      await cdp.evaluate(`(() => {
        const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
        if (b) b.click();
      })()`);
    }
    await sleep(600);

    // Switch to Video mode via native mouse click or fallback
    const vidCoords = await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
      const vidBtn = btns.find(b => (b.innerText || '').includes('Video') || (b.innerText || '').includes('videocam'));
      if (!vidBtn) return null;
      const r = vidBtn.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })()`);
    if (vidCoords && typeof cdp.clickMouse === 'function') {
      await cdp.clickMouse(vidCoords.x, vidCoords.y);
    } else {
      await cdp.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
        const vidBtn = btns.find(b => (b.innerText || '').includes('Video') || (b.innerText || '').includes('videocam'));
        if (vidBtn) vidBtn.click();
      })()`);
    }
    await sleep(500);

    // Select Ratio (9:16 or 16:9)
    const ratioCoords = await cdp.evaluate(`((targetRatio) => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
      const rBtn = btns.find(b => (b.innerText || '').includes(targetRatio));
      if (!rBtn) return null;
      const r = rBtn.getBoundingClientRect();
      return (r.width > 0 && r.height > 0) ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
    })(${JSON.stringify(ratio)})`);
    if (ratioCoords && typeof cdp.clickMouse === 'function') {
      await cdp.clickMouse(ratioCoords.x, ratioCoords.y);
    } else {
      await cdp.evaluate(`((targetRatio) => {
        const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
        const rBtn = btns.find(b => (b.innerText || '').includes(targetRatio));
        if (rBtn) rBtn.click();
      })(${JSON.stringify(ratio)})`);
    }
    await sleep(500);

    // Select Duration & Count x1
    const durCoords = await cdp.evaluate(`((targetDuration) => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
      const dBtn = btns.find(b => (b.innerText || '').includes(targetDuration) || (b.innerText || '').includes('10s'));
      const x1Btn = btns.find(b => (b.innerText || '').trim() === 'x1');
      const getPt = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return (r.width > 0 && r.height > 0) ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null;
      };
      return { dPt: getPt(dBtn), x1Pt: getPt(x1Btn) };
    })(${JSON.stringify(duration)})`);
    if (durCoords && durCoords.dPt && typeof cdp.clickMouse === 'function') {
      await cdp.clickMouse(durCoords.dPt.x, durCoords.dPt.y);
      await sleep(300);
      if (durCoords.x1Pt) await cdp.clickMouse(durCoords.x1Pt.x, durCoords.x1Pt.y);
    } else {
      await cdp.evaluate(`((targetDuration) => {
        const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="radio"]'));
        const dBtn = btns.find(b => (b.innerText || '').includes(targetDuration) || (b.innerText || '').includes('10s'));
        if (dBtn) dBtn.click();
        const x1Btn = btns.find(b => (b.innerText || '').trim() === 'x1');
        if (x1Btn) x1Btn.click();
      })(${JSON.stringify(duration)})`);
    }
    await sleep(500);

    // Close overlay
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' });
    await sleep(500);

    const verified = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    if (!verified || (!verified.includes('Video') && !verified.includes('videocam') && !verified.includes('crop') && !verified.includes('10'))) {
      throw new Error(`[Flow Preflight Error] Cài đặt Video chưa được xác nhận trên giao diện: "${verified || 'DOM trống'}"`);
    }

    cdp._verifiedFlowSettings = settingsKey;
    console.log(`    [✓] [Flow Preflight] Đã kích hoạt cấu hình Video Flow chuẩn: "${verified.replace(/\\n/g, ' ')}"`);
    return true;
  } finally {
    cdp.close();
  }
}

// 8. Generate image via Google Flow (Nano Banana Pro) with in-browser Base64 fetch & Zero-Dupe Guard
async function generateImage({ prompt, outputPath, seenHashes = null, timeoutSec = 80, retries = 3, cdp: existingCdp = null }) {
  const cdp = await getFlowClient(existingCdp);
  try {
    await ensureFlowSettings({ mode: 'image', ratio: '16:9', model: 'Nano Banana Pro', cdp });
    for (let attempt = 1; attempt <= retries; attempt++) {
      // Wait for any pre-existing pending tile from previous shot to complete
      for (let w0 = 0; w0 < 45; w0++) {
        const stillPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (!stillPending) break;
        await sleep(1000);
      }

      const initialUrls = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('flow-image-tile img, flow-media-tile img')).slice(0, 12).map(i => i.src).filter(Boolean))()`);
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
      await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        if (pm) {
          pm.dispatchEvent(new Event('input', { bubbles: true }));
          pm.dispatchEvent(new Event('change', { bubbles: true }));
          pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
      })()`);
      await sleep(350);

      // Wait for Angular to enable the generate button and click it via CDP native mouse event
      let btnRect = null;
      for (let w = 0; w < 15; w++) {
        await sleep(150);
        btnRect = await cdp.evaluate(`(() => {
          const b = document.querySelector('button[aria-label="Bắt đầu tạo"], button.generate-icon-button');
          if (!b || b.disabled || b.classList.contains('mat-mdc-button-disabled')) return null;
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
        })()`);
        if (btnRect) break;
      }

      if (btnRect) {
        await cdp.clickMouse(btnRect.x, btnRect.y);
      } else {
        // Fallback: send Enter key
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, text: '\r' });
      }

      // Wait for pending tile to appear
      let hasPending = false;
      for (let p = 0; p < 8; p++) {
        await sleep(250);
        hasPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (hasPending) break;
      }
      if (!hasPending && btnRect) {
        await cdp.clickMouse(btnRect.x, btnRect.y);
      }

      // Wait for generation to complete (pending tile disappears)
      const startWait = Date.now();
      let freshUrl = null;
      let seenPending = hasPending;

      while (Date.now() - startWait < timeoutSec * 1000) {
        await sleep(1500);

        // Track pending state
        const curPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (curPending) seenPending = true;

        // Check for error tile or rate limit card
        const errText = await cdp.evaluate(`(() => {
          const cards = document.querySelectorAll('flow-error-tile, [class*="error"], mat-card');
          for (const c of cards) {
            if (c.innerText && (c.innerText.includes('Không thành công') || c.innerText.includes('hoạt động bất thường') || c.innerText.includes('unusual activity'))) {
              return c.innerText;
            }
          }
          return null;
        })()`);

        if (errText) {
          console.warn(`    └─ [!] Phát hiện cảnh báo giãn cách Google Flow ("${errText.replace(/\\n/g, ' ').slice(0, 50)}..."), tạm dừng 10s và tải lại trang...`);
          await sleep(10000);
          try {
            cdp._verifiedFlowSettings = null;
            await cdp.send('Page.reload');
            await sleep(5000);
            await ensureFlowSettings({ mode: 'image', ratio: '16:9', model: 'Nano Banana Pro', cdp });
          } catch {}
          break;
        }

        // Only consider the top tile completed when flow-pending-tile has vanished from the FIRST tile
        const topTileResult = await cdp.evaluate(`(() => {
          const firstTile = document.querySelector('flow-image-tile');
          if (!firstTile) return null;
          const pending = firstTile.querySelector('flow-pending-tile');
          if (pending) return { pending: true, src: null };
          const img = firstTile.querySelector('img');
          return {
            pending: false,
            src: (img && img.src && img.src.includes('flow-content.google')) ? img.src : null
          };
        })()`);

        if (topTileResult && !topTileResult.pending && topTileResult.src) {
          if (!initialSet.has(topTileResult.src)) {
            freshUrl = topTileResult.src;
            break;
          }
        }
      }

      if (!freshUrl) {
        console.warn(`    └─ [!] Timeout khi chờ ảnh (lần thử ${attempt}/${retries}), đang thử lại...`);
        await sleep(2000);
        continue;
      }

      // Fetch base64 directly inside Chrome session without split() array duplication
      let b64 = await cdp.evaluate(`(async (url) => {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => {
              const res = typeof r.result === 'string' ? r.result : '';
              const commaIdx = res.indexOf(',');
              r.onloadend = null;
              r.onerror = null;
              resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
            };
            r.onerror = () => {
              r.onloadend = null;
              r.onerror = null;
              resolve(null);
            };
            r.readAsDataURL(blob);
          });
        } catch { return null; }
      })(${JSON.stringify(freshUrl)})`);

      if (!b64 || b64.length < 5000) {
        b64 = null;
        console.warn(`    └─ [!] Dữ liệu base64 ảnh không hợp lệ (lần thử ${attempt}/${retries})...`);
        continue;
      }

      const buf = Buffer.from(b64, 'base64');
      b64 = null; // Free Base64 string reference immediately to prevent heap bloat
      const hash = crypto.createHash('md5').update(buf).digest('hex');

      if (seenHashes && seenHashes.has(hash)) {
        console.warn(`    └─ [!] Phát hiện ảnh trùng lặp (${hash.slice(0, 8)}...), tự động sinh lại...`);
        await sleep(2000);
        continue;
      }

      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outputPath, buf);
      const byteSize = buf.length;
      if (seenHashes) seenHashes.add(hash);
      await pruneFlowDomMemory(cdp);
      console.log(`    [✓] Đã lưu ảnh Nano Banana Pro: ${outputPath} (${(byteSize / 1024).toFixed(1)} KB, MD5: ${hash.slice(0, 8)})`);
      return { path: outputPath, hash, size: byteSize };
    }
    throw new Error(`Thất bại khi sinh ảnh sau ${retries} lần thử!`);
  } finally {
    cdp.close();
  }
}

/**
 * Batch render all shots of a storyboard with cache checks, MD5 duplicate guards, and shared CDP session reuse.
 */
async function renderStoryboard(sb, options = {}) {
  const {
    resolution = '1080p',
    targetShots = [],
    sbPath = ''
  } = options;

  const baseName = sbPath ? path.basename(sbPath, '.json') : 'storyboard';
  const rawEpisodeName = sb.series_id || (sb.project && sb.project.id ? sb.project.id : '') || sb.project_name || baseName;
  const episodeName = config.sanitizeIdentifier(rawEpisodeName, 'storyboard');
  const epRenderDir = path.resolve(config.RENDERS_DIR, episodeName);
  if (!config.isPathContained(config.RENDERS_DIR, epRenderDir)) {
    throw new Error(`Đường dẫn thư mục render không an toàn: ${epRenderDir}`);
  }
  if (!fs.existsSync(epRenderDir)) fs.mkdirSync(epRenderDir, { recursive: true });

  const isImageMode = (sb.engine === 'nano_banana_pro') || 
                      (sb.format === 'minimalist_explainer') || 
                      (sb.render_mode === 'image') ||
                      (sb.visual_engine === 'nano_banana_pro');
  const seenHashes = new Set();
  const seenVideoHashes = new Set();
  if (fs.existsSync(epRenderDir)) {
    const existingFiles = fs.readdirSync(epRenderDir);
    for (const f of existingFiles) {
      try {
        if (f.endsWith('.png')) {
          const h = crypto.createHash('md5').update(fs.readFileSync(path.join(epRenderDir, f))).digest('hex');
          seenHashes.add(h);
        } else if (f.endsWith('.mp4')) {
          const h = crypto.createHash('md5').update(fs.readFileSync(path.join(epRenderDir, f))).digest('hex');
          seenVideoHashes.add(h);
        }
      } catch {}
    }
  }

  const shots = sb.shots || [];
  console.log(`=== BẮT ĐẦU RENDER GOOGLE FLOW CHO: ${(sb.project && sb.project.title) || sb.title || episodeName} [${isImageMode ? 'NANO BANANA PRO (IMAGE)' : resolution.toUpperCase()}] ===`);

  let sharedCdp = null;
  try {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const rawShotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      const shotId = config.sanitizeIdentifier(rawShotId, `shot_${i + 1}`);
      if (targetShots.length > 0 && !targetShots.includes(shotId)) continue;

      const isShotImage = isImageMode || s.type === 'image' || (!s.flow_prompt && s.image_prompt);
      const ext = isShotImage ? '.png' : '.mp4';
      const outFile = path.join(epRenderDir, `${shotId}${ext}`);
      const promptText = s.image_prompt || s.flow_prompt || s.prompt || '';
      const contentHash = crypto.createHash('md5').update(promptText + ':' + (isShotImage ? 'image' : resolution)).digest('hex');
      const hashFile = path.join(epRenderDir, `.${shotId}.hash`);

      if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000 && fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8').trim() === contentHash) {
        console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: Đã tồn tại với nội dung đồng nhất trong ${episodeName}/, bỏ qua.`);
        continue;
      }

      if (!sharedCdp || !sharedCdp.isOpen()) {
        sharedCdp = await getFlowClient();
      }

      console.log(`\n>>> [${i + 1}/${shots.length}] Xử lý ${shotId}...`);
      try {
        if (isShotImage) {
          console.log(`    [-] [Nano Banana Pro] Gửi câu lệnh vẽ ảnh: "${promptText.slice(0, 60)}..."`);
          await generateImage({
            prompt: promptText,
            outputPath: outFile,
            seenHashes,
            cdp: sharedCdp
          });
          try { fs.writeFileSync(hashFile, contentHash, 'utf8'); } catch {}
          await sleep(3500);
        } else {
          const isShorts = (sb.aspect_ratio === '9:16') || (sb.geometry && sb.geometry.aspect_ratio === '9:16') || (sb.format === 'shorts_40s') || (s.flow_prompt && s.flow_prompt.includes('9:16'));
          const maxAttempts = 3;
          let activePrompt = promptText;
          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              await ensureVideoSettings({
                ratio: isShorts ? '9:16' : '16:9',
                duration: '10 giây',
                model: 'Omni 1.1 Flash',
                cdp: sharedCdp
              });
              await clearCharacters({ cdp: sharedCdp });
              const chars = s.characters || [];
              for (const c of chars) {
                console.log(`    [-] Gắn nhân vật: @${c}`);
                await addCharacter(c, { cdp: sharedCdp });
              }
              console.log(`    [-] Gửi câu lệnh (lần ${attempt}/${maxAttempts}): "${activePrompt.slice(0, 50)}..."`);
              await submitPrompt(activePrompt, { cdp: sharedCdp });
              await waitForRender(240, { cdp: sharedCdp });
              await downloadLatest(outFile, { resolution, cdp: sharedCdp });

              if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
                const vHash = crypto.createHash('md5').update(fs.readFileSync(outFile)).digest('hex');
                if (seenVideoHashes.has(vHash) && attempt < maxAttempts) {
                  console.warn(`    [!] Phát hiện video trùng MD5 (${vHash.slice(0, 8)}), tự động render lại ${shotId}...`);
                  try { fs.unlinkSync(outFile); } catch {}
                  await sleep(3000);
                  continue;
                }
                seenVideoHashes.add(vHash);
              }

              try { fs.writeFileSync(hashFile, contentHash, 'utf8'); } catch {}
              await pruneFlowDomMemory(sharedCdp);
              break;
            } catch (shotErr) {
              console.warn(`    [!] Lỗi ở lần thử ${attempt}/${maxAttempts} cho ${shotId}: ${shotErr.message}`);
              await clearCharacters({ cdp: sharedCdp }).catch(() => {});
              if (attempt < maxAttempts) {
                activePrompt = activePrompt
                  .replace(/\bcollapsed\b/gi, 'abandoned')
                  .replace(/\btilted in the mud trailing thick black smoke\b/gi, 'parked in the muddy field')
                  .replace(/\bthick black smoke\b/gi, 'morning mist')
                  .replace(/\bbarbed-wire\b/gi, 'wooden perimeter')
                  .replace(/\bbombardment\b/gi, 'storm');
                await sleep(4000);
              } else {
                throw shotErr;
              }
            }
          }
        }
      } catch (err) {
        console.error(`    [!] Lỗi khi xử lý ${shotId}: ${err.message}`);
      }
    }
  } finally {
    if (sharedCdp) {
      sharedCdp.close(true);
    }
  }
  console.log('\n✓ Hoàn tất lượt render Google Flow!');
}

module.exports = {
  getFlowClient,
  pruneFlowDomMemory,
  getStatus,
  clearCharacters,
  addCharacter,
  submitPrompt,
  waitForRender,
  downloadLatest,
  downloadCloud1080p,
  downloadLatestDirect,
  generateImage,
  ensureFlowSettings,
  ensureVideoSettings,
  renderStoryboard
};
