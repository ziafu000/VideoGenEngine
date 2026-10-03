#!/usr/bin/env node
/**
 * engine/facebook_uploader.js: Automated Facebook Reels Uploader via Chrome DevTools Protocol.
 *
 * Supports publishing 9:16 vertical Reels to Facebook Pages and Profiles via Meta Business Suite
 * and Facebook web interfaces without consuming Meta Graph API quota (0 API cost, zero expiring OAuth tokens).
 *
 * Usage:
 *   node engine/facebook_uploader.js status
 *   node engine/facebook_uploader.js upload --video <path> [--caption <text>] [--title <title>] [--draft] [--storyboard <path>]
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { CDPClient, listPages, sleep } = require('./cdp');
const jev = require('./jev');

const DEFAULT_COMPOSER_URL = config.FACEBOOK_REELS_URL || 'https://business.facebook.com/latest/reels_composer';
const FALLBACK_REELS_URL = 'https://www.facebook.com/reels/create';

/**
 * Parse schedule date/time into standard { date, time, hour, min } format for Meta Business Suite.
 */
function parseScheduleTime(schedule) {
  if (!schedule) return null;
  if (typeof schedule === 'object' && schedule.date && schedule.time) {
    const parts = schedule.time.split(':');
    return {
      date: schedule.date,
      time: schedule.time,
      hour: parts[0]?.padStart(2, '0') || '08',
      min: parts[1]?.padStart(2, '0') || '00'
    };
  }
  const str = String(schedule).trim();
  // Check DD/MM/YYYY HH:mm
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    const hour = dmyMatch[4].padStart(2, '0');
    const min = dmyMatch[5].padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min, day, month, year };
  }
  // Check YYYY-MM-DD HH:mm or ISO
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    const hour = ymdMatch[4].padStart(2, '0');
    const min = ymdMatch[5].padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min, day, month, year };
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min, day, month, year };
  }
  return null;
}

/**
 * Format and build caption with title, description, and hashtags from storyboard data.
 */
function buildCaption(storyboard, customCaption = '') {
  if (customCaption && customCaption.trim()) {
    return customCaption.trim();
  }
  if (!storyboard) return '';

  const fb = storyboard.facebook || {};
  if (fb.caption && typeof fb.caption === 'string' && fb.caption.trim()) {
    let cap = fb.caption.trim();
    if (Array.isArray(fb.hashtags) && fb.hashtags.length > 0) {
      const missingTags = fb.hashtags
        .map(h => (typeof h === 'string' && h.startsWith('#')) ? h : `#${h}`)
        .filter(tag => !cap.includes(tag));
      if (missingTags.length > 0) {
        cap += '\n\n' + missingTags.join(' ');
      }
    }
    return cap;
  }

  const yt = storyboard.youtube || {};
  const title = fb.title || yt.title || (storyboard.series_title 
    ? `${storyboard.series_title} - ${storyboard.episode_title || ''}`.trim() 
    : (storyboard.episode_title || storyboard.project?.title || storyboard.title || ''));

  const description = fb.description || yt.description || storyboard.project?.series || '';
  const rawHashtags = fb.hashtags || (storyboard.hashtags) || ['Reels', 'Shorts', 'ViralVideo', 'Trending'];
  const hashtags = Array.isArray(rawHashtags)
    ? rawHashtags.map(h => (typeof h === 'string' && h.startsWith('#')) ? h : `#${h}`)
    : [];

  const parts = [];
  if (title) parts.push(title);
  if (description && description !== title) parts.push(description);
  if (hashtags.length > 0) parts.push(hashtags.join(' '));

  return parts.join('\n\n');
}

/**
 * Find or create active Facebook / Meta Business Suite tab.
 */
async function getFacebookTab() {
  const pages = await listPages();

  // 1. Look for existing reels composer / creator tab
  let fbTab = pages.find(p => p.type === 'page' && p.url && (
    p.url.includes('business.facebook.com/latest/reels_composer') ||
    p.url.includes('facebook.com/reels/create') ||
    (p.url.includes('facebook.com/reel/') && p.title && (p.title.includes('Tạo thước phim') || p.title.includes('Create reel')))
  ));

  // 2. Look for any active Meta Business Suite tab
  if (!fbTab) {
    fbTab = pages.find(p => p.type === 'page' && p.url && p.url.includes('business.facebook.com'));
  }

  // 3. Look for any active facebook tab
  if (!fbTab) {
    fbTab = pages.find(p => p.type === 'page' && p.url && p.url.includes('facebook.com'));
  }

  // 4. If no suitable tab found, open a dedicated tab
  if (!fbTab) {
    console.log(`[-] Mở tab Meta Business Suite mới tại: ${DEFAULT_COMPOSER_URL}`);
    const res = await fetch(`${config.CDP_URL}/json/new?${DEFAULT_COMPOSER_URL}`, { method: 'PUT' });
    if (!res.ok) {
      throw new Error(`Không thể mở tab Meta Business Suite qua CDP: ${res.statusText}`);
    }
    fbTab = await res.json();
    await sleep(4000);
  }

  return fbTab;
}

