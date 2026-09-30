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

const DEFAULT_COMPOSER_URL = config.FACEBOOK_REELS_URL || 'https://business.facebook.com/latest/reels_composer?asset_id=1295811423621912';
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
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min };
  }
  // Check YYYY-MM-DD HH:mm or ISO
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (ymdMatch) {
    const year = ymdMatch[1];
    const month = ymdMatch[2].padStart(2, '0');
    const day = ymdMatch[3].padStart(2, '0');
    const hour = ymdMatch[4].padStart(2, '0');
    const min = ymdMatch[5].padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min };
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) {
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    const hour = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return { date: `${day}/${month}/${year}`, time: `${hour}:${min}`, hour, min };
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
      const dismissKeywords = ['Đóng', 'Close', 'Để sau', 'Not now', 'Bỏ qua', 'Hủy', 'Discard'];
      const btns = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label="Đóng"], [aria-label="Close"]'));
      for (const b of btns) {
        const text = (b.innerText || b.getAttribute('aria-label') || '').trim();
        if (dismissKeywords.includes(text)) {
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
  const coords = await client.evaluate(`((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    el.focus();
    el.select();
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })(${JSON.stringify(selector)})`);

  if (coords) {
    await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
    await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: coords.x, y: coords.y, button: 'left', clickCount: 1 });
    await sleep(100);

    await client.send('Input.dispatchKeyEvent', { type: 'keyDown', commands: ['selectAll'] });
    await client.send('Input.dispatchKeyEvent', { type: 'keyUp' });
    await sleep(50);

    for (const char of String(valStr)) {
      await client.send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, unmodifiedText: char, key: char });
      await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: char });
      await sleep(50);
    }
  }

  // Also apply React property descriptor setter + events
  await client.evaluate(`((sel, val) => {
    const el = document.querySelector(sel);
    if (el) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
      if (nativeSetter) nativeSetter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    }
  })(${JSON.stringify(selector)}, ${JSON.stringify(valStr)})`);
  await sleep(300);
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
  const winVideoPath = config.toWinPath(videoPath);

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
    // Luôn điều hướng tới Reels Composer sạch sẽ cho mỗi lần upload
    console.log(`[-] Điều hướng tới Reels Composer: ${DEFAULT_COMPOSER_URL}...`);
    await client.send('Page.navigate', { url: DEFAULT_COMPOSER_URL });
    await sleep(5000);

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
    await client.send('DOM.enable');

    await client.evaluate(`(() => {
      // Xóa input cũ nếu có
      const old = document.getElementById('meta_reels_file_input');
      if (old) old.remove();
      window.__transientFileInput = null;

      if (!window.__origInputClick) {
        window.__origInputClick = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function() {
          if (this.type === 'file') {
            this.id = 'meta_reels_file_input';
            this.style.display = 'none';
            document.body.appendChild(this);
            window.__transientFileInput = this;
          }
          return window.__origInputClick.apply(this, arguments);
        };
      }

      // Đóng tooltips/popups cản trở
      Array.from(document.querySelectorAll('*'))
        .filter(el => ['Đóng', 'Close', 'Để sau', 'Not now'].includes(el.innerText?.trim()))
        .forEach(el => { try { (el.closest('[role="button"]') || el).click(); } catch {} });

      // Click nút 'Thêm video' để kích hoạt input
      if (!document.querySelector('#meta_reels_file_input')) {
        const b = Array.from(document.querySelectorAll('div[role="button"], button')).find(el => {
          const t = el.innerText?.trim();
          return t?.includes('Thêm video') || t?.includes('Add video');
        });
        if (b) {
          (b.closest('[role="button"]') || b).click();
        }
      }
    })()`);

    await sleep(1500);

    // 3. Tìm NodeId của file input trên DOM
    let nodeId = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      // Đảm bảo click "Thêm video" nếu file input chưa xuất hiện
      await client.evaluate(`(() => {
        if (!document.querySelector('#meta_reels_file_input')) {
          const b = Array.from(document.querySelectorAll('div[role="button"], button')).find(el => {
            const t = el.innerText?.trim();
            return t?.includes('Thêm video') || t?.includes('Add video');
          });
          if (b) {
            (b.closest('[role="button"]') || b).click();
          }
        }
      })()`);

      try {
        const doc = await client.send('DOM.getDocument', { depth: -1 });
        const fileNode = await client.send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: '#meta_reels_file_input'
        });
        if (fileNode && fileNode.nodeId) {
          nodeId = fileNode.nodeId;
          break;
        }
      } catch {}

      try {
        const evalRes = await client.send('Runtime.evaluate', {
          expression: 'document.querySelector("#meta_reels_file_input")'
        });
        if (evalRes.result && evalRes.result.objectId) {
          const nodeDesc = await client.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) {
            nodeId = nodeDesc.nodeId;
            break;
          }
        }
      } catch {}

      await sleep(1000);
    }

    if (!nodeId) {
      throw new Error('Không tìm thấy ô chọn file video trên giao diện Facebook Reels / Meta Business Suite.');
    }

    console.log(`    [-] Nạp file qua CDP DOM.setFileInputFiles (NodeId: ${nodeId})...`);
    await client.send('DOM.setFileInputFiles', {
      files: [winVideoPath],
      nodeId: nodeId
    });
    console.log(`    [✓] Đã nạp file video thành công!`);

    // 4. Chờ video xử lý hoàn tất (tiến trình đạt 100% hoặc nút Tiếp sáng)
    console.log(`[-] [3/6] Chờ Facebook xử lý video và sẵn sàng chuyển bước...`);
    let videoProcessed = false;
    for (let i = 0; i < 80; i++) {
      await sleep(1500);
      await dismissObstacles(client);

      const checkState = await client.evaluate(`(() => {
        const bodyText = document.body.innerText;
        const has100Pct = bodyText.includes('100%');
        const btns = Array.from(document.querySelectorAll('div[role="button"], button'));
        const nextBtn = btns.find(b => {
          const t = (b.innerText || '').trim();
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

    for (let cAttempt = 0; cAttempt < 10; cAttempt++) {
      const editorFocused = await client.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"], [role="textbox"], div[contenteditable="true"], textarea');
        if (editor) {
          editor.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          sel.removeAllRanges();
          sel.addRange(range);
          return true;
        }
        return false;
      })()`);

      if (editorFocused) {
        await client.send('Input.insertText', { text: finalCaption });
        await sleep(800);
        await client.evaluate(`(() => {
          const editor = document.querySelector('[role="textbox"][contenteditable="true"], [role="textbox"], div[contenteditable="true"], textarea');
          if (editor) {
            editor.dispatchEvent(new Event('input', { bubbles: true }));
            editor.dispatchEvent(new Event('change', { bubbles: true }));
          }
        })()`);
        captionInserted = true;
        console.log(`    [✓] Đã điền caption và hashtags thành công!`);
        break;
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
      await client.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"], [role="textbox"], div[contenteditable="true"], textarea');
        if (editor) {
          editor.focus();
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(editor);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      })()`);
      await client.send('Input.insertText', { text: finalCaption });
      await sleep(800);
      await client.evaluate(`(() => {
        const editor = document.querySelector('[role="textbox"][contenteditable="true"], [role="textbox"], div[contenteditable="true"], textarea');
        if (editor) {
          editor.dispatchEvent(new Event('input', { bubbles: true }));
          editor.dispatchEvent(new Event('change', { bubbles: true }));
        }
      })()`);
      console.log(`    [✓] Đã điền caption và hashtags tại Bước 3!`);
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

      // Điền Date input bằng React property descriptor
      await client.evaluate(`((dVal) => {
        const dateInput = document.querySelector('input[placeholder*="dd/mm/yyyy"]') ||
          Array.from(document.querySelectorAll('input')).find(i => (i.placeholder || '').includes('dd/mm/yyyy') || (i.value || '').includes('2026') || (i.getAttribute('aria-label') || '').includes('ngày'));
        if (dateInput) {
          dateInput.focus();
          const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (nativeSetter) nativeSetter.call(dateInput, dVal);
          dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          dateInput.dispatchEvent(new Event('change', { bubbles: true }));
          dateInput.dispatchEvent(new Event('blur', { bubbles: true }));
        }
      })(${JSON.stringify(schedData.date)})`);
      await sleep(500);

      // Điền Giờ và Phút bằng spinbox keyboard + React property descriptor
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
            const isRadio = b.hasAttribute('aria-pressed') || b.closest('[role="group"]');
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

      // Xử lý modal hoàn tất "Đang xử lý thước phim" với nút "Xong"
      const modalHandled = await client.evaluate(`(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
        const processingDialog = dialogs.find(d => {
          const t = (d.innerText || '').toLowerCase();
          return t.includes('xử lý thước phim') || t.includes('đăng thước phim') || t.includes('lên lịch') || t.includes('thước phim');
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
