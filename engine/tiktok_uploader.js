const fs = require('fs');
const path = require('path');
const config = require('./config');
const { getClientForPage, sleep } = require('./cdp');
const jev = require('./jev');

/**
 * Dismisses common popup obstacles and confirmation modals on TikTok Studio.
 */
async function dismissAllModals(cdp) {
  return await cdp.evaluate(`(() => {
    let clicked = [];
    const btns = Array.from(document.querySelectorAll("button, .TUXButton, .Button__root"));
    for (const b of btns) {
      const t = b.innerText?.trim();
      if (t === "Got it" || t === "Đã hiểu") { b.click(); clicked.push("Got it"); }
      if (t === "Allow" || t === "Cho phép") { b.click(); clicked.push("Allow"); }
      if (t === "Discard" || t === "Hủy") {
        if (b.closest(".TUXModal, [class*=modal], [class*=dialog], [class*=Modal]")) {
          b.click();
          clicked.push("Discard Modal");
        }
      }
    }
    return clicked;
  })()`);
}

/**
 * Upload a single vertical 9:16 Short to TikTok Studio with Jev-guided gates and scheduling support.
 *
 * @param {Object} options
 * @param {string} options.videoPath - Relative or absolute path to MP4
 * @param {string} [options.thumbnailPath] - Optional custom cover image
 * @param {string} options.caption - Caption and hashtags
 * @param {string|Object} [options.scheduleTime] - Schedule date/time e.g. "01/10/2026 08:00" or { year, month, day, hour, minute }
 */