/**
 * Dismiss popups, tooltips, or feature announcement dialogs.
 */
async function dismissObstacles(client) {
  try {
    await client.evaluate(`(() => {
      // Chỉ đóng các dialog phụ/quảng cáo tính năng hoặc nút close riêng biệt
      const dismissKeywords = ['Để sau', 'Not now', 'Bỏ qua'];
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      for (const d of dialogs) {
        const dText = (d.innerText || '').toLowerCase();
        // Không đóng dialog chính của Reels composer hoặc dialog hoàn thành
        if (dText.includes('thước phim') || dText.includes('lên lịch đăng') || dText.includes('chi tiết') || dText.includes('chia sẻ')) {
          continue;
        }
        const btns = Array.from(d.querySelectorAll('button, div[role="button"]'));
        for (const b of btns) {
          const text = (b.innerText || b.getAttribute('aria-label') || '').trim();
          if (dismissKeywords.some(k => text === k)) {
            b.click();
          }
        }
      }
      // Nút X đóng tooltip quảng cáo nếu có
      const closeButtons = Array.from(document.querySelectorAll('[aria-label="Đóng"], [aria-label="Close"]'));
      for (const b of closeButtons) {
        const inComposer = b.closest('form') || b.closest('[data-testid*="composer"]');
        if (!inComposer && b.offsetWidth > 0 && b.offsetHeight > 0) {
          b.click();
        }
      }
    })()`);
  } catch {}
}

/**
 * Status command: Check Facebook login state and account/page info.
 */
