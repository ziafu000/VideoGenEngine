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
  storyboardPath,
  scheduleTime
}) {
  let resolvedCaption = caption;
  if (!resolvedCaption && storyboardPath && fs.existsSync(storyboardPath)) {
    try {
      const sb = JSON.parse(fs.readFileSync(storyboardPath, 'utf8'));
      resolvedCaption = sb.tiktok?.caption || (sb.youtube ? `${sb.youtube.title}\n\n#ZFStudio #AmazingWorld #Shorts` : sb.episode_title);
      if (!scheduleTime && sb.tiktok?.schedule) {
        scheduleTime = sb.tiktok.schedule;
      }
    } catch {}
  }
  if (!resolvedCaption) {
    resolvedCaption = path.basename(videoPath, path.extname(videoPath)) + ' #ZFStudio #AmazingWorld #Shorts';
  }
  // Loại bỏ ký tự xuống dòng để tránh làm crash Draft.js editor của TikTok
  resolvedCaption = resolvedCaption.replace(/\r?\n+/g, ' ').trim();

  const winVideo = config.toWinPath(videoPath);
  const winThumb = thumbnailPath ? config.toWinPath(thumbnailPath) : null;

  console.log(`\n============================================================`);
  console.log(`>>> TIKTOK UPLOAD & SCHEDULE (JEV DRIVEN): ${path.basename(videoPath)}`);
  console.log(`    - Video: ${winVideo}`);
  console.log(`    - Mode: ${scheduleTime ? `LÊN LỊCH (${typeof scheduleTime === 'string' ? scheduleTime : JSON.stringify(scheduleTime)})` : 'ĐĂNG NGAY (Now)'}`);
  console.log(`    - Thumbnail: ${winThumb || '(Auto từ video)'}`);
  console.log(`    - Caption: ${resolvedCaption}`);
  console.log(`============================================================`);

  const cdp = await getClientForPage('tiktok');
  try {
    await cdp.enableDialogHandling();
    await cdp.dismissModals();
    await cdp.send('DOM.enable');

    // 1. Chuyển hướng về Upload sạch
    console.log('[-] [1/6] Chuẩn bị không gian tải lên sạch...');
    await cdp.send('Page.navigate', { url: 'https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN' });
    await sleep(4000);

    // Nếu có modal Discard cũ tồn đọng, click Discard để dọn sạch form
    await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll(".TUXModal button, [role=dialog] button, button"));
      const discard = btns.find(b => (b.innerText || "").trim() === "Discard");
      if (discard) discard.click();
    })()`);
    await sleep(1500);
    await dismissAllModals(cdp);

    // Xử lý card draft chưa lưu nếu có ("A video you were editing wasn’t saved. Continue editing?")
    const hasDraftCard = await cdp.evaluate(`(() => {
      const discardBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText?.trim() === 'Discard' || b.innerText?.trim() === 'Hủy');
      if (discardBtn && discardBtn.closest('.local-draft-card, [class*="draft"]')) {
        discardBtn.click();
        return true;
      }
      return false;
    })()`);
    if (hasDraftCard) {
      await sleep(1000);
      await cdp.evaluate(`(() => {
        const btns = Array.from(document.querySelectorAll('.TUXModal button, [role=dialog] button, button'));
        const confirmDiscard = btns.find(b => b.innerText?.trim() === 'Discard' || b.innerText?.trim() === 'Hủy');
        if (confirmDiscard) confirmDiscard.click();
      })()`);
      await sleep(1500);
    }

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

    // 2. Tìm thẻ input file video & nạp file qua CDP
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

      try {
        await cdp.send('DOM.getDocument', { depth: -1 });
        const evalRes = await cdp.send('Runtime.evaluate', {
          expression: 'document.querySelector("input[type=\'file\'][accept*=\'video\'], input[type=\'file\']")'
        });
        if (evalRes.result && evalRes.result.objectId) {
          const nodeDesc = await cdp.send('DOM.requestNode', { objectId: evalRes.result.objectId });
          if (nodeDesc && nodeDesc.nodeId) {
            fileNodeId = nodeDesc.nodeId;
            break;
          }
        }
      } catch {}

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
        document.execCommand('insertText', false, ${JSON.stringify(resolvedCaption)});

        const details = Array.from(document.querySelectorAll("div, span, h1, h2, h3, h4"))
          .find(e => e.innerText?.trim() === "Details" || e.innerText?.trim() === "Chi tiết");
        if (details) details.click();
      }
    })()`);
    await sleep(1500);

    // Xác thực số ký tự trên counter
    for (let i = 0; i < 15; i++) {
      const counterText = await cdp.evaluate('document.body.innerText.match(/(\\d+)\\/4000/)?.[0]');
      if (counterText && parseInt(counterText.split('/')[0], 10) >= resolvedCaption.length) {
        break;
      }
      await sleep(1000);
      await cdp.evaluate(`(() => {
        const details = Array.from(document.querySelectorAll("div, span, h1, h2, h3, h4"))
          .find(e => e.innerText?.trim() === "Details" || e.innerText?.trim() === "Chi tiết");
        if (details) details.click();
      })()`);
    }

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
          await cdp.send('DOM.getDocument', { depth: -1 });
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
        // 1. Mở Calendar bằng cách click vào input ngày
        await cdp.evaluate(`(() => {
          const input = Array.from(document.querySelectorAll("input.TUXTextInputCore-input")).find(i => /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(i.value));
          if (input) input.click();
        })()`);
        await sleep(1000);

        // 2. Chuyển tháng nếu cần
        const targetMonthName = schedObj.month === 10 ? "October" : "September";
        await cdp.evaluate(`(() => {
          const header = document.querySelector(".month-header-wrapper");
          if (!header) return;
          const isTarget = header.innerText.includes("${targetMonthName}") || header.innerText.includes("Tháng ${schedObj.month}");
          if (!isTarget) {
            const arrows = Array.from(header.querySelectorAll("span.arrow, .arrow"));
            const next = arrows[1];
            if (next) next.click();
          }
        })()`);
        await sleep(800);

        // 3. Chọn ngày đích
        await cdp.evaluate(`(() => {
          const days = Array.from(document.querySelectorAll(".calendar-wrapper span, span.day.valid, span.day"));
          const targetDay = days.find(d => (d.innerText || "").trim() === "${parseInt(schedObj.day, 10)}");
          if (targetDay) targetDay.click();
        })()`);
        await sleep(1000);

        // 4. Mở Time Picker bằng cách click vào input giờ
        await cdp.evaluate(`(() => {
          const input = Array.from(document.querySelectorAll("input.TUXTextInputCore-input")).find(i => /^[0-9]{2}:[0-9]{2}$/.test(i.value));
          if (input) input.click();
        })()`);
        await sleep(1000);

        // 5. Click chọn giờ và phút bằng coordinates qua CDP
        const coords = await cdp.evaluate(`(() => {
          const hours = Array.from(document.querySelectorAll(".tiktok-timepicker-left"));
          const mins = Array.from(document.querySelectorAll(".tiktok-timepicker-right"));
          const targetH = hours.find(h => (h.innerText || "").trim() === "${schedObj.hour}");
          const targetM = mins.find(m => (m.innerText || "").trim() === "${schedObj.minute}");
          if (!targetH || !targetM) return null;
          targetH.scrollIntoView({ block: "center", behavior: "instant" });
          const rH = targetH.getBoundingClientRect();
          const rM = targetM.getBoundingClientRect();
          return {
            h: { x: Math.round(rH.left + rH.width / 2), y: Math.round(rH.top + rH.height / 2) },
            m: { x: Math.round(rM.left + rM.width / 2), y: Math.round(rM.top + rM.height / 2) }
          };
        })()`);

        if (coords) {
          await cdp.clickMouse(coords.h.x, coords.h.y);
          await sleep(500);
          await cdp.clickMouse(coords.m.x, coords.m.y);
          await sleep(500);
        }

        // Đóng timepicker bằng cách click ngoài
        await cdp.evaluate(`(() => {
          document.querySelector("h1, h2, h3, .contents-wrapper")?.click();
        })()`);
        await sleep(1000);
      }
    }

    // 7. Gửi lệnh Post hoặc Schedule
    const isSchedule = !!scheduleTime;
    console.log(`[-] [6/6] Gửi lệnh ${isSchedule ? 'Lên lịch (Schedule)' : 'Đăng ngay (Post)'}...`);

    await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const targetText = ${JSON.stringify(isSchedule ? 'Schedule' : 'Post')};
      const btn = btns.find(b => b.innerText && (b.innerText.trim() === targetText || (targetText === 'Schedule' && b.innerText.trim() === 'Lên lịch') || (targetText === 'Post' && b.innerText.trim() === 'Đăng')));
      if (btn && !btn.disabled) {
        btn.scrollIntoView({ block: "center", behavior: "instant" });
        btn.click();
      }
    })()`);

    await sleep(2000);

    // Xử lý modal "Continue to post? Post now" hoặc cảnh báo bản quyền / discard
    await cdp.evaluate(`(() => {
      const modal = document.querySelector(".TUXModal, [role=dialog]");
      if (modal) {
        const btns = Array.from(modal.querySelectorAll("button"));
        const notNow = btns.find(b => (b.innerText || "").trim() === "Not now");
        if (notNow) notNow.click();
        const postNow = btns.find(b => ["Post now", "Vẫn đăng", "Continue", "Tiếp tục"].includes((b.innerText || "").trim()));
        if (postNow) postNow.click();
      }
    })()`);

    // 8. Chờ xác nhận điều hướng về trang quản lý nội dung (/content)
    let confirmed = false;
    for (let i = 0; i < 20; i++) {
      await sleep(2000);
      const url = await cdp.evaluate("window.location.href");
      if (url.includes("/content") && !url.includes("/upload")) {
        console.log(`    [✓] XÁC NHẬN: Video đã được ${isSchedule ? 'lên lịch' : 'đăng'} thành công lên TikTok Studio!`);
        confirmed = true;
        break;
      }
      // Click modal nếu xuất hiện trễ
      await cdp.evaluate(`(() => {
        const modal = document.querySelector(".TUXModal, [role=dialog]");
        if (modal) {
          const btns = Array.from(modal.querySelectorAll("button"));
          const notNow = btns.find(b => (b.innerText || "").trim() === "Not now");
          if (notNow) notNow.click();
          const postNow = btns.find(b => ["Post now", "Vẫn đăng", "Continue", "Tiếp tục"].includes((b.innerText || "").trim()));
          if (postNow) postNow.click();
        }
      })()`);
    }

    if (!confirmed) {
      console.log(`    [i] Lệnh ${isSchedule ? 'Schedule' : 'Post'} đã được gửi.`);
    }

    return { success: true, video: winVideo };
  } catch (err) {
    const errorScreenshot = path.join(config.PROJECT_DIR, 'renders', 'qa_inspect', `tt_error_${Date.now()}.png`);
    await cdp.captureScreenshot(errorScreenshot).catch(() => {});
    console.error(`[!] Lỗi TikTok upload: ${err.message}. Đã chụp màn hình chẩn đoán tại: ${errorScreenshot}`);
    throw err;
  } finally {
    cdp.close();
  }
}

module.exports = {
  uploadSingleShortToTikTok,
  dismissAllModals
};
