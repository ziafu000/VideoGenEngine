#!/usr/bin/env node
/**
 * scripts/upload_and_schedule_clean_shorts.js
 *
 * Uploads clean no-sub masters for Shorts 13, 14, 15, 16 to YouTube Studio
 * and schedules them to their exact slots:
 * - Shorts 13: 05 thg 10, 2026 lúc 08:00
 * - Shorts 14: 05 thg 10, 2026 lúc 13:00
 * - Shorts 15: 06 thg 10, 2026 lúc 08:00
 * - Shorts 16: 06 thg 10, 2026 lúc 13:00
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('../engine/config');

const PROXY_BASE = config.CDP_URL;

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

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.msgId = 0;
    this.pending = new Map();
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (err) => reject(err);
      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || JSON.stringify(msg.error)));
            } else {
              resolve(msg.result);
            }
          }
        } catch {}
      };
    });
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.msgId;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Runtime.evaluate exception');
    }
    return res.result ? res.result.value : undefined;
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function getStudioTab() {
  const tabs = await fetchJson(`${PROXY_BASE}/json/list`);
  const studioTab = tabs.find(t => t.type === 'page' && t.url && t.url.includes('studio.youtube.com'));
  if (!studioTab) {
    throw new Error('Không tìm thấy tab YouTube Studio nào trong Chrome.');
  }
  return studioTab;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function uploadAndSchedule(client, item) {
  const { videoFile, title, description, date, time, shotLabel } = item;
  const winVideoPath = config.toWinPath(videoFile);

  console.log(`\n============================================================`);
  console.log(`>>> UPLOAD & LÊN LỊCH: ${shotLabel}`);
  console.log(`    File: ${winVideoPath}`);
  console.log(`    Tiêu đề: ${title}`);
  console.log(`    Lên lịch: ${date} lúc ${time}`);
  console.log(`============================================================`);

  // 1. Điều hướng tới studio clean
  console.log(`[-] Chuẩn bị giao diện Studio...`);
  await client.send('Page.navigate', { url: 'https://studio.youtube.com/channel/UCXpamBXGkpcZ5bNpTAiZyJw/videos/short' });
  await sleep(4000);

  // 2. Mở hộp thoại tạo / upload
  console.log(`[-] Mở hộp thoại Tải video lên...`);
  const opened = await client.eval(`(() => {
    const createBtn = document.querySelector('button[aria-label*="Tạo"], button[aria-label*="Create"], #create-icon');
    if (createBtn) {
      createBtn.click();
      return 'CREATE_CLICKED';
    }
    const direct = document.querySelector('button[aria-label*="Tải video lên"], button[aria-label*="Upload videos"]');
    if (direct) {
      direct.click();
      return 'DIRECT_CLICKED';
    }
    return 'NO_BTN';
  })()`);

  await sleep(1500);
  if (opened === 'CREATE_CLICKED') {
    await client.eval(`(() => {
      const items = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-text-menu #items tp-yt-paper-item'));
      const upItem = items.find(i => i.innerText && (i.innerText.includes('Tải video lên') || i.innerText.includes('Upload videos')));
      if (upItem) upItem.click();
    })()`);
    await sleep(2000);
  }

  // 3. Nạp file video qua DOM.setFileInputFiles
  console.log(`[-] Nạp file video qua CDP...`);
  await client.send('DOM.enable');
  let nodeId = 0;
  for (let attempt = 0; attempt < 15; attempt++) {
    const doc = await client.send('DOM.getDocument', { depth: -1 });
    const fileNode = await client.send('DOM.querySelector', {
      nodeId: doc.root.nodeId,
      selector: 'input[type="file"][name="Filedata"], ytcp-uploads-dialog input[type="file"], input[type="file"]'
    });
    if (fileNode && fileNode.nodeId) {
      nodeId = fileNode.nodeId;
      break;
    }
    await sleep(1000);
  }

  if (!nodeId) throw new Error('Không tìm thấy ô input file trên dialog');

  await client.send('DOM.setFileInputFiles', {
    files: [winVideoPath],
    nodeId
  });
  console.log(`    [✓] Đã nạp file video thành công! Chờ metadata editor...`);

  // 4. Chờ metadata editor
  let editorReady = false;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    editorReady = await client.eval(`(() => {
      const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea');
      return !!titleBox;
    })()`);
    if (editorReady) break;
  }
  if (!editorReady) throw new Error('Metadata editor không xuất hiện');

  // 5. Điền Title, Description và Not Made For Kids
  console.log(`[-] Điền tiêu đề và mô tả...`);
  await client.eval(`((tText, dText) => {
    const titleBox = document.querySelector('#textbox[aria-label*="Tiêu đề"], #textbox[aria-label*="Title"], ytcp-social-suggestions-textbox#title-textarea [contenteditable="true"]');
    if (titleBox) {
      titleBox.focus();
      titleBox.innerText = tText;
      titleBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const descBox = document.querySelector('#textbox[aria-label*="Mô tả"], #textbox[aria-label*="Description"], ytcp-social-suggestions-textbox#description-textarea [contenteditable="true"]');
    if (descBox && dText) {
      descBox.focus();
      descBox.innerText = dText;
      descBox.dispatchEvent(new Event('input', { bubbles: true }));
    }

    const notForKids = document.querySelector('tp-yt-paper-radio-button[name="VIDEO_MADE_FOR_KIDS_NOT_MFK"], #not-made-for-kids');
    if (notForKids) notForKids.click();
  })(${JSON.stringify(title)}, ${JSON.stringify(description)})`);

  await sleep(1500);

  // 6. Chuyển qua các bước sang bước Visibility (Chế độ hiển thị)
  console.log(`[-] Chuyển tiếp các bước kiểm tra...`);
  for (let step = 1; step <= 3; step++) {
    await client.eval(`(() => {
      const nextBtn = document.querySelector('#next-button, button#next-button, ytcp-button#next-button');
      if (nextBtn) nextBtn.click();
    })()`);
    await sleep(2000);
  }

  // 7. Lấy URL / ID video
  const videoUrl = await client.eval(`(() => {
    const linkEl = document.querySelector('a.ytcp-video-info[href*="youtu.be"], a.style-scope.ytcp-video-info, .video-url-fadeable a, a[href*="youtu.be"]');
    return linkEl ? linkEl.href : null;
  })()`);
  const newVideoId = videoUrl ? videoUrl.split('/').pop().trim() : null;
  console.log(`    [✓] Video URL: ${videoUrl || 'Đang cập nhật'} (ID: ${newVideoId || 'N/A'})`);

  // 8. Chọn "Lên lịch" và nhập ngày/giờ
  console.log(`[-] Mở rộng mục "Lên lịch" trong hộp thoại tải lên...`);
  await client.eval(`(() => {
    const c2 = document.querySelector('#second-container');
    const expandBtn = c2 ? c2.querySelector('#second-container-expand-button, .early-access-header') : null;
    if (expandBtn) expandBtn.click();
  })()`);
  await sleep(1500);

  console.log(`[-] Mở hộp thoại chọn ngày...`);
  await client.eval(`(() => {
    const trigger = document.querySelector('#datepicker-trigger');
    if (trigger) trigger.click();
  })()`);
  await sleep(1500);

  console.log(`[-] Đặt ngày: "${date}"...`);
  await client.eval(`(() => {
    const dp = document.querySelector('ytcp-date-picker');
    if (!dp) return;
    const form = dp.querySelector('form');
    const input = dp.querySelector('input');
    const paperInput = dp.querySelector('#textbox');
    if (input) {
      input.value = '${date}';
      if (paperInput) paperInput.value = '${date}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  })()`);
  await sleep(1500);

  console.log(`[-] Đặt giờ: "${time}"...`);
  await client.eval(`(() => {
    const dtp = document.querySelector('ytcp-datetime-picker');
    if (!dtp) return;
    const form = dtp.querySelector('form');
    const paperInput = dtp.querySelector('#textbox');
    const input = dtp.querySelector('input');
    if (input) {
      input.value = '${time}';
      if (paperInput) paperInput.value = '${time}';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      if (form) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  })()`);
  await sleep(1500);

  // 9. Nhấn nút "Lên lịch" (done-button)
  console.log(`[-] Nhấn nút "Lên lịch" hoàn tất...`);
  await client.eval(`(() => {
    const doneBtn = document.querySelector('#done-button, ytcp-button#done-button, button#done-button');
    if (doneBtn) doneBtn.click();
  })()`);

  await sleep(5000);

  // 10. Đóng dialog kết quả
  await client.eval(`(() => {
    const closeBtn = document.querySelector('#close-button, ytcp-button#close-button, button[aria-label*="Đóng"]');
    if (closeBtn) closeBtn.click();
  })()`);
  await sleep(3000);

  console.log(`[✓] Đã tải lên và lên lịch thành công cho ${shotLabel}!`);
  return { newVideoId, videoUrl };
}

async function main() {
  const studioTab = await getStudioTab();
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();

  const items = [
    {
      shotLabel: 'Shorts 13 (Đảo Búp Bê Ma Quái)',
      videoFile: path.join(config.OUTPUT_DIR, 'shorts_13_isla_de_las_munecas_master_1080p.mp4'),
      title: 'Đảo Búp Bê Ma Quái Mexico: Hàng Nghìn Con Búp Bê Tự Cử Động Giữa Đầm Lầy?! 💀🧸 #Shorts',
      description: 'Nằm sâu trong hệ thống kênh đào Xochimilco tại Mexico, Isla de las Muñecas là hòn đảo rùng rợn bậc nhất hành tinh với hàng nghìn con búp bê kỳ quái bị treo khắp các thân cây. Truyền thuyết kể rằng những linh hồn ẩn bên trong chúng vẫn thì thầm và mở mắt khi màn đêm buông xuống! Khám phá bí ẩn kinh ngạc này cùng ZFStudio!\n\nĐăng ký kênh ZFStudio để cùng khám phá những địa danh bí ẩn nhất Trái Đất mỗi ngày!\n\n#ZFStudio #AmazingWorld #IsladelasMunecas #DaoBupBe #Mexico #Xochimilco #BiAn #KhamPha #RungRon #Shorts',
      date: '05 thg 10, 2026',
      time: '08:00'
    },
    {
      shotLabel: 'Shorts 14 (Núi Bàn Roraima)',
      videoFile: path.join(config.OUTPUT_DIR, 'shorts_14_mount_roraima_master_1080p.mp4'),
      title: 'Núi Bàn Roraima: Vùng Đất Thất Lạc Cổ Đại 2 Tỷ Năm Giữa Biển Mây! ⛰️☁️ #Shorts',
      description: 'Sừng sững giữa ngã ba biên giới Venezuela, Brazil và Guyana, Núi Bàn Roraima là cao nguyên sa thạch cổ đại hơn hai tỷ năm tuổi. Nơi đây cô lập hoàn toàn với thế giới bên ngoài, sở hữu hệ sinh thái độc nhất vô nhị không thể tìm thấy ở bất kỳ nơi nào khác trên Trái Đất! Cùng ZFStudio chinh phục kỳ quan này!\n\nĐăng ký kênh ZFStudio để cùng khám phá những địa danh bí ẩn nhất Trái Đất mỗi ngày!\n\n#ZFStudio #AmazingWorld #MountRoraima #Roraima #Venezuela #TheLostWorld #BiAn #KhamPha #KyQuan #Shorts',
      date: '05 thg 10, 2026',
      time: '13:00'
    },
    {
      shotLabel: 'Shorts 15 (Mạch Nước Phun Fly Geyser)',
      videoFile: path.join(config.OUTPUT_DIR, 'shorts_15_fly_geyser_master_1080p.mp4'),
      title: 'Mạch Nước Phun Fly Geyser Tắc Kè Hoa: Kỳ Quan Cầu Vồng Ngoài Hành Tinh! 🌈🌋 #Shorts',
      description: 'Nằm giữa sa mạc Black Rock bang Nevada, Fly Geyser là mạch nước phun địa nhiệt kỳ lạ bậc nhất thế giới. Được tạo ra từ một vụ khoan giếng nhân tạo tình cờ năm 1964, mạch nước liên tục phun trào và khoác lên mình lớp áo rêu tảo đa sắc tuyệt mỹ như trên hành tinh khác! Khám phá ngay cùng ZFStudio!\n\nĐăng ký kênh ZFStudio để cùng khám phá những địa danh bí ẩn nhất Trái Đất mỗi ngày!\n\n#ZFStudio #AmazingWorld #FlyGeyser #Nevada #BlackRockDesert #Geyser #DiaNhiet #KhamPha #BiAn #Shorts',
      date: '06 thg 10, 2026',
      time: '08:00'
    },
    {
      shotLabel: 'Shorts 16 (Hang Tinh Thể Khổng Lồ Naica)',
      videoFile: path.join(config.OUTPUT_DIR, 'shorts_16_naica_crystal_cave_master_1080p.mp4'),
      title: 'Hang Tinh Thể Naica: Pháo Đài Pha Lê Khổng Lồ 50 Tấn Nóng 58°C Dưới Lòng Đất! 💎🔥 #Shorts',
      description: 'Ẩn sâu ba trăm mét dưới lòng sa mạc Chihuahua tại Mexico, Hang Tinh Thể Naica chứa đựng những cột selenite khổng lồ dài tới 12 mét và nặng hơn 50 tấn! Nhưng đừng để vẻ đẹp mê hoặc đánh lừa: với nhiệt độ lên tới 58°C và độ ẩm 99%, nơi đây là một chiếc lò hấp chết chóc có thể cướp đi sinh mạng người chỉ sau 10 phút! Cùng ZFStudio khám phá kỳ quan ngầm kỳ bí này!\n\nĐăng ký kênh ZFStudio để cùng khám phá những địa danh bí ẩn nhất Trái Đất mỗi ngày!\n\n#ZFStudio #AmazingWorld #Naica #CrystalCave #NaicaMine #Mexico #Chihuahua #KyQuan #DiaChat #Shorts',
      date: '06 thg 10, 2026',
      time: '13:00'
    }
  ];

  const results = [];
  for (const item of items) {
    try {
      const res = await uploadAndSchedule(client, item);
      results.push({ ...item, ...res });
    } catch (e) {
      console.error(`❌ Lỗi khi xử lý ${item.shotLabel}:`, e.message);
    }
  }

  console.log(`\n================ KẾT QUẢ TẢI LÊN & LÊN LỊCH ================`);
  console.log(JSON.stringify(results, null, 2));

  client.close();
}

main().catch(console.error);