async function cmdStatus() {
  try {
    const fbTab = await getFacebookTab();
    const client = new CDPClient(fbTab.webSocketDebuggerUrl);
    await client.ready;

    const status = await client.evaluate(`(() => {
      const url = window.location.href;
      const isLogin = !url.includes('/login') && !url.includes('/signin') && !document.querySelector('input[name="email"]');
      let accountName = 'Unknown';
      const profileEl = document.querySelector('[aria-label*="Trang cá nhân"], [aria-label*="Profile"], [aria-label*="Tài khoản"], [aria-label*="Account"], div[role="banner"] h1, span.x193iq5w');
      if (profileEl) {
        accountName = profileEl.getAttribute('aria-label') || profileEl.innerText?.trim() || accountName;
      }
      return {
        logged_in: isLogin,
        state: isLogin ? 'READY' : 'NEED_LOGIN',
        account_name: accountName,
        url: url,
        title: document.title
      };
    })()`);

    client.close();
    console.log(JSON.stringify({ ok: true, status }, null, 2));
    return { ok: true, status };
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

/**
 * Helper to set spinbox value via CDP mouse/keyboard + React property descriptor.
 */
async function setSpinboxValue(client, selector, valStr) {
  const targetVal = parseInt(valStr, 10);
  if (isNaN(targetVal)) return;

  for (let attempt = 0; attempt < 70; attempt++) {
    const curVal = await client.evaluate(`((sel) => {
      const el = document.querySelector(sel);
      return el ? parseInt(el.getAttribute('aria-valuenow'), 10) : null;
    })(${JSON.stringify(selector)})`);

    if (curVal === targetVal) {
      return true;
    }

    if (curVal === null || isNaN(curVal)) {
      break;
    }

    const step = targetVal > curVal ? 1 : -1;
    await client.evaluate(`((sel, st) => {
      const el = document.querySelector(sel);
      if (!el) return;
      const fKey = Object.keys(el).find(k => k.startsWith('__reactFiber'));
      let f = el[fKey];
      while (f) {
        if (f.memoizedProps && f.memoizedProps.onSpin) {
          f.memoizedProps.onSpin(st);
          break;
        }
        f = f.return;
      }
    })(${JSON.stringify(selector)}, ${step})`);

    await sleep(75);
  }
}

/**
 * Điều hướng an toàn và chắc chắn tới Reels Composer sạch sẽ cho mỗi lần upload.
 * Cơ chế chuẩn: Về trang home của Business Suite và click "Tạo thước phim" để kích hoạt client-side SPA routing.
 */
async function openFreshReelsComposer(client) {
  const assetId = config.FACEBOOK_ASSET_ID;
  const businessId = config.FACEBOOK_BUSINESS_ID;
  const homeUrl = assetId
    ? `https://business.facebook.com/latest/home?asset_id=${assetId}${businessId ? `&business_id=${businessId}` : ''}`
    : 'https://business.facebook.com/latest/home';
  console.log(`[-] Điều hướng tới trang chủ Meta Business Suite để dọn sạch phiên cũ...`);
  await client.send('Page.navigate', { url: homeUrl });
  await sleep(4000);
  await dismissObstacles(client);

  console.log(`[-] Kích hoạt "Tạo thước phim" từ trang chủ...`);
  for (let attempt = 0; attempt < 10; attempt++) {
    const clicked = await client.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('div[role="button"], button, a'));
      const createBtn = btns.find(b => {
        const t = (b.innerText || '').trim();
        return t === 'Tạo thước phim' || t === 'Create reel';
      });
      if (createBtn) {
        (createBtn.closest('[role="button"]') || createBtn).click();
        return true;
      }
      return false;
    })()`);
    if (clicked) break;
    await sleep(1000);
  }
  await sleep(3500);

  // Chờ URL chuyển sang Reels Composer
  for (let w = 0; w < 10; w++) {
    const curUrl = await client.evaluate('window.location.href');
    if (curUrl.includes('/reels_composer')) {
      console.log(`    [✓] Đã vào giao diện Reels Composer sạch sẽ!`);
      return true;
    }
    await sleep(1000);
  }
  return false;
}

/**
 * Core Reel upload automation function.
 */
async function uploadReel({
  videoPath,
  caption = '',
  title = '',
  draft = false,
  schedule = null,
  storyboard = null
}) {
  if (!videoPath || !fs.existsSync(videoPath)) {
    throw new Error(`Không tìm thấy file video tại: ${videoPath}`);
  }

  // Build final caption from storyboard if not explicitly provided
  const finalCaption = buildCaption(storyboard, caption) || title || path.basename(videoPath, path.extname(videoPath));
  let winVideoPath = config.toWinPath(videoPath);
  const baseName = path.basename(videoPath);
  const winDlCandidate = path.join(config.WIN_DOWNLOADS_DIR, baseName);
  if (fs.existsSync(winDlCandidate)) {
    winVideoPath = `C:\\Users\\${config.WIN_USER}\\Downloads\\${baseName}`;
  }

  const schedTarget = schedule || (storyboard?.facebook?.schedule) || (storyboard?.schedule) || null;
  const schedData = parseScheduleTime(schedTarget);
  const postureLabel = draft ? 'LƯU BẢN NHÁP (DRAFT)' : (schedData ? `LÊN LỊCH (${schedData.date} lúc ${schedData.time})` : 'XUẤT BẢN NGAY (PUBLISH)');

  console.log(`\n============================================================`);
  console.log(`>>> FACEBOOK REELS UPLOAD AUTOMATION (CDP)`);
  console.log(`    - Video: ${videoPath}`);
  console.log(`    - Windows Path: ${winVideoPath}`);
  console.log(`    - Chế độ đăng: ${postureLabel}`);
  console.log(`    - Caption:\n${finalCaption.split('\n').map(l => '        ' + l).join('\n')}`);
  console.log(`============================================================\n`);

  // Pre-flight screening with TypeSafe Jev if available
  try {
    const parsed = jev.screenPrompt(finalCaption);
    if (parsed.safe === false) {
      console.warn(`[!] Cảnh báo kiểm duyệt Jev: Caption có điểm rủi ro ${parsed.risk_score}: ${parsed.reason}`);
    } else {
      console.log(`[✓] TypeSafe Jev: Nội dung caption an toàn.`);
    }
  } catch {}

  // 1. Kết nối tab Facebook / Meta Business Suite
  console.log(`[-] [1/6] Kết nối tab Facebook / Meta Business Suite qua CDP...`);
  const fbTab = await getFacebookTab();
  const client = new CDPClient(fbTab.webSocketDebuggerUrl);
  await client.ready;

  try {
    await client.enableDialogHandling();
    await client.dismissModals();

    // Khởi tạo phiên Reels Composer sạch sẽ
    const composerReady = await openFreshReelsComposer(client);
    if (!composerReady) {
      throw new Error('Không thể điều hướng tới giao diện Reels Composer.');
    }
    await client.dismissModals();
    await dismissObstacles(client);

    // Kiểm tra đăng nhập
    const isLogin = await client.evaluate(`(() => {
      const url = window.location.href;
      return !url.includes('/login') && !url.includes('/signin') && !document.querySelector('input[name="email"]');
    })()`);

    if (!isLogin) {
      throw new Error('Chưa đăng nhập Facebook trên trình duyệt Chrome. Vui lòng đăng nhập Facebook trước khi upload.');
    }

    await dismissObstacles(client);

    // 2. Cài đặt hook bắt giữ transient file inputs (dành cho Meta Business Suite)
    console.log(`[-] [2/6] Khởi tạo giao diện nạp file video và nạp qua CDP...`);
    await client.send('Page.enable');
    await client.send('DOM.enable');
    await client.send('Page.setInterceptFileChooserDialog', { enabled: true });

    let fileChooserEvent = null;
    client.on('Page.fileChooserOpened', (params) => {
      fileChooserEvent = params;
    });

    // Chờ giao diện nạp video sẵn sàng
    for (let w = 0; w < 20; w++) {
      await dismissObstacles(client);
      const isReady = await client.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        return btns.some(el => (el.innerText || '').trim().includes('Thêm video') || (el.innerText || '').trim().includes('Add video'));
      })()`);
      if (isReady) break;
      await sleep(1000);
    }

    // Cuộn tới và click nút 'Thêm video' bằng Runtime.evaluate với userGesture: true
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.send('Runtime.evaluate', {
        expression: `(() => {
          const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
          const b = btns.find(el => {
            const t = (el.innerText || '').trim();
            return t.includes('Thêm video') || t.includes('Add video');
          });
          if (b) {
            (b.closest('[role="button"]') || b).click();
            return true;
          }
          return false;
        })()`,
        userGesture: true
      });

      for (let f = 0; f < 8; f++) {
        await sleep(500);
        if (fileChooserEvent) break;
      }
      if (fileChooserEvent) break;
    }

    if (!fileChooserEvent || !fileChooserEvent.backendNodeId) {
      throw new Error('Không thể mở hộp thoại chọn file video trên Facebook Reels / Meta Business Suite.');
    }

    console.log(`    [-] Nạp file qua CDP DOM.setFileInputFiles (BackendNodeId: ${fileChooserEvent.backendNodeId})...`);
    await client.send('DOM.setFileInputFiles', {
      files: [winVideoPath],
      backendNodeId: fileChooserEvent.backendNodeId
    });
    console.log(`    [✓] Đã nạp file video thành công!`);

    // 4. Chờ video xử lý hoàn tất (tiến trình đạt 100% hoặc nút Tiếp sáng)
    console.log(`[-] [3/6] Chờ Facebook xử lý video và sẵn sàng chuyển bước...`);
    let videoProcessed = false;
    for (let i = 0; i < 80; i++) {
      await sleep(1500);
      await dismissObstacles(client);

      const checkState = await client.evaluate(`(() => {
        if (!document.body) return { has100Pct: false, isNextEnabled: false };
        const bodyText = document.body.innerText || '';
        const has100Pct = bodyText.includes('100%');
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const nextBtn = btns.find(b => {
          const t = (b && b.innerText ? b.innerText : '').trim();
          return t === 'Tiếp' || t === 'Next' || t === 'Tiếp tục' || t === 'Continue';
        });
        const isNextEnabled = nextBtn && !nextBtn.disabled && nextBtn.getAttribute('aria-disabled') !== 'true';
        return { has100Pct, isNextEnabled };
      })()`);

      if (checkState && (checkState.has100Pct || checkState.isNextEnabled)) {
        videoProcessed = true;
        console.log(`\n    [✓] Video đã tải lên hoàn tất và sẵn sàng!`);
        break;
      }
      process.stdout.write(`\r    ... Đang chờ xử lý video: ${((i + 1) * 1.5).toFixed(0)}s`);
    }

    if (!videoProcessed) {
      throw new Error('Video chưa tải lên/xử lý xong trên Facebook sau 120s.');
    }

    // 5. Điền Caption & Hashtags nếu ô mô tả xuất hiện ở Bước 1 (Meta Business Suite)
    console.log(`\n[-] [4/6] Nhập nội dung Caption & Hashtags...`);
    let captionInserted = false;

    for (let cAttempt = 0; cAttempt < 15; cAttempt++) {
      // Tìm tọa độ click của ô editor
      const editorPoint = await client.evaluate(`(() => {
        const editor = document.querySelector('div.notranslate._5rpu') || document.querySelector('[role="textbox"]');
        if (!editor) return null;
        const r = editor.getBoundingClientRect();
        return { x: r.x + 20, y: r.y + 15 };
      })()`);

      if (editorPoint) {
        // 1. Click thật bằng mouse event vào editor để khởi tạo Draft.js caret/selection
        await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: editorPoint.x, y: editorPoint.y, button: 'left', clickCount: 1 });
        await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: editorPoint.x, y: editorPoint.y, button: 'left', clickCount: 1 });
        await sleep(300);

        // 2. Xóa nội dung cũ trong editor nếu có
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65 });
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
        await sleep(200);

        // 3. Nhập từng dòng qua Input.insertText + Enter
        const captionLines = finalCaption.split('\n');
        for (let li = 0; li < captionLines.length; li++) {
          if (captionLines[li].length > 0) {
            await client.send('Input.insertText', { text: captionLines[li] });
          }
          if (li < captionLines.length - 1) {
            await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          }
          await sleep(50);
        }
        await sleep(400);

        // 4. Click ra ngoài tiêu đề phần Chi tiết để kích hoạt sự kiện BLUR lưu commit Draft.js
        const outsidePoint = await client.evaluate(`(() => {
          const all = Array.from(document.querySelectorAll('*'));
          const h = all.find(el => (el.innerText || '').trim() === 'Chi tiết về thước phim');
          if (h) {
            const r = h.getBoundingClientRect();
            return { x: r.x + 10, y: r.y + 10 };
          }
          return null;
        })()`);
        if (outsidePoint) {
          await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 });
          await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: outsidePoint.x, y: outsidePoint.y, button: 'left', clickCount: 1 });
        }
        await sleep(600);

        // 5. Kiểm tra đối soát text trong editor
        const checkEditorText = await client.evaluate(`(() => {
          const editor = document.querySelector('div.notranslate._5rpu') || document.querySelector('[role="textbox"]');
          return editor ? (editor.innerText || '').trim() : '';
        })()`);

        if (checkEditorText.length > 20) {
          captionInserted = true;
          console.log(`    [✓] Đã điền và commit caption/hashtags thành công (${checkEditorText.length} ký tự)!`);
          break;
        }
      }
      await sleep(1000);
    }

    // 6. Điều hướng qua các bước: Bước 1 (Tạo) -> Bước 2 (Chỉnh sửa) -> Bước 3 (Chia sẻ)
    console.log(`[-] [5/6] Điều hướng qua các bước kiểm tra sang bước Chia sẻ / Xuất bản...`);
    for (let step = 1; step <= 2; step++) {
      await sleep(2000);
      await dismissObstacles(client);

      const clickedNext = await client.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const nextBtn = btns.find(b => {
          const t = (b.innerText || '').trim();
          return t === 'Tiếp' || t === 'Next' || t === 'Tiếp tục' || t === 'Continue';
        });
        if (nextBtn && !nextBtn.disabled && nextBtn.getAttribute('aria-disabled') !== 'true') {
          nextBtn.click();
          return true;
        }
        return false;
      })()`);

      if (clickedNext) {
        console.log(`    [✓] Đã chuyển bước (${step}/2)...`);
      }
    }

    await sleep(2500);
    await dismissObstacles(client);

    // Nếu ô caption chưa điền được ở Bước 1, điền ở Bước 3 (giao diện Facebook Reels thông thường)
    if (!captionInserted) {
      console.log(`    [-] Thử điền caption tại Bước 3...`);
      const editorFocusedStep3 = await client.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"]');
        if (editor) {
          editor.focus();
          editor.click();
          return true;
        }
        return false;
      })()`);

      if (editorFocusedStep3) {
        const captionLines = finalCaption.split('\n');
        for (let li = 0; li < captionLines.length; li++) {
          if (captionLines[li].length > 0) {
            await client.send('Input.insertText', { text: captionLines[li] });
          }
          if (li < captionLines.length - 1) {
            await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
            await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          }
          await sleep(60);
        }
        console.log(`    [✓] Đã điền caption và hashtags tại Bước 3!`);
      }
    }

    // 7. Thực hiện Đăng (Publish), Lên lịch (Schedule) hoặc Lưu bản nháp (Draft)
    console.log(`[-] [6/6] Thiết lập chế độ xuất bản: ${postureLabel}...`);

    if (draft) {
      // Chọn tùy chọn "Lưu làm bản nháp" (Meta Business Suite radio button)
      await client.evaluate(`(() => {
        const elements = Array.from(document.querySelectorAll('div[role="button"], div[role="radio"], span, div'));
        const draftOpt = elements.find(el => el.children.length === 0 && (el.innerText?.trim() === 'Lưu làm bản nháp' || el.innerText?.trim() === 'Save as draft'));
        if (draftOpt) {
          (draftOpt.closest('div[role="button"]') || draftOpt.closest('div[role="radio"]') || draftOpt.parentElement).click();
        }
      })()`);
      await sleep(1500);
    } else if (schedData) {
      // Chọn tùy chọn "Lên lịch" và điền ngày giờ
      console.log(`    [-] Chọn tùy chọn "Lên lịch" và nhập thời gian: ${schedData.date} ${schedData.time}...`);
      await client.evaluate(`(() => {
        const elements = Array.from(document.querySelectorAll('div[role="button"], div[role="radio"], span, div, label'));
        const schedOpt = elements.find(el => el.children.length === 0 && (el.innerText?.trim() === 'Lên lịch' || el.innerText?.trim() === 'Schedule'));
        if (schedOpt) {
          const target = schedOpt.closest('[role="button"]') || schedOpt.closest('[role="radio"]') || schedOpt;
          const kProps = Object.keys(target).find(k => k.startsWith('__reactProps'));
          if (kProps && target[kProps]?.onClick) {
            target[kProps].onClick({ preventDefault: () => {}, stopPropagation: () => {} });
          } else {
            target.click();
          }
        }
      })()`);
      await sleep(1500);

      // Chọn ngày: Thay thế text trực tiếp vào ô input ngày kết hợp đồng bộ React Fiber (chuẩn và ổn định theo góp ý của Captain)
      const targetDay = parseInt(schedData.day, 10);
      let dateSetSuccess = false;

      for (let dAttempt = 0; dAttempt < 3; dAttempt++) {
        // 1. Focus và select toàn bộ text trong ô ngày
        const focused = await client.evaluate(`(() => {
          const dateInput = document.querySelector('input[placeholder*="dd/mm/yyyy"]') ||
            Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('dd/mm/yyyy') || (i.getAttribute('aria-label') || '').includes('ngày'));
          if (dateInput) {
            dateInput.focus();
            dateInput.select();
            return true;
          }
          return false;
        })()`);

        if (focused) {
          // 2. Kích hoạt đồng bộ trực tiếp vào React Fiber của GeoDatePicker
          await client.evaluate(`((targetDate) => {
            const parts = targetDate.split('/').map(x => parseInt(x, 10));
            const day = parts[0], month = parts[1], year = parts[2];
            const dateInput = document.querySelector('input[placeholder*="dd/mm/yyyy"]') ||
              Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('dd/mm/yyyy') || (i.getAttribute('aria-label') || '').includes('ngày'));
            if (!dateInput) return;
            const fKey = Object.keys(dateInput).find(k => k.startsWith('__reactFiber'));
            let f = dateInput[fKey];
            while (f) {
              const name = typeof f.type === 'string' ? f.type : (f.type?.displayName || f.type?.name || '');
              if (name === 'GeoDatePicker' && f.memoizedProps?.onChange) {
                f.memoizedProps.onChange({ year, month, day });
                break;
              }
              f = f.return;
            }
          })(${JSON.stringify(schedData.date)})`);
          await sleep(300);

          // 3. Nhập trực tiếp chuỗi ngày qua CDP Input.insertText + Enter để đồng bộ DOM
          await client.send('Input.insertText', { text: schedData.date });
          await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
          await sleep(300);

          // 4. Đồng bộ React property descriptor native setter + events (input, change, blur)
          await client.evaluate(`((val) => {
            const dateInput = document.querySelector('input[placeholder*="dd/mm/yyyy"]') ||
              Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('dd/mm/yyyy') || (i.getAttribute('aria-label') || '').includes('ngày'));
            if (dateInput) {
              const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
              if (setter) setter.call(dateInput, val);
              dateInput.dispatchEvent(new Event('input', { bubbles: true }));
              dateInput.dispatchEvent(new Event('change', { bubbles: true }));
              dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
            }
          })(${JSON.stringify(schedData.date)})`);
          await sleep(600);

          // 5. Đối soát giá trị ngày đã nhận
          const checkDate = await client.evaluate(`(() => {
            const dateInput = document.querySelector('input[placeholder*="dd/mm/yyyy"]') ||
              Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('dd/mm/yyyy') || (i.getAttribute('aria-label') || '').includes('ngày'));
            return dateInput ? dateInput.value : '';
          })()`);

          if (checkDate.includes(String(targetDay))) {
            console.log(`    [✓] Đã điền ngày thành công: "${checkDate}" (Mục tiêu: ${schedData.date})`);
            dateSetSuccess = true;
            break;
          }
        }
        await sleep(500);
      }

      if (!dateSetSuccess) {
        console.warn(`    [!] Chú ý: Chưa xác nhận được ngày ${schedData.date}, tiếp tục thiết lập giờ...`);
      }

      // 4. Chỉ sau khi ngày đã chốt xong, tiến hành điều chỉnh Giờ và Phút bằng spinbox React Fiber onSpin
      await setSpinboxValue(client, 'input[aria-label*="giờ"], input[aria-label*="hour" i]', schedData.hour);
      await setSpinboxValue(client, 'input[aria-label*="phút"], input[aria-label*="minute" i]', schedData.min);
      await sleep(1000);
    }

    // Bấm nút Submit (Đăng / Lên lịch / Lưu)
    let actionDone = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      actionDone = await client.evaluate(`((isDraft, isSchedule) => {
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        if (isDraft) {
          const draftBtns = btns.filter(b => {
            const t = (b.innerText || '').trim();
            const isRadio = b.hasAttribute('aria-pressed') || b.closest('[role="group"]');
            return (t === 'Lưu' || t === 'Save' || t === 'Lưu làm bản nháp' || t === 'Save as draft') && !isRadio && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
          });
          const targetBtn = draftBtns[draftBtns.length - 1];
          if (targetBtn) {
            targetBtn.click();
            return { clicked: true, action: 'DRAFT', text: targetBtn.innerText?.trim() };
          }
        } else if (isSchedule) {
          const schedBtns = btns.filter(b => {
            const t = (b.innerText || '').trim();
            const isRadio = b.hasAttribute('aria-pressed') || b.closest('[role="radiogroup"]') || b.closest('[role="group"]');
            return (t === 'Lên lịch' || t === 'Schedule' || t === 'Lên lịch đăng') && !isRadio;
          });
          const targetBtn = schedBtns[schedBtns.length - 1];
          if (!targetBtn) {
            return { error: 'SCHEDULE_BTN_NOT_FOUND' };
          }
          if (targetBtn.disabled || targetBtn.getAttribute('aria-disabled') === 'true') {
            return { error: 'SCHEDULE_BTN_DISABLED' };
          }
          targetBtn.click();
          return { clicked: true, action: 'SCHEDULE', text: targetBtn.innerText?.trim() };
        } else {
          const publishBtns = btns.filter(b => {
            const t = (b.innerText || '').trim();
            const isRadio = b.hasAttribute('aria-pressed') || b.closest('[role="group"]');
            return (t === 'Chia sẻ' || t === 'Đăng' || t === 'Post' || t === 'Publish' || t === 'Đăng ngay' || t === 'Share') && !isRadio && !b.disabled && b.getAttribute('aria-disabled') !== 'true';
          });
          const targetBtn = publishBtns[publishBtns.length - 1];
          if (targetBtn) {
            targetBtn.click();
            return { clicked: true, action: 'PUBLISH', text: targetBtn.innerText?.trim() };
          }
        }
        return null;
      })(${JSON.stringify(draft)}, ${JSON.stringify(!!schedData)})`);

      if (actionDone) {
        if (actionDone.error) {
          if (actionDone.error === 'SCHEDULE_BTN_DISABLED') {
            throw new Error(`[LỖI LÊN LỊCH] Nút "Lên lịch" đang bị vô hiệu hóa (disabled). Kiểm tra thời gian lên lịch (${schedData.date} ${schedData.time}) có hợp lệ không! TUYỆT ĐỐI KHÔNG FALLBACK sang Đăng ngay.`);
          }
          if (actionDone.error === 'SCHEDULE_BTN_NOT_FOUND' && attempt === 9) {
            throw new Error(`[LỖI LÊN LỊCH] Không tìm thấy nút "Lên lịch" trên Facebook Reels composer. TUYỆT ĐỐI KHÔNG FALLBACK sang Đăng ngay.`);
          }
        } else if (actionDone.clicked) {
          console.log(`    [✓] Đã kích hoạt lệnh ${actionDone.text || (draft ? 'Lưu bản nháp' : (schedData ? 'Lên lịch' : 'Chia sẻ'))} thành công!`);
          break;
        }
      }
      await sleep(1000);
    }

    if (!actionDone || !actionDone.clicked) {
      throw new Error(`Không thể thực hiện hành động ${draft ? 'Lưu bản nháp' : (schedData ? 'Lên lịch' : 'Chia sẻ / Đăng')} trên giao diện Facebook Reels.`);
    }

    // 8. Chờ xác nhận kết quả
    console.log(`[-] Đang chờ xác nhận từ Facebook...`);
    let confirmed = false;
    for (let w = 0; w < 20; w++) {
      await sleep(1500);

      // Xử lý modal hoàn tất "Đã lên lịch đăng thước phim" / "Đang xử lý thước phim" với nút "Xong"
      const modalHandled = await client.evaluate(`(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"], div'));
        const processingDialog = dialogs.find(d => {
          const t = (d.innerText || '').toLowerCase();
          return t.includes('đã lên lịch đăng thước phim') || t.includes('xử lý thước phim') || t.includes('đăng thước phim') || t.includes('lên lịch');
        });
        if (processingDialog) {
          const btns = Array.from(processingDialog.querySelectorAll('button, div[role="button"]'));
          const xongBtn = btns.find(b => {
            const t = (b.innerText || '').trim();
            return t === 'Xong' || t === 'Done' || t === 'Đóng' || t === 'Close';
          });
          if (xongBtn) {
            xongBtn.click();
            return { closed: true, text: xongBtn.innerText?.trim() };
          }
        }
        return null;
      })()`);

      if (modalHandled && modalHandled.closed) {
        console.log(`    [✓] Đã đóng modal xác nhận hoàn tất (${modalHandled.text})!`);
        confirmed = true;
        await sleep(1500);
        break;
      }

      const confirmState = await client.evaluate(`(() => {
        const toast = document.querySelector('[role="alert"], [data-visualcompletion="toast"]');
        const toastText = toast ? toast.innerText : '';
        const hasReelSuccess = toastText.includes('thước phim') || toastText.includes('reel') || toastText.includes('bản nháp') || toastText.includes('draft') || toastText.includes('lên lịch') || toastText.includes('scheduled');
        const url = window.location.href;
        return {
          hasSuccessToast: hasReelSuccess,
          toast: toastText,
          closedComposer: !url.includes('reels_composer') && !url.includes('reels/create')
        };
      })()`);

      if (confirmState.hasSuccessToast || confirmState.closedComposer) {
        console.log(`    [✓] Xác thực thành công: ${confirmState.toast || 'Giao diện đã chuyển hướng hoàn tất'}`);
        confirmed = true;
        break;
      }
    }

    client.close();

    const result = {
      success: true,
      video: videoPath,
      caption: finalCaption,
      posture: draft ? 'draft' : (schedData ? 'scheduled' : 'published'),
      schedule: schedData,
      confirmed,
      uploaded_at: new Date().toISOString()
    };

    console.log(`\n============================================================`);
    console.log(`✓ ĐÃ ${draft ? 'LƯU BẢN NHÁP' : (schedData ? 'LÊN LỊCH THÀNH CÔNG' : 'XUẤT BẢN THÀNH CÔNG')} LÊN FACEBOOK REELS!`);
    console.log(`  - File: ${videoPath}`);
    console.log(`  - Trạng thái: ${draft ? 'Bản nháp (Draft)' : (schedData ? `Đã lên lịch (${schedData.date} lúc ${schedData.time})` : 'Đã đăng (Published)')}`);
    console.log(`============================================================\n`);

    return result;
  } catch (err) {
    const errorScreenshot = path.join(config.PROJECT_DIR, 'renders', 'qa_inspect', `fb_error_${Date.now()}.png`);
    await client.captureScreenshot(errorScreenshot).catch(() => {});
    console.error(`[!] Lỗi Facebook Reels upload: ${err.message}. Đã chụp màn hình chẩn đoán tại: ${errorScreenshot}`);
    client.close();
    throw err;
  }
}

