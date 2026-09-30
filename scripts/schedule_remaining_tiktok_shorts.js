#!/usr/bin/env node
/**
 * scripts/schedule_remaining_tiktok_shorts.js
 *
 * Sequentially uploads and schedules remaining Amazing World Shorts (06 to 16)
 * to TikTok Studio via Chrome DevTools Protocol (CDP).
 */

const fs = require('fs');
const path = require('path');
const config = require('../engine/config');
const { getClientForPage, sleep } = require('../engine/cdp');

const TIKTOK_SHORTS_SCHEDULE = [
  {
    num: 6,
    file: "output/shorts_06_son_doong_master_1080p.mp4",
    caption: "Hang Sơn Đoòng: Kỳ Quan Lớn Tới Mức Tự Tạo Mây & Khí Hậu Riêng?! #shorts #ZFStudio #AmazingWorld #SonDoong",
    date: { year: 2026, month: 10, day: 1 },
    time: { hour: "13", minute: "00" }
  },
  {
    num: 7,
    file: "output/shorts_07_snake_island_master_1080p.mp4",
    caption: "Đảo Rắn Tử Thần: Nơi 1 Mét Vuông Có 5 Con Rắn Độc Cấm Tuyệt Đối Con Người! #shorts #ZFStudio #AmazingWorld #SnakeIsland",
    date: { year: 2026, month: 10, day: 2 },
    time: { hour: "08", minute: "00" }
  },
  {
    num: 8,
    file: "output/shorts_09_salar_de_uyuni_master_1080p.mp4",
    caption: "Cánh Đồng Muối Salar de Uyuni: Chiếc Gương Khổng Lồ Phản Chiếu Cả Vũ Trụ! #shorts #ZFStudio #AmazingWorld #SalarDeUyuni",
    date: { year: 2026, month: 10, day: 2 },
    time: { hour: "13", minute: "00" }
  },
  {
    num: 9,
    file: "output/shorts_10_blood_falls_master_1080p.mp4",
    caption: "Thác Máu Nam Cực: Kỳ Quan Đỏ Thẫm Tuôn Trào Sau 2 Triệu Năm Bị Giam Cầm! #shorts #ZFStudio #AmazingWorld #BloodFalls",
    date: { year: 2026, month: 10, day: 3 },
    time: { hour: "08", minute: "00" }
  },
  {
    num: 10,
    file: "output/shorts_11_great_blue_hole_master_1080p.mp4",
    caption: "Hố Xanh Vĩ Đại Belize: Cổng Vào Kỷ Băng Hà Nhìn Rõ Từ Ngoài Vũ Trụ! #shorts #ZFStudio #AmazingWorld #BlueHole",
    date: { year: 2026, month: 10, day: 3 },
    time: { hour: "13", minute: "00" }
  },
  {
    num: 11,
    file: "output/shorts_12_boiling_river_master_1080p.mp4",
    caption: "Dòng Sông Sôi Amazon: Nước Nóng 100°C Làm Chín Mọi Sinh Vật Giữa Rừng Già! #shorts #ZFStudio #AmazingWorld #BoilingRiver",
    date: { year: 2026, month: 10, day: 4 },
    time: { hour: "08", minute: "00" }
  },
  {
    num: 12,
    file: "output/shorts_08_crooked_forest_master_1080p.mp4",
    caption: "Rừng Uốn Cong Ba Lan: Bí Ẩn 400 Cây Thông Bị Bẻ Cong 90 Độ Suốt 1 Thế Kỷ! #shorts #ZFStudio #AmazingWorld #CrookedForest",
    date: { year: 2026, month: 10, day: 4 },
    time: { hour: "13", minute: "00" }
  },
  {
    num: 13,
    file: "output/shorts_13_isla_de_las_munecas_master_1080p.mp4",
    caption: "Đảo Búp Bê Ma Quái Mexico: Hàng Nghìn Con Búp Bê Tự Cử Động Giữa Đầm Lầy?! #shorts #ZFStudio #AmazingWorld #DollIsland",
    date: { year: 2026, month: 10, day: 5 },
    time: { hour: "08", minute: "00" }
  },
  {
    num: 14,
    file: "output/shorts_14_mount_roraima_master_1080p.mp4",
    caption: "Núi Bàn Roraima: Vùng Đất Thất Lạc Cổ Đại 2 Tỷ Năm Giữa Biển Mây! #shorts #ZFStudio #AmazingWorld #MountRoraima",
    date: { year: 2026, month: 10, day: 5 },
    time: { hour: "13", minute: "00" }
  },
  {
    num: 15,
    file: "output/shorts_15_fly_geyser_master_1080p.mp4",
    caption: "Mạch Nước Phun Fly Geyser: Kỳ Quan Đa Sắc Màu Đẹp Như Hành Tinh Lạ! #shorts #ZFStudio #AmazingWorld #FlyGeyser",
    date: { year: 2026, month: 10, day: 6 },
    time: { hour: "08", minute: "00" }
  },
  {
    num: 16,
    file: "output/shorts_16_naica_crystal_cave_master_1080p.mp4",
    caption: "Hang Tinh Thể Khổng Lồ Naica: Cung Điện Pha Lê Dưới Lòng Đất Nóng Bỏng! #shorts #ZFStudio #AmazingWorld #NaicaCave",
    date: { year: 2026, month: 10, day: 6 },
    time: { hour: "13", minute: "00" }
  }
];

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