async function uploadSingleShortToTikTok({
  videoPath,
  thumbnailPath,
  caption,
  scheduleTime
}) {
  const winVideo = config.toWinPath(videoPath);
  const winThumb = thumbnailPath ? config.toWinPath(thumbnailPath) : null;

  console.log(`\n============================================================`);
  console.log(`>>> TIKTOK UPLOAD & SCHEDULE (JEV DRIVEN): ${path.basename(videoPath)}`);
  console.log(`    - Video: ${winVideo}`);
  console.log(`    - Mode: ${scheduleTime ? `LÊN LỊCH (${typeof scheduleTime === 'string' ? scheduleTime : JSON.stringify(scheduleTime)})` : 'ĐĂNG NGAY (Now)'}`);
  console.log(`    - Thumbnail: ${winThumb || '(Auto từ video)'}`);
  console.log(`    - Caption: ${caption}`);
  console.log(`============================================================`);

  const cdp = await getClientForPage('tiktokstudio');
  await cdp.send('DOM.enable');

  // 1. Dọn dẹp cache draft IndexedDB và chuyển hướng về Upload sạch
  console.log('[-] [1/6] Chuẩn bị không gian tải lên sạch...');
  await cdp.evaluate(`(new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("web_creation_draft");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }))`);

  await cdp.send('Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN' });
  await sleep(3500);
  await dismissAllModals(cdp);
  await sleep(500);

  // Kiểm tra đăng nhập
  const pageSnippet = await cdp.evaluate('document.body.innerText.slice(0, 400)');
  const loginState = jev.classify(pageSnippet, {
    logged_in: "User is in creator studio upload page",
    login_required: "Login page or sign in form"
  });
  if (loginState.choice === 'login_required') {
    throw new Error('Chưa đăng nhập TikTok trên Chrome. Vui lòng đăng nhập trên Chrome trước.');
  }

  // 2. Tìm thẻ input file video & nạp file
  console.log('[-] [2/6] Nạp file video vào TikTok Studio...');
  let fileNodeId = 0;
  for (let attempt = 0; attempt < 25; attempt++) {
    try {
      const doc = await cdp.send('DOM.getDocument', { depth: -1 });
      const node = await cdp.send('DOM.querySelector', {
        nodeId: doc.root.nodeId,
        selector: 'input[type="file"]'
      });
      if (node && node.nodeId) {
        fileNodeId = node.nodeId;
        break;
      }
    } catch {}

    const evalRes = await cdp.send('Runtime.evaluate', {
      expression: 'document.querySelector("input[type=\'file\'][accept*=\'video\'], input[type=\'file\']")'
    });
    if (evalRes.result && evalRes.result.objectId) {
      try {
        const nodeDesc = await cdp.send('DOM.requestNode', { objectId: evalRes.result.objectId });
        if (nodeDesc && nodeDesc.nodeId) {
          fileNodeId = nodeDesc.nodeId;
          break;
        }
      } catch {}
    }

    await sleep(1000);
  }

  if (!fileNodeId) throw new Error('Không tìm thấy ô chọn file video trên TikTok Studio');

  await cdp.send('DOM.setFileInputFiles', {
    nodeId: fileNodeId,
    files: [winVideo]
  });
  console.log('    [✓] Đã nạp file video thành công, đang tải lên...');

  // 3. Chờ video xử lý hoàn tất
  let isVideoReady = false;
  for (let i = 0; i < 45; i++) {
    await sleep(1500);
    await dismissAllModals(cdp);
    const bodyText = await cdp.evaluate('document.body.innerText.slice(0, 600)');
    if (bodyText.includes('Uploaded') || bodyText.includes('Replace') || bodyText.includes('Đã tải lên')) {
      console.log(`    [✓] Video tải lên thành công sau ${((i + 1) * 1.5).toFixed(1)}s!`);
      isVideoReady = true;
      break;
    }
  }

  if (!isVideoReady) throw new Error('Hết thời gian chờ video tải lên hoàn tất');

  // 4. Nhập Caption & Hashtags
  console.log('[-] [3/6] Nhập nội dung caption...');
  await cdp.evaluate(`(() => {
    const editor = document.querySelector('.public-DraftEditor-content, [contenteditable="true"]');
    if (editor) {
      editor.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      document.execCommand('insertText', false, ${JSON.stringify(caption)});

      const details = Array.from(document.querySelectorAll("div, span, h1, h2, h3, h4"))
        .find(e => e.innerText?.trim() === "Details" || e.innerText?.trim() === "Chi tiết");
      if (details) details.click();
    }
  })()`);
  await sleep(1500);

  // 5. Gắn custom thumbnail nếu có
  if (winThumb && fs.existsSync(thumbnailPath)) {
    console.log('[-] [4/6] Gắn thumbnail tùy chỉnh...');
    const clicked = await cdp.evaluate(`(() => {
      const el = document.querySelector('.edit-container, [class*="cover-container"], [class*="edit-container"]');
      if (el) { el.click(); return true; }
      return false;
    })()`);

    if (clicked) {
      await sleep(2000);
      let imgNodeId = 0;
      for (let i = 0; i < 15; i++) {
        const evalRes = await cdp.send('Runtime.evaluate', {
          expression: 'document.querySelector("input[type=\'file\'][accept*=\'image\']")'
        });
        if (evalRes.result && evalRes.result.objectId) {
          const nodeDesc = await cdp.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) { imgNodeId = nodeDesc.nodeId; break; }
        }
        await sleep(1000);
      }
      if (imgNodeId) {
        await cdp.send('DOM.setFileInputFiles', { nodeId: imgNodeId, files: [winThumb] });
        await sleep(3500);
        await cdp.evaluate(`(() => {
          const btns = Array.from(document.querySelectorAll('button')).filter(b => b.innerText && (b.innerText.trim() === 'Save' || b.innerText.trim() === 'Lưu'));
          if (btns.length > 0) btns[btns.length - 1].click();
        })()`);
        await sleep(2000);
      }
    }
  }

  // 6. Xử lý Lên lịch (Schedule) hoặc Đăng ngay (Post Now)
  if (scheduleTime) {
    console.log('[-] [5/6] Cấu hình lịch phát sóng (Schedule)...');

    // Parse scheduleTime
    let schedObj = null;
    if (typeof scheduleTime === 'string') {
      const m = scheduleTime.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s+(\d{1,2}):(\d{2})/);
      if (m) {
        schedObj = {
          day: parseInt(m[1], 10),
          month: parseInt(m[2], 10),
          year: parseInt(m[3], 10),
          hour: m[4].padStart(2, '0'),
          minute: m[5].padStart(2, '0')
        };
      }
    } else if (typeof scheduleTime === 'object') {
      schedObj = scheduleTime;
    }

    // Chọn radio Schedule
    await cdp.evaluate(`(() => {
      const radio = document.querySelector("input[name=postSchedule][value=schedule]");
      const label = radio?.closest("label") || radio?.parentElement;
      if (label) label.click();
    })()`);
    await sleep(1000);
    await dismissAllModals(cdp);
    await sleep(1000);

    await cdp.evaluate(`(() => {
      const radio = document.querySelector("input[name=postSchedule][value=schedule]");
      if (radio && !radio.checked) {
        const label = radio.closest("label") || radio.parentElement;
        if (label) label.click();
      }
    })()`);

    if (schedObj) {
      // Mở Calendar
      await cdp.evaluate(`(() => {
        const scheduledPicker = document.querySelector(".scheduled-picker");
        const fields = Array.from(scheduledPicker ? scheduledPicker.querySelectorAll(".TUXFormField") : []);
        const f1 = fields[1];
        let curr = f1?.parentElement;
        if (curr) {
          const k = Object.keys(curr).find(k => k.startsWith("__reactProps"));
          if (curr[k]?.onClick) curr[k].onClick({ stopPropagation: () => {} });
        }
      })()`);
      await sleep(600);

      // Tháng đích
      const targetMonthName = schedObj.month === 10 ? "October" : "September";
      await cdp.evaluate(`(() => {
        const header = document.querySelector(".month-header-wrapper");
        if (!header) return;
        const isTarget = header.innerText.includes("${targetMonthName}") || header.innerText.includes("Tháng ${schedObj.month}");
        if (!isTarget) {
          const arrows = Array.from(header.querySelectorAll("span.arrow"));
          const next = arrows[1];
          if (next) {
            const k = Object.keys(next).find(k => k.startsWith("__reactProps"));
            if (k && next[k].onClick) next[k].onClick({ stopPropagation: () => {} });
            else next.click();
          }
        }
      })()`);
      await sleep(600);

      // Chọn ngày
      await cdp.evaluate(`(() => {
        const days = Array.from(document.querySelectorAll("span.day.valid"));
        const targetDay = days.find(d => d.innerText.trim() === "${schedObj.day}");
        if (targetDay) {
          const k = Object.keys(targetDay).find(k => k.startsWith("__reactProps"));
          if (k && targetDay[k].onClick) targetDay[k].onClick({ stopPropagation: () => {} });
          else targetDay.click();
        }
      })()`);
      await sleep(1000);

      // Mở Time Picker
      await cdp.evaluate(`(() => {
        const timeInput = Array.from(document.querySelectorAll("input.TUXTextInputCore-input"))
          .find(i => /^[0-9]{2}:[0-9]{2}$/.test(i.value));
        let curr = timeInput;
        while (curr && !curr.className.includes("jsx-2483585186")) curr = curr.parentElement;
        if (curr) {
          const k = Object.keys(curr).find(k => k.startsWith("__reactProps"));
          if (curr[k]?.onClick) curr[k].onClick({ stopPropagation: () => {} });
        }
      })()`);
      await sleep(600);

      // Chọn giờ và phút
      await cdp.evaluate(`(() => {
        const hours = Array.from(document.querySelectorAll(".tiktok-timepicker-left"));
        const mins = Array.from(document.querySelectorAll(".tiktok-timepicker-right"));
        const targetHour = hours.find(h => h.innerText.trim() === "${schedObj.hour}");
        const targetMin = mins.find(m => m.innerText.trim() === "${schedObj.minute}");
        for (const el of [targetHour, targetMin]) {
          if (el) {
            el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
            el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          }
        }
        const settings = Array.from(document.querySelectorAll("div, span, h1, h2, h3"))
          .find(e => e.innerText?.trim() === "Settings" || e.innerText?.trim() === "Cài đặt");
        if (settings) settings.click();
      })()`);
      await sleep(1000);
    }
  }

  // 7. Gửi lệnh Post hoặc Schedule
  const isSchedule = !!scheduleTime;
  console.log(`[-] [6/6] Gửi lệnh ${isSchedule ? 'Lên lịch (Schedule)' : 'Đăng ngay (Post)'}...`);

  const btnCoord = await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const targetText = ${JSON.stringify(isSchedule ? 'Schedule' : 'Post')};
    const btn = btns.find(b => b.innerText && (b.innerText.trim() === targetText || (targetText === 'Schedule' && b.innerText.trim() === 'Lên lịch') || (targetText === 'Post' && b.innerText.trim() === 'Đăng')));
    if (!btn || btn.disabled) return null;
    btn.scrollIntoView({ block: "center", behavior: "instant" });
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);

  if (btnCoord) {
    await cdp.clickMouse(btnCoord.x, btnCoord.y);
  } else {
    await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const targetText = ${JSON.stringify(isSchedule ? 'Schedule' : 'Post')};
      const btn = btns.find(b => b.innerText && (b.innerText.trim() === targetText || (targetText === 'Schedule' && b.innerText.trim() === 'Lên lịch') || (targetText === 'Post' && b.innerText.trim() === 'Đăng')));
      if (btn) btn.click();
    })()`);
  }

  await sleep(1500);

  // Xử lý modal "Continue to post? Post now" hoặc cảnh báo bản quyền
  await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll(".TUXModal button, [role=dialog] button, button"));
    const postNow = btns.find(b => {
      const t = b.innerText?.trim();
      return t === "Post now" || t === "Vẫn đăng" || t === "Continue" || t === "Tiếp tục";
    });
    if (postNow) postNow.click();
  })()`);

  // 8. Chờ xác nhận
  let confirmed = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const pageText = await cdp.evaluate("document.body.innerText.slice(0, 600)");
    const url = await cdp.evaluate("window.location.href");
    if (url.includes("/content") || pageText.includes("Posts") || pageText.includes("Manage your posts")) {
      console.log(`    [✓] XÁC NHẬN: Video đã được ${isSchedule ? 'lên lịch' : 'đăng'} thành công lên TikTok Studio!`);
      confirmed = true;
      break;
    }
  }

  if (!confirmed) {
    console.log(`    [i] Lệnh ${isSchedule ? 'Schedule' : 'Post'} đã được gửi.`);
  }

  cdp.close();
  return { success: true, video: winVideo };
}

module.exports = {
  uploadSingleShortToTikTok,
  dismissAllModals
};