/**
 * Parse CLI arguments.
 */
function parseArgs(argsList) {
  const parsed = {};
  for (let i = 0; i < argsList.length; i++) {
    const arg = argsList[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argsList[i + 1];
      if (next && !next.startsWith('--')) {
        parsed[key] = next;
        i++;
      } else {
        parsed[key] = true;
      }
    }
  }
  return parsed;
}

/**
 * CLI Entrypoint.
 */
async function cmdUpload(args) {
  const video = args.video;
  if (!video) {
    console.error(JSON.stringify({ ok: false, error: 'Thiếu tham số --video <đường dẫn file>' }));
    process.exit(1);
  }

  let sb = null;
  if (args.storyboard && fs.existsSync(args.storyboard)) {
    try {
      sb = JSON.parse(fs.readFileSync(args.storyboard, 'utf8'));
    } catch {}
  }

  const draft = !!args.draft;
  const schedule = args.schedule || null;
  const caption = args.caption || '';
  const title = args.title || '';

  try {
    const res = await uploadReel({
      videoPath: video,
      caption,
      title,
      draft,
      schedule,
      storyboard: sb
    });
    console.log(JSON.stringify({ ok: true, result: res }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'status';

  if (cmd === 'status') {
    await cmdStatus();
  } else if (cmd === 'upload') {
    const parsed = parseArgs(args.slice(1));
    await cmdUpload(parsed);
  } else {
    console.log(`Cách dùng:
  node engine/facebook_uploader.js status
  node engine/facebook_uploader.js upload --video <video_path> [--caption <text>] [--title <title>] [--draft] [--schedule <datetime>] [--storyboard <path>]`);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error in facebook_uploader:', err.message);
    process.exit(1);
  });
}

module.exports = {
  uploadReel,
  cmdStatus,
  cmdUpload,
  getFacebookTab,
  buildCaption,
  parseScheduleTime
};