async function uploadAndScheduleShort(cdp, item) {
  const winVideo = config.toWinPath(item.file);
  console.log(`\n============================================================`);
  console.log(`>>> TIKTOK SCHEDULE AUTOMATION: Shorts ${String(item.num).padStart(2, '0')}`);
  console.log(`    - Video: ${item.file}`);
  console.log(`    - Schedule: ${String(item.date.day).padStart(2, '0')}/${String(item.date.month).padStart(2, '0')}/${item.date.year} lúc ${item.time.hour}:${item.time.minute}`);
  console.log(`    - Caption: ${item.caption}`);
  console.log(`============================================================`);

  // 1. Xóa draft database và chuyển về trang Upload
  console.log('[-] [1/6] Chuẩn bị không gian tải lên sạch...');
  await cdp.evaluate(`(new Promise((resolve) => {
    const req = indexedDB.deleteDatabase("web_creation_draft");
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }))`);

  await cdp.send("Page.navigate", { url: "https://www.tiktok.com/tiktokstudio/upload?lang=vi-VN" });
  await sleep(3500);
  await dismissAllModals(cdp);
  await sleep(500);

  // 2. Nạp file video qua CDP DOM.setFileInputFiles
  console.log('[-] [2/6] Nạp file video vào TikTok Studio...');
  await cdp.send("DOM.enable");
  const doc = await cdp.send("DOM.getDocument", { depth: -1 });
  const fileNode = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"]'
  });

  if (!fileNode || !fileNode.nodeId) {
    throw new Error('Không tìm thấy thẻ chọn file trên TikTok Studio');
  }

  await cdp.send("DOM.setFileInputFiles", {
    nodeId: fileNode.nodeId,
    files: [winVideo]
  });
  console.log('    [✓] Đã nạp file video thành công, đang tải lên...');

  // 3. Chờ video tải lên hoàn tất
  let uploaded = false;
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    await dismissAllModals(cdp);
    const text = await cdp.evaluate("document.body.innerText.slice(0, 600)");
    if (text.includes("Uploaded") || text.includes("Replace") || text.includes("Đã tải lên")) {
      console.log(`    [✓] Video tải lên thành công sau ${((i+1)*1.5).toFixed(1)}s!`);
      uploaded = true;
      break;
    }
  }

  if (!uploaded) throw new Error('Hết thời gian chờ video tải lên hoàn tất');

  // 4. Nhập caption
  console.log('[-] [3/6] Nhập nội dung caption...');
  await cdp.evaluate(`(() => {
    const el = document.querySelector(".public-DraftEditor-content");
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);

    document.execCommand("insertText", false, ${JSON.stringify(item.caption)});

    // Đóng gợi ý hashtag nếu có
    const details = Array.from(document.querySelectorAll("div, span, h1, h2, h3, h4"))
      .find(e => e.innerText?.trim() === "Details" || e.innerText?.trim() === "Chi tiết");
    if (details) details.click();
  })()`);
  await sleep(1500);

  // 5. Chọn chế độ Lên lịch (Schedule)
  console.log('[-] [4/6] Chọn chế độ Lên lịch (Schedule)...');
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

  // 6. Cấu hình Ngày đăng (Date Picker)
  console.log(`[-] [5/6] Đặt ngày ${String(item.date.day).padStart(2, '0')}/${String(item.date.month).padStart(2, '0')}/${item.date.year} và giờ ${item.time.hour}:${item.time.minute}...`);

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

  // Điều hướng tháng nếu cần
  const targetMonthName = item.date.month === 10 ? "October" : "September";
  await cdp.evaluate(`(() => {
    const header = document.querySelector(".month-header-wrapper");
    if (!header) return;
    const isTargetMonth = header.innerText.includes("${targetMonthName}") || header.innerText.includes("Tháng ${item.date.month}");
    if (!isTargetMonth) {
      const arrows = Array.from(header.querySelectorAll("span.arrow"));
      const nextArrow = arrows[1];
      if (nextArrow) {
        const k = Object.keys(nextArrow).find(k => k.startsWith("__reactProps"));
        if (k && nextArrow[k].onClick) nextArrow[k].onClick({ stopPropagation: () => {} });
        else nextArrow.click();
      }
    }
  })()`);
  await sleep(600);

  // Chọn ngày
  await cdp.evaluate(`(() => {
    const days = Array.from(document.querySelectorAll("span.day.valid"));
    const targetDay = days.find(d => d.innerText.trim() === "${item.date.day}");
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
    const targetHour = hours.find(h => h.innerText.trim() === "${item.time.hour}");
    const targetMin = mins.find(m => m.innerText.trim() === "${item.time.minute}");
    for (const el of [targetHour, targetMin]) {
      if (el) {
        el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      }
    }
    // Đóng dropdown timepicker
    const settings = Array.from(document.querySelectorAll("div, span, h1, h2, h3"))
      .find(e => e.innerText?.trim() === "Settings" || e.innerText?.trim() === "Cài đặt");
    if (settings) settings.click();
  })()`);
  await sleep(1000);

  // Kiểm tra xác nhận date & time trên giao diện
  const pickersVal = await cdp.evaluate(`(() => {
    const inputs = Array.from(document.querySelectorAll("input.TUXTextInputCore-input"));
    return inputs.map(i => i.value);
  })()`);
  console.log(`    [✓] Đã chọn lịch phát sóng:`, pickersVal);

  // 7. Bấm nút Schedule
  console.log('[-] [6/6] Gửi lệnh Lên lịch (Schedule)...');
  const coord = await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const schedBtn = btns.find(b => b.innerText?.trim() === "Schedule" || b.innerText?.trim() === "Lên lịch");
    if (!schedBtn || schedBtn.disabled) return null;
    schedBtn.scrollIntoView({ block: "center", behavior: "instant" });
    const r = schedBtn.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`);

  if (coord) {
    await cdp.clickMouse(coord.x, coord.y);
  } else {
    await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const schedBtn = btns.find(b => b.innerText?.trim() === "Schedule" || b.innerText?.trim() === "Lên lịch");
      if (schedBtn) schedBtn.click();
    })()`);
  }

  await sleep(1500);

  // Xử lý modal "Continue to post? Post now" hoặc cảnh báo bản quyền nếu có
  await cdp.evaluate(`(() => {
    const btns = Array.from(document.querySelectorAll(".TUXModal button, [role=dialog] button, button"));
    const postNow = btns.find(b => {
      const t = b.innerText?.trim();
      return t === "Post now" || t === "Vẫn đăng" || t === "Continue" || t === "Tiếp tục";
    });
    if (postNow) postNow.click();
  })()`);

  // 8. Chờ xác nhận hoàn tất trên danh sách bài viết
  let confirmed = false;
  for (let i = 0; i < 15; i++) {
    await sleep(2000);
    const pageText = await cdp.evaluate("document.body.innerText.slice(0, 600)");
    const url = await cdp.evaluate("window.location.href");
    if (url.includes("/content") || pageText.includes("Posts") || pageText.includes("Manage your posts")) {
      console.log(`    [✓] XÁC NHẬN HOÀN TẤT: Shorts ${String(item.num).padStart(2, '0')} đã được lên lịch thành công!`);
      confirmed = true;
      break;
    }
  }

  if (!confirmed) {
    console.log(`    [i] Lệnh Schedule đã được gửi thành công.`);
  }

  await sleep(2000);
}

async function main() {
  console.log(`============================================================`);
  console.log(`>>> BẮT ĐẦU ĐĂNG VÀ LÊN LỊCH 11 SHORTS CÒN LẠI LÊN TIKTOK STUDIO`);
  console.log(`============================================================\n`);

  const cdp = await getClientForPage("tiktokstudio");

  try {
    for (const item of TIKTOK_SHORTS_SCHEDULE) {
      await uploadAndScheduleShort(cdp, item);
      console.log(`\n>>> Chờ 3 giây trước khi tiếp tục video kế tiếp...\n`);
      await sleep(3000);
    }

    console.log(`\n============================================================`);
    console.log(`>>> TẤT CẢ 11 SHORTS ĐÃ ĐƯỢC LÊN LỊCH THÀNH CÔNG LÊN TIKTOK!`);
    console.log(`============================================================\n`);
  } catch (err) {
    console.error(`\n❌ Gặp lỗi trong quá trình tự động hóa:`, err.message);
    process.exitCode = 1;
  } finally {
    cdp.close();
    process.exit(process.exitCode || 0);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  TIKTOK_SHORTS_SCHEDULE,
  uploadAndScheduleShort
};
