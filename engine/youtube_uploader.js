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
  let studioTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('studio.youtube.com'));
  if (!studioTab) {
    studioTab = await postPut(`${PROXY_BASE}/json/new?${STUDIO_URL}`, 'PUT');
    await sleep(4000);
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
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.ready;

  try {
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
    const studioUrl = config.resolveChannelUrl ? config.resolveChannelUrl(channel) : (config.YOUTUBE_STUDIO_URL || 'https://studio.youtube.com');
    await client.send('Page.navigate', { url: studioUrl });
    await sleep(4000);
    await client.dismissModals();

    // 2. Kích hoạt menu Tạo / Tải video lên
    console.error(`[-] Mở hộp thoại tải video lên trên YouTube Studio...`);
    const openedDialog = await client.eval(`(() => {
      const btns = Array.from(document.querySelectorAll('button, ytcp-button'));
      const createBtn = btns.find(b => (b.innerText && b.innerText.trim() === 'Tạo') || b.getAttribute('aria-label') === 'Tạo' || b.id === 'create-icon');
      if (createBtn) {
        createBtn.click();
        return 'CREATE_CLICKED';
      }
      const directUpload = document.querySelector('button[aria-label*="Tải video lên"], button[aria-label*="Upload videos"], #upload-icon, #upload-button');
      if (directUpload && directUpload.offsetParent !== null) {
        directUpload.click();
        return 'DIRECT_CLICKED';
      }
      return 'NO_BTN';
    })()`);

    await sleep(1500);

    if (openedDialog === 'CREATE_CLICKED') {
      await client.eval(`(() => {
        const items = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-menu #items tp-yt-paper-item, #text-item-0'));
        const upItem = items.find(i => i.innerText && (i.innerText.includes('Tải video lên') || i.innerText.includes('Upload videos')));
        if (upItem) upItem.click();
      })()`);
      await sleep(2000);
    }

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

    // 4. Chờ metadata editor xuất hiện (tối đa 35s)
    let editorReady = false;
    for (let i = 0; i < 35; i++) {
      await sleep(1000);
      editorReady = await client.eval(`(() => {
        const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea');
        return !!titleBox;
      })()`);
      if (editorReady) break;
    }

    if (!editorReady) {
      throw new Error('Hộp thoại chỉnh sửa chi tiết video (Metadata editor) không xuất hiện sau khi chọn file.');
    }

    console.error(`[-] Điền tiêu đề và mô tả video...`);
    // 5. Điền Title và Description
    await client.eval(`((titleText, descText) => {
      const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea [contenteditable="true"]');
      if (titleBox) {
        titleBox.focus();
        titleBox.innerText = titleText;
        titleBox.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const descBox = document.querySelector('#textbox[aria-label*="Mô tả"], #textbox[aria-label*="Description"], ytcp-social-suggestions-textbox#description-textarea [contenteditable="true"]');
      if (descBox && descText) {
        descBox.focus();
        descBox.innerText = descText;
        descBox.dispatchEvent(new Event('input', { bubbles: true }));
      }

      const notForKids = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #not-made-for-kids');
      if (notForKids) {
        notForKids.click();
      }
    })(${JSON.stringify(title)}, ${JSON.stringify(description)})`);

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
        const nextBtn = document.querySelector('#next-button, button#next-button, ytcp-button#next-button');
        if (nextBtn) nextBtn.click();
      })()`);
      await sleep(1500);
    }

    // 8. Chọn chế độ hiển thị hoặc Lên lịch
    if (schedData) {
      console.error(`[-] Cấu hình LÊN LỊCH: ${schedData.formattedDate} lúc ${schedData.time}...`);
      // Kích hoạt accordion/radio Lên lịch
      const scheduleOpened = await client.eval(`(() => {
        // 0. Polymer API direct call
        const visSelect = document.querySelector('ytcp-video-visibility-select');
        if (visSelect) {
          if (typeof visSelect.expandSecondContainerCollapseOthers === 'function') {
            visSelect.expandSecondContainerCollapseOthers();
          }
          if (typeof visSelect.changeSelectionToSchedule === 'function') {
            visSelect.changeSelectionToSchedule();
          }
        }

        // 1. New YouTube Studio UI: #second-container with expand button
        const expandBtn = document.querySelector('#second-container-expand-button, #second-container .early-access-header, [tooltip-label*="expand"]');
        if (expandBtn) {
          expandBtn.click();
          return true;
        }

        // 2. Radio button format
        const schedRadio = document.querySelector('#schedule-radio-button #radioContainer, #schedule-radio-button, tp-yt-paper-radio-button[name="SCHEDULE"], #second-container-checkbox');
        if (schedRadio) {
          schedRadio.click();
          return true;
        }
        const allRadios = Array.from(document.querySelectorAll('tp-yt-paper-radio-button'));
        const match = allRadios.find(r => (r.innerText || '').includes('Lên lịch') || (r.innerText || '').includes('Schedule'));
        if (match) {
          match.click();
          return true;
        }
        return false;
      })()`);

      if (!scheduleOpened) {
        throw new Error('Không tìm thấy nút tùy chọn Lên lịch (Schedule) trên YouTube Studio');
      }

      await sleep(1500);

      // Chờ ytcp-datetime-picker xuất hiện
      let pickerFound = false;
      for (let pAttempt = 0; pAttempt < 15; pAttempt++) {
        pickerFound = await client.eval(`(() => !!document.querySelector('ytcp-datetime-picker'))()`);
        if (pickerFound) break;
        await sleep(800);
      }

      if (!pickerFound) {
        throw new Error('ytcp-datetime-picker không xuất hiện sau khi chọn Lên lịch');
      }

      // Điền Date & Time qua Polymer component model
      console.error(`    [-] Điền ngày & giờ: ${schedData.year}-${schedData.month}-${schedData.day} ${schedData.time}...`);
      const setDateRes = await client.eval(`((targetYear, targetMonth, targetDay, targetTime) => {
        try {
          const picker = document.querySelector('ytcp-datetime-picker');
          const datePicker = document.querySelector('ytcp-date-picker');
          const parent = document.querySelector('ytcp-video-visibility-select');
          if (!picker) return { ok: false, error: 'no picker' };

          // 1. Trích xuất target day object từ ytcp-scrollable-calendar nếu có
          let dateObj = { year: targetYear, month: targetMonth - 1, day: targetDay };
          const list = document.querySelector('ytcp-scrollable-calendar tp-yt-iron-list');
          if (list && list.items) {
            for (const item of list.items) {
              if (item.weeks) {
                const found = item.weeks.flat().find(d => d.date && d.date.year === targetYear && d.date.month === (targetMonth - 1) && d.date.day === targetDay);
                if (found && found.date) {
                  dateObj = found.date;
                  break;
                }
              }
            }
          }

          // 2. Dispatch qua datePicker.fire('ytcp-date-picker-selected', dateObj)
          if (datePicker && typeof datePicker.fire === 'function') {
            datePicker.fire('ytcp-date-picker-selected', dateObj);
          } else if (datePicker && typeof datePicker.onDateClicked === 'function') {
            datePicker.onDateClicked({ detail: dateObj });
          }

          // 3. Tính toán seconds từ targetTime ("08:00" -> 28800, "13:00" -> 46800)
          const [hStr, mStr] = (targetTime || '08:00').split(':');
          const hours = parseInt(hStr, 10) || 0;
          const mins = parseInt(mStr, 10) || 0;
          const totalSeconds = hours * 3600 + mins * 60;

          // 4. Set time trên picker model và parent visibility-select
          if (picker.set) {
            picker.set('model.selectedTimeOfDayValue', totalSeconds);
            picker.set('renderData.selectedTimeOfDayString', targetTime);
          }
          if (parent && parent.set) {
            parent.set('model.schedulingDate.selectedTimeOfDayValue', totalSeconds);
          }

          const paperInput = picker.querySelector('#textbox');
          if (paperInput) {
            paperInput.value = targetTime;
            const inp = paperInput.querySelector('input');
            if (inp) inp.value = targetTime;
          }

          if (parent && typeof parent.onScheduledVisibilityChange === 'function') {
            parent.onScheduledVisibilityChange({ detail: picker.model });
          }

          return {
            ok: true,
            dateString: picker.get ? picker.get('renderData.dateString') : null,
            timeString: targetTime,
            parentModel: parent ? parent.model.schedulingDate : null
          };
        } catch(err) {
          return { ok: false, error: err.message, stack: err.stack };
        }
      })(${schedData.year}, ${schedData.month}, ${schedData.day}, ${JSON.stringify(schedData.time)})`);

      console.error(`    [+] Kết quả chọn ngày giờ:`, JSON.stringify(setDateRes));
      await sleep(500);

      // Thay thế text trực tiếp vào ô input giờ của YouTube Studio qua CDP (chuẩn hóa theo chỉ thị Captain)
      const timeInputFocused = await client.eval(`(() => {
        const dt = document.querySelector('ytcp-datetime-picker');
        const inp = dt ? dt.querySelector('input') : null;
        if (inp) {
          inp.focus();
          inp.select();
          return true;
        }
        return false;
      })()`);

      if (timeInputFocused) {
        await client.send('Input.insertText', { text: schedData.time });
        await client.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
        await sleep(500);
        console.error(`    [✓] Đã thay thế và xác nhận text giờ YouTube: ${schedData.time}`);
      }

      await sleep(1000);

    } else {
      console.error(`[-] Thiết lập chế độ hiển thị: ${visibility.toUpperCase()}...`);
      await client.eval(`((vis) => {
        const radioName = vis === 'public' ? 'PUBLIC' : (vis === 'private' ? 'PRIVATE' : 'UNLISTED');
        const radio = document.querySelector(\`tp-yt-paper-radio-button[name="\${radioName}"]\`);
        if (radio) {
          radio.click();
        }
      })(${JSON.stringify(visibility)})`);
      await sleep(1000);
    }

    // 9. Lấy đường link YouTube xem trước
    const videoUrl = await client.eval(`(() => {
      const linkEl = document.querySelector('a.ytcp-video-info[href*="youtu.be"], a.style-scope.ytcp-video-info, .video-url-fadeable a, a[href*="youtu.be"]');
      return linkEl ? linkEl.href : null;
    })()`);

    console.error(`[-] Lưu cài đặt xuất bản video...`);
    // 10. Bấm nút LƯU / XUẤT BẢN / LÊN LỊCH (#done-button)
    await client.eval(`(() => {
      const doneBtn = document.querySelector('#done-button, button#done-button, ytcp-button#done-button');
      if (doneBtn) doneBtn.click();
    })()`);

    // 11. Chờ xác nhận và đóng dialog
    let finalUrl = videoUrl;
    for (let w = 0; w < 12; w++) {
      await sleep(1000);
      const confirmedUrl = await client.eval(`(() => {
        const link = document.querySelector('a[href*="youtu.be"], .share-url a');
        const closeBtn = document.querySelector('#close-button, ytcp-button#close-button');
        if (closeBtn) closeBtn.click();
        return link ? link.href : null;
      })()`);
      if (confirmedUrl) {
        finalUrl = confirmedUrl;
        break;
      }
    }

    try {
      await client.eval(`(() => {
        const closeBtn = document.querySelector('ytcp-uploads-dialog #close-button, ytcp-dialog #close-button, tp-yt-paper-dialog #close-button, #dismiss-button');
        if (closeBtn) closeBtn.click();
      })()`);
    } catch {}

    client.close();

    try {
      if (finalUrl && finalUrl.includes('youtu.be')) {
        const jParsed = jev.verify(finalUrl + ' ' + title, 'video upload succeeded with shareable link');
        console.error(`  [TypeSafe Jev: ${jParsed.verified ? 'Verified ✓' : 'Unverified ✗'}] Xác thực xuất bản YouTube.`);
      }
    } catch {}

    const videoId = finalUrl ? (finalUrl.split('/').pop().split('?')[0]) : null;

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
    const errorScreenshot = path.join(config.PROJECT_DIR, 'renders', 'qa_inspect', `yt_error_${Date.now()}.png`);
    await client.captureScreenshot(errorScreenshot).catch(() => {});
    client.close();
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
