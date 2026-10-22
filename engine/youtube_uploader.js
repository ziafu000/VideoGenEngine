#!/usr/bin/env node
/**
 * engine/youtube_uploader.js: Automated YouTube Studio Video Uploader via Chrome DevTools Protocol.
 *
 * Supports uploading and scheduling videos directly via YouTube Creator Studio UI
 * without consuming YouTube Data API v3 quota (0 API cost).
 *
 * Usage:
 *   node engine/youtube_uploader.js status
 *   node engine/youtube_uploader.js upload --video <path> [--title <title>] [--description <desc>] [--visibility <unlisted|private|public|scheduled>] [--thumbnail <path>] [--schedule "DD/MM/YYYY HH:mm"]
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { CDPClient, sleep } = require('./cdp');
const jev = require('./jev');

const PROXY_BASE = config.CDP_URL;
const STUDIO_URL = 'https://studio.youtube.com';

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse JSON from ${url}: ${e.message}`));
        }
      });
    }).on('error', reject);
  });
}

function postPut(url, method = 'POST') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: method
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function getStudioTab() {
  const tabs = await fetchJson(`${PROXY_BASE}/json/list`);
  let studioTab = tabs.find(t => {
    if (t.type !== 'page' || !t.url) return false;
    try {
      const u = new URL(t.url);
      return u.hostname === 'studio.youtube.com';
    } catch {
      return false;
    }
  });
  if (!studioTab) {
    studioTab = await postPut(`${PROXY_BASE}/json/new?${STUDIO_URL}`, 'PUT');
    await sleep(4000);
  }
  if (studioTab && studioTab.id) {
    try {
      await postPut(`${PROXY_BASE}/json/activate/${studioTab.id}`, 'GET');
    } catch {}
  }
  return studioTab;
}

function parseScheduleTime(schedule) {
  if (!schedule) return null;
  const str = String(schedule).trim();
  const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})$/);
  if (dmyMatch) {
    const day = parseInt(dmyMatch[1], 10);
    const month = parseInt(dmyMatch[2], 10);
    const year = parseInt(dmyMatch[3], 10);
    const hour = dmyMatch[4].padStart(2, '0');
    const min = dmyMatch[5].padStart(2, '0');
    return {
      day,
      month,
      year,
      hour,
      min,
      time: `${hour}:${min}`,
      formattedDate: `${day} thg ${month}, ${year}`,
      altDate: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    };
  }
  const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})[T\s]+(\d{1,2}):(\d{2})/);
  if (ymdMatch) {
    const year = parseInt(ymdMatch[1], 10);
    const month = parseInt(ymdMatch[2], 10);
    const day = parseInt(ymdMatch[3], 10);
    const hour = ymdMatch[4].padStart(2, '0');
    const min = ymdMatch[5].padStart(2, '0');
    return {
      day,
      month,
      year,
      hour,
      min,
      time: `${hour}:${min}`,
      formattedDate: `${day} thg ${month}, ${year}`,
      altDate: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`
    };
  }
  return null;
}

async function cmdStatus() {
  try {
    const studioTab = await getStudioTab();
    const client = new CDPClient(studioTab.webSocketDebuggerUrl);
    await client.ready;

    const status = await client.eval(`(() => {
      const url = window.location.href;
      if (url.includes('accounts.google.com') || url.includes('signin')) {
        return { logged_in: false, state: 'NEED_LOGIN', url: url };
      }
      const channelEl = document.querySelector('#channel-title, #entity-name, .channel-name');
      const channelName = channelEl ? channelEl.innerText.trim() : 'Unknown';
      const uploadBtn = document.querySelector('button[aria-label*="Tải video lên"], button[aria-label*="Upload videos"], #create-icon, button[aria-label*="Tạo"], button[aria-label*="Create"]');
      return {
        logged_in: true,
        state: 'READY',
        channel_name: channelName,
        can_upload: !!uploadBtn,
        url: url
      };
    })()`);

    client.close();
    console.log(JSON.stringify({ ok: true, status }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
    process.exit(1);
  }
}

async function cmdUpload(args) {
  const videoFile = args.video;
  if (!videoFile || !fs.existsSync(videoFile)) {
    console.error(JSON.stringify({ ok: false, error: `Video file not found: ${videoFile}` }));
    process.exit(1);
  }

  const title = args.title || path.basename(videoFile, path.extname(videoFile));
  const description = args.description || '';
  const schedData = parseScheduleTime(args.schedule);
  const visibility = schedData ? 'scheduled' : ((args.visibility || 'unlisted').toLowerCase());
  const thumbnail = args.thumbnail && fs.existsSync(args.thumbnail) ? args.thumbnail : null;

  const winVideoPath = config.toWinPath(videoFile);
  const winThumbPath = thumbnail ? config.toWinPath(thumbnail) : null;
  const channel = args.channel || null;

  console.error(`[-] Chuẩn bị upload video lên YouTube Studio...`);
  console.error(`  - Video: ${videoFile} (Windows: ${winVideoPath})`);
  console.error(`  - Tiêu đề: ${title}`);
  console.error(`  - Chế độ: ${schedData ? `LÊN LỊCH (${schedData.formattedDate} lúc ${schedData.time})` : visibility.toUpperCase()}`);

  const studioTab = await getStudioTab();
  let client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.ready;

  try {
    await client.send('Page.bringToFront').catch(() => {});
    await client.enableDialogHandling();
    await client.dismissModals();

    // 1. Kiểm tra trạng thái đăng nhập
    const isLogin = await client.eval(`(() => {
      return !window.location.href.includes('accounts.google.com') && !window.location.href.includes('signin');
    })()`);

    if (!isLogin) {
      throw new Error('Chưa đăng nhập tài khoản YouTube. Vui lòng mở Chrome đăng nhập vào studio.youtube.com trước.');
    }

    // 1b. Đảm bảo trang Studio ở trạng thái sạch sẽ hoàn toàn
    console.error(`[-] Chuẩn bị giao diện Studio sạch...`);
    const studioUrl = config.resolveChannelUrl ? config.resolveChannelUrl(channel) : null;
    if (studioUrl) {
      const targetChannelMatch = studioUrl.match(/channel\/([^\/\?]+)/);
      const targetCid = targetChannelMatch ? targetChannelMatch[1] : null;

      let curUrl = await client.eval('window.location.href');
      if (targetCid && !curUrl.includes(targetCid)) {
        console.error(`[-] Điều hướng chính xác sang kênh được chỉ định: ${studioUrl}`);
        await client.send('Page.navigate', { url: studioUrl });
        await sleep(5000);
        curUrl = await client.eval('window.location.href');
      }

      if (targetCid && !curUrl.includes(targetCid)) {
        throw new Error(`[CRITICAL] Kênh hiện tại (${curUrl}) không khớp với Channel ID đích (${targetCid})! Dừng upload ngay lập tức.`);
      }
    } else {
      console.error(`[-] Không chỉ định kênh cố định: Giữ nguyên kênh đang mở sẵn trên tab Chrome.`);
    }
    await client.dismissModals();

    // 2. Kích hoạt menu Tạo / Tải video lên
    console.error(`[-] Mở hộp thoại tải video lên trên YouTube Studio...`);
    await client.eval(`(() => {
      // 1. Direct upload button on dashboard
      const direct = document.querySelector('#upload-button, [aria-label*="Tải video lên"], ytcp-button#upload-button, button#upload-button');
      if (direct && direct.offsetParent !== null) {
        direct.click();
        return;
      }
      // 2. Create button in top bar
      const create = Array.from(document.querySelectorAll('button, ytcp-button')).find(b => {
        const t = (b.innerText || '').trim();
        const a = b.getAttribute('aria-label') || '';
        return t === 'Tạo' || a === 'Tạo' || a.includes('Create') || b.id === 'create-icon';
      });
      if (create) {
        create.click();
        setTimeout(() => {
          const item = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-menu #items tp-yt-paper-item, #text-item-0, [role="menuitem"]')).find(i => {
            const txt = i.innerText || '';
            return txt.includes('Tải video lên') || txt.includes('Upload video');
          });
          if (item) item.click();
        }, 1000);
      }
    })()`);

    await sleep(2500);

    // 3. Tìm phần tử input file và nạp file video qua CDP DOM.setFileInputFiles
    console.error(`[-] Đang truyền file video vào Chrome qua CDP DOM.setFileInputFiles...`);
    await client.send('DOM.enable');

    let nodeId = 0;
    for (let attempt = 0; attempt < 20; attempt++) {
      const evalRes = await client.send('Runtime.evaluate', {
        expression: 'document.querySelector("input[type=\'file\']")'
      });

      if (evalRes.result && evalRes.result.objectId) {
        try {
          const nodeDesc = await client.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) {
            nodeId = nodeDesc.nodeId;
            break;
          }
        } catch {}
      }

      const doc = await client.send('DOM.getDocument', { depth: -1 });
      const fileInputNode = await client.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"][name="Filedata"], ytcp-uploads-dialog input[type="file"], input[type="file"]'
      });
      if (fileInputNode && fileInputNode.nodeId) {
        nodeId = fileInputNode.nodeId;
        break;
      }

      await sleep(1000);
    }

    if (!nodeId) {
      throw new Error('Không tìm thấy ô input file trên YouTube Studio uploads dialog.');
    }

    await client.send('DOM.setFileInputFiles', {
      files: [winVideoPath],
      nodeId: nodeId
    });

    console.error(`✓ Đã nạp file video thành công! Chờ YouTube xử lý metadata dialog...`);

    // 4. Chờ metadata editor xuất hiện đầy đủ cả 2 ô Title và Description (tối đa 35s)
    let editorReady = false;
    for (let i = 0; i < 35; i++) {
      await sleep(1000);
      editorReady = await client.eval(`(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const boxes = dialog.querySelectorAll('#textbox[contenteditable="true"], ytcp-social-suggestions-textbox #textbox');
        const nfk = dialog.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #not-made-for-kids');
        return !!(boxes.length >= 2 && nfk);
      })()`);
      if (editorReady) break;
    }

    if (!editorReady) {
      throw new Error('Hộp thoại chỉnh sửa chi tiết video (Metadata editor) không xuất hiện sau khi chọn file.');
    }

    await sleep(2500);
    // Đảm bảo tiêu đề <= 100 ký tự theo giới hạn bắt buộc của YouTube
    const safeTitle = title.length > 100 ? title.slice(0, 97).trim() + '...' : title;
    console.error(`[-] Điền tiêu đề (${safeTitle.length}/100 ký tự) và mô tả video (${description.length} ký tự)...`);

    // 5. Điền Title và Description (kết hợp execCommand('insertText') + Polymer events + kiểm tra đối soát chống ghi đè bởi Upload Defaults)
    for (let metaAttempt = 0; metaAttempt < 4; metaAttempt++) {
      const metaCheck = await client.eval(`((titleText, descText) => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const allBoxes = Array.from(dialog.querySelectorAll('#textbox[contenteditable="true"], ytcp-social-suggestions-textbox #textbox'));
        const titleContainer = dialog.querySelector('#title-textarea, ytcp-video-title, ytcp-mention-textbox[label*="Tiêu đề"], ytcp-mention-textbox[label*="Title"]');
        const descContainer = dialog.querySelector('#description-textarea, ytcp-video-description, ytcp-mention-textbox[label*="Mô tả"], ytcp-mention-textbox[label*="Description"]');
        const titleBox = (titleContainer && titleContainer.querySelector('#textbox')) || allBoxes[0];
        const descBox = (descContainer && descContainer.querySelector('#textbox')) || allBoxes[1];

        function fillPolymerBox(box, text) {
          if (!box || !text) return '';
          box.scrollIntoView({ block: 'center', behavior: 'instant' });
          box.focus();
          try {
            const sel = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(box);
            sel.removeAllRanges();
            sel.addRange(range);
            document.execCommand('selectAll', false, null);
            document.execCommand('delete', false, null);
            document.execCommand('insertText', false, text);
          } catch {}
          if ((box.innerText || '').trim() !== text.trim()) {
            box.textContent = text;
          }
          box.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
          box.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: text, inputType: 'insertText' }));
          box.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          box.dispatchEvent(new Event('blur', { bubbles: true, composed: true }));
          const host = box.closest('ytcp-social-suggestions-textbox, ytcp-mention-textbox');
          if (host) {
            host.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            host.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
          }
          return (box.innerText || '').trim();
        }

        const actualTitle = fillPolymerBox(titleBox, titleText);
        const actualDesc = descBox !== titleBox ? fillPolymerBox(descBox, descText) : '';

        const notForKids = dialog.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"] #radioContainer, tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #not-made-for-kids');
        if (notForKids) {
          notForKids.click();
        }

        return { actualTitle, actualDesc };
      })(${JSON.stringify(safeTitle)}, ${JSON.stringify(description)})`);

      await sleep(800);

      // Kiểm tra lại sau 800ms xem YouTube Upload Defaults có ghi đè lại "Original AI Video Production" không
      const verifyMeta = await client.eval(`(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const allBoxes = Array.from(dialog.querySelectorAll('#textbox[contenteditable="true"], ytcp-social-suggestions-textbox #textbox'));
        const titleContainer = dialog.querySelector('#title-textarea, ytcp-video-title');
        const descContainer = dialog.querySelector('#description-textarea, ytcp-video-description');
        const titleBox = (titleContainer && titleContainer.querySelector('#textbox')) || allBoxes[0];
        const descBox = (descContainer && descContainer.querySelector('#textbox')) || allBoxes[1];
        return {
          title: titleBox ? (titleBox.innerText || '').trim() : '',
          desc: descBox ? (descBox.innerText || '').trim() : ''
        };
      })()`);

      const titleOk = verifyMeta.title === safeTitle.trim();
      const descOk = !description || (verifyMeta.desc.length >= Math.min(20, description.length) && !verifyMeta.desc.includes('Original AI Video Production'));
      if (titleOk && descOk) {
        console.error(`    [✓] Đã xác nhận Tiêu đề (${verifyMeta.title.length} ký tự) & Mô tả (${verifyMeta.desc.length} ký tự) trên YouTube Studio!`);
        break;
      }
      console.error(`    [!] Thử lại điền Tiêu đề/Mô tả (lần ${metaAttempt + 1}/4) — desc hiện tại: "${verifyMeta.desc.slice(0, 40)}"...`);
      await sleep(1000);
    }

    // 6. Tải thumbnail (nếu có)
    if (winThumbPath) {
      try {
        console.error(`[-] Đang tải thumbnail tùy chỉnh...`);
        const doc = await client.send('DOM.getDocument', { depth: -1 });
        const thumbNode = await client.send('DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: 'input#file-loader[type="file"], input[type="file"][accept*="image"]'
        });
        if (thumbNode && thumbNode.nodeId) {
          await client.send('DOM.setFileInputFiles', {
            files: [winThumbPath],
            nodeId: thumbNode.nodeId
          });
          console.error(`✓ Đã nạp thumbnail thành công.`);
        }
      } catch (thumbErr) {
        console.error(`[!] Bỏ qua thumbnail do lỗi: ${thumbErr.message}`);
      }
    }

    await sleep(1000);

    // 7. Vượt qua các bước: Bước 1 (Chi tiết) -> Bước 2 (Thành phần) -> Bước 3 (Kiểm tra) -> Bước 4 (Hiển thị)
    console.error(`[-] Điều hướng qua các bước kiểm tra (Checks) sang bước Hiển thị...`);
    for (let step = 1; step <= 3; step++) {
      await client.eval(`(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const nextBtn = dialog.querySelector('#next-button button, #next-button, ytcp-button#next-button');
        if (nextBtn) nextBtn.click();
      })()`);
      await sleep(1500);
    }

    // 8. Chọn chế độ hiển thị hoặc Lên lịch (scope chặt trong ytcp-uploads-dialog)
    if (schedData) {
      console.error(`[-] Cấu hình LÊN LỊCH: ${schedData.formattedDate} lúc ${schedData.time}...`);
      const scheduleOpened = await client.eval(`(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const visSelect = dialog.querySelector('ytcp-video-visibility-select');
        if (visSelect && typeof visSelect.expandSecondContainerCollapseOthers === 'function') {
          visSelect.expandSecondContainerCollapseOthers();
          if (typeof visSelect.changeSelectionToSchedule === 'function') {
            visSelect.changeSelectionToSchedule();
          }
          return true;
        }

        const expandBtn = dialog.querySelector('#second-container-expand-button, #schedule-radio-button #radioContainer, #schedule-radio-button, tp-yt-paper-radio-button[name="SCHEDULE"]');
        if (expandBtn) {
          expandBtn.click();
          return true;
        }
        return false;
      })()`);

      if (!scheduleOpened) {
        throw new Error('Không tìm thấy nút tùy chọn Lên lịch (Schedule) trên YouTube Studio');
      }

      await sleep(1500);

      // Chờ ytcp-datetime-picker xuất hiện bên trong ytcp-uploads-dialog
      let pickerFound = false;
      for (let pAttempt = 0; pAttempt < 15; pAttempt++) {
        pickerFound = await client.eval(`(() => {
          const dialog = document.querySelector('ytcp-uploads-dialog') || document;
          return !!dialog.querySelector('ytcp-datetime-picker');
        })()`);
        if (pickerFound) break;
        await sleep(800);
      }

      if (!pickerFound) {
        throw new Error('ytcp-datetime-picker không xuất hiện sau khi chọn Lên lịch');
      }

      // Điền Date & Time qua Polymer component model-change event
      console.error(`    [-] Điền ngày & giờ: ${schedData.year}-${schedData.month}-${schedData.day} ${schedData.time}...`);
      const setDateRes = await client.eval(`((targetYear, targetMonth, targetDay, targetTime) => {
        try {
          const dialog = document.querySelector('ytcp-uploads-dialog') || document;
          const picker = dialog.querySelector('ytcp-datetime-picker');
          const parent = dialog.querySelector('ytcp-video-visibility-select');
          if (!picker) return { ok: false, error: 'no picker' };

          const dateObj = { year: targetYear, month: targetMonth - 1, day: targetDay };
          const [hStr, mStr] = (targetTime || '08:00').split(':');
          const hours = parseInt(hStr, 10) || 0;
          const mins = parseInt(mStr, 10) || 0;
          const totalSeconds = hours * 3600 + mins * 60;

          const newModel = Object.assign({}, picker.model || {}, {
            date: dateObj,
            selectedTimeOfDayValue: totalSeconds,
            selectedTimezoneIndex: (picker.model && picker.model.selectedTimezoneIndex != null) ? picker.model.selectedTimezoneIndex : 0
          });

          if (typeof picker.fire === 'function') {
            picker.fire('model-change', newModel);
          } else {
            picker.dispatchEvent(new CustomEvent('model-change', { detail: newModel, bubbles: true, composed: true }));
          }

          if (parent && typeof parent.onScheduledVisibilityChange === 'function') {
            parent.onScheduledVisibilityChange({ detail: newModel });
          }

          return {
            ok: true,
            dateString: picker.renderData ? picker.renderData.dateString : null,
            timeString: picker.renderData ? picker.renderData.selectedTimeOfDayString : targetTime,
            model: picker.model
          };
        } catch(err) {
          return { ok: false, error: err.message, stack: err.stack };
        }
      })(${schedData.year}, ${schedData.month}, ${schedData.day}, ${JSON.stringify(schedData.time)})`);

      console.error(`    [+] Kết quả chọn ngày giờ:`, JSON.stringify(setDateRes));
      await sleep(1000);

    } else {
      console.error(`[-] Thiết lập chế độ hiển thị: ${visibility.toUpperCase()}...`);
      await client.eval(`((vis) => {
        const dialog = document.querySelector('ytcp-uploads-dialog') || document;
        const radioName = vis === 'public' ? 'PUBLIC' : (vis === 'private' ? 'PRIVATE' : 'UNLISTED');
        const radio = dialog.querySelector(\`tp-yt-paper-radio-button[name="\${radioName}"]\`);
        if (radio) {
          radio.click();
        }
      })(${JSON.stringify(visibility)})`);
      await sleep(1000);
    }

    // 9. Lấy đường link YouTube xem trước (chỉ lấy từ bước Chi tiết trong ytcp-uploads-dialog)
    const videoUrl = await client.eval(`(() => {
      const dialog = document.querySelector('ytcp-uploads-dialog');
      if (!dialog) return null;
      const linkEl = dialog.querySelector('a.ytcp-video-info[href*="youtu.be"], a.style-scope.ytcp-video-info, .video-url-fadeable a, a[href*="youtu.be"]');
      return linkEl && linkEl.href ? linkEl.href : null;
    })()`);

    // 9b. Chờ upload bytes truyền xong lên máy chủ YouTube
    console.error(`[-] Đang chờ máy chủ YouTube tiếp nhận toàn bộ dữ liệu video...`);
    for (let upWait = 0; upWait < 180; upWait++) {
      const upProgress = await client.eval(`(() => {
        const dialog = document.querySelector('ytcp-uploads-dialog');
        if (!dialog) return 'NO_DIALOG';
        const p = dialog.querySelector('ytcp-video-upload-progress, .progress-label');
        return p ? (p.innerText || '').trim() : '';
      })()`);
      if (upProgress && (upProgress.includes('Đã tải lên') || upProgress.includes('xử lý') || upProgress.includes('hoàn tất') || upProgress.includes('complete') || upProgress.includes('Processing') || upProgress.includes('Đã kiểm tra xong'))) {
        console.error(`    [✓] Trạng thái: ${upProgress}`);
        break;
      }
      if (upProgress && upWait % 5 === 0) {
        console.error(`    [-] Tiến độ: ${upProgress}...`);
      }
      await sleep(2000);
    }

    console.error(`[-] Lưu cài đặt xuất bản video...`);
    // 10. Bấm nút LƯU / XUẤT BẢN / LÊN LỊCH (#done-button trong ytcp-uploads-dialog)
    try {
      await Promise.race([
        client.eval(`(() => {
          const dialog = document.querySelector('ytcp-uploads-dialog') || document;
          const doneBtn = dialog.querySelector('#done-button button, #done-button [role="button"], #done-button, button#done-button, ytcp-button#done-button');
          if (doneBtn) doneBtn.click();
        })()`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), 4000))
      ]);
    } catch {
      try { client.close(true); } catch {}
      await sleep(500);
      const freshTab = await getStudioTab();
      client = new CDPClient(freshTab.webSocketDebuggerUrl);
      await client.ready;
    }

    // 10b. Đợi chậm rãi để bắt pop-up kiểm duyệt sơ bộ nếu upload nhanh chưa kịp check xong
    await sleep(3500);
    try {
      await Promise.race([
        client.eval(`(() => {
          const preDialog = document.querySelector('ytcp-prechecks-warning-dialog');
          if (preDialog && preDialog.offsetParent !== null) {
            const secBtn = preDialog.querySelector('#secondary-action-button button, #secondary-action-button');
            if (secBtn && secBtn.offsetParent !== null) {
              secBtn.click();
              return;
            }
            const priBtn = preDialog.querySelector('#primary-action-button button, #primary-action-button');
            if (priBtn && priBtn.offsetParent !== null) {
              priBtn.click();
              return;
            }
          }
          const all = Array.from(document.querySelectorAll('ytcp-prechecks-warning-dialog ytcp-button, ytcp-prechecks-warning-dialog button'));
          const target = all.find(b => {
            const t = (b.innerText || b.textContent || '').trim();
            return t.includes('xuất bản') || t.includes('Publish anyway') || t.includes('Đã hiểu') || t.includes('Got it');
          });
          if (target) {
            const native = target.querySelector('button') || target;
            native.click();
          }
        })()`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), 4000))
      ]);
    } catch {
      try { client.close(true); } catch {}
      await sleep(500);
      const freshTab = await getStudioTab();
      client = new CDPClient(freshTab.webSocketDebuggerUrl);
      await client.ready;
    }

    // 11. Chờ xác nhận rằng hộp thoại ytcp-uploads-dialog đã lưu xong hoặc hiện dialog xác nhận xuất bản/lên lịch
    let finalUrl = videoUrl;
    let publishConfirmed = false;
    for (let w = 0; w < 20; w++) {
      await sleep(1000);
      let checkState = { state: 'WAITING' };
      try {
        checkState = await Promise.race([
          client.eval(`(() => {
            // Check if prechecks warning dialog appeared late
            const preDialog = document.querySelector('ytcp-prechecks-warning-dialog');
            if (preDialog && preDialog.offsetParent !== null) {
              const btn = preDialog.querySelector('#secondary-action-button button, #secondary-action-button, #primary-action-button button, #primary-action-button');
              if (btn && btn.offsetParent !== null) {
                btn.click();
                return { state: 'PRECHECK_CLICKED' };
              }
            }
            const shareDialog = document.querySelector('ytcp-video-share-dialog, ytcp-uploads-still-processing-dialog');
            const upDialog = document.querySelector('ytcp-uploads-dialog');
            const upDialogOpen = upDialog && (upDialog.offsetParent !== null || upDialog.hasAttribute('opened'));
            if (shareDialog && (shareDialog.offsetParent !== null || shareDialog.innerText.includes('Đã lên lịch') || shareDialog.innerText.includes('Đã lưu') || shareDialog.innerText.includes('Scheduled'))) {
              const link = shareDialog.querySelector('a[href*="youtu.be"], .share-url a');
              const shareUrl = link ? link.href : null;
              const closeBtn = shareDialog.querySelector('#close-button, ytcp-button#close-button');
              if (closeBtn) closeBtn.click();
              return { state: 'CONFIRMED', url: shareUrl };
            }
            if (!upDialogOpen) {
              return { state: 'DIALOG_CLOSED', url: null };
            }
            // Check for daily upload limit error
            const errText = upDialog ? (upDialog.innerText || '') : '';
            if (errText.includes('giới hạn tải video lên hằng ngày') || errText.includes('Daily upload limit reached')) {
              return { state: 'QUOTA_LIMIT', error: 'Daily upload limit reached on YouTube Studio' };
            }
            return { state: 'WAITING', url: null };
          })()`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), 4000))
        ]);
      } catch (evalErr) {
        // Reconnect CDP client if YouTube Studio popup close froze the WebSocket
        try { client.close(true); } catch {}
        await sleep(500);
        const freshTab = await getStudioTab();
        client = new CDPClient(freshTab.webSocketDebuggerUrl);
        await client.ready;
        continue;
      }

      if (checkState.url) finalUrl = checkState.url;
      if (checkState.state === 'QUOTA_LIMIT') {
        throw new Error(checkState.error);
      }
      if (checkState.state === 'CONFIRMED' || checkState.state === 'DIALOG_CLOSED') {
        publishConfirmed = true;
        break;
      }
    }

    if (!publishConfirmed) {
      throw new Error('Hộp thoại tải lên chưa đóng hoặc chưa xác nhận trạng thái xuất bản/lên lịch sau khi bấm Lưu/Lên lịch!');
    }

    if (!finalUrl) {
      // Fallback: lấy từ dòng đầu tiên trên danh sách video của Studio vừa được cập nhật
      await sleep(2000);
      try {
        finalUrl = await Promise.race([
          client.eval(`((expectedTitle) => {
            const rows = Array.from(document.querySelectorAll('ytcp-video-row'));
            const match = rows.find(r => (r.innerText || '').includes(expectedTitle.slice(0, 30))) || rows[0];
            if (match) {
              const a = match.querySelector('a[href*="/video/"]');
              if (a) {
                const m = a.getAttribute('href').match(/\\/video\\/([^\\/\\?]+)/);
                if (m && m[1]) return 'https://youtu.be/' + m[1];
              }
            }
            return null;
          })(${JSON.stringify(safeTitle)})`),
          new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), 4000))
        ]);
      } catch {}
    }

    try {
      await Promise.race([
        client.eval(`(() => {
          const closeBtn = document.querySelector('ytcp-video-share-dialog #close-button, ytcp-uploads-still-processing-dialog #close-button, tp-yt-paper-dialog #close-button, #dismiss-button');
          if (closeBtn) closeBtn.click();
        })()`),
        new Promise((_, rej) => setTimeout(() => rej(new Error('EVAL_TIMEOUT')), 3000))
      ]);
    } catch {}

    try { client.close(true); } catch {}

    const videoId = finalUrl ? (finalUrl.split('/').pop().split('?')[0]) : null;

    if (!finalUrl || !videoId) {
      throw new Error('Không thể xác nhận video_id hoặc shareable URL từ YouTube Studio sau khi tải lên. Giao diện tải lên chưa hoàn tất hoặc bị gián đoạn!');
    }

    const outputResult = {
      success: true,
      video_id: videoId,
      video_url: finalUrl,
      title: title,
      visibility: schedData ? `scheduled (${schedData.formattedDate} ${schedData.time})` : visibility,
      uploaded_at: new Date().toISOString()
    };

    console.log(JSON.stringify(outputResult, null, 2));
    console.error(`\n✓ ĐÃ UPLOAD / LÊN LỊCH THÀNH CÔNG LÊN YOUTUBE!`);
    console.error(`  -> Link: ${finalUrl || 'Đang cập nhật'}`);
    console.error(`  -> Chế độ: ${schedData ? `LÊN LỊCH (${schedData.formattedDate} ${schedData.time})` : visibility.toUpperCase()}\n`);

  } catch (err) {
    const errorDir = path.join(config.PROJECT_DIR, 'renders', 'qa_inspect');
    const errorFile = `yt_error_${Date.now()}.png`;
    let errorScreenshot = path.join(errorDir, errorFile);
    if (client && typeof client.captureDiagnosticScreenshot === 'function') {
      const saved = await client.captureDiagnosticScreenshot(errorFile, errorDir).catch(() => null);
      if (saved) errorScreenshot = saved;
    } else if (client) {
      await client.captureScreenshot(errorScreenshot).catch(() => {});
    }
    if (client) client.close();
    console.error(JSON.stringify({ success: false, error: err.message, screenshot: errorScreenshot }, null, 2));
    process.exit(1);
  }
}

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

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0] || 'status';

  if (cmd === 'status') {
    await cmdStatus();
  } else if (cmd === 'upload') {
    const parsed = parseArgs(args.slice(1));
    await cmdUpload(parsed);
  } else {
    console.error('Usage: youtube_uploader.js {status | upload --video <path> [--title <t>] [--description <d>] [--visibility <unlisted|private|public>] [--schedule "DD/MM/YYYY HH:mm"]}');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
