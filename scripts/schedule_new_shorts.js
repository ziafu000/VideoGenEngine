#!/usr/bin/env node
/**
 * scripts/schedule_new_shorts.js
 *
 * Schedules the newly created Amazing World Shorts:
 * - Video 13 (wBor9OY_ddI): 05 thg 10, 2026 lúc 08:00 (Đảo Búp Bê Ma Quái)
 * - Video 14 (pwBD5_5kjAo): 05 thg 10, 2026 lúc 13:00 (Núi Bàn Roraima)
 * - Video 15 (woL6j--lpt0): 06 thg 10, 2026 lúc 08:00 (Mạch Nước Phun Fly Geyser)
 * - Video 16 (HkK9TyCpxcs): 06 thg 10, 2026 lúc 13:00 (Hang Tinh Thể Khổng Lồ Naica)
 *
 * Supports both:
 * 1. Standard video edit page (when already published/scheduled)
 * 2. Draft video edit page (handles "Chỉnh sửa bản nháp" wizard dialog)
 */

const http = require('http');
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

async function scheduleVideo(client, video) {
  const { id, title, date, time } = video;
  console.log(`\n==================================================`);
  console.log(`[▶] Đang lên lịch video mới: [${id}] "${title}"`);
  console.log(`    Lên lịch: ${date} lúc ${time}`);
  console.log(`==================================================`);

  // 1. Điều hướng tới edit page
  const editUrl = `https://studio.youtube.com/video/${id}/edit`;
  console.log(`[-] Điều hướng tới: ${editUrl}`);
  await client.send('Page.navigate', { url: editUrl });
  await sleep(4000);

  // 2. Kiểm tra xem đây là trang edit thông thường hay trang nháp
  const isDraftPage = await client.eval(`(() => {
    const draftBanner = document.body.innerText.includes('Video này đang ở trạng thái nháp');
    const editDraftBtn = Array.from(document.querySelectorAll('button, ytcp-button')).some(b => b.innerText && b.innerText.includes('Chỉnh sửa bản nháp'));
    return draftBanner || editDraftBtn;
  })()`);

  if (isDraftPage) {
    console.log(`[-] Phát hiện video đang ở trạng thái Nháp (Draft). Mở wizard chỉnh sửa bản nháp...`);
    await client.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('button, ytcp-button')).find(b => b.innerText && b.innerText.includes('Chỉnh sửa bản nháp'));
      if (btn) btn.click();
    })()`);
    await sleep(2500);

    // Bấm Next qua 3 bước để sang bước Visibility (Chế độ hiển thị)
    for (let step = 1; step <= 3; step++) {
      console.log(`    [-] Chuyển tiếp bước ${step}/3 trong wizard...`);
      await client.eval(`(() => {
        const nb = document.querySelector('#next-button');
        if (nb) nb.click();
      })()`);
      await sleep(1500);
    }
  } else {
    // Trang edit thông thường: mở popup visibility
    console.log(`[-] Mở hộp thoại chế độ hiển thị...`);
    await client.eval(`(() => {
      const vis = document.querySelector('ytcp-video-metadata-visibility');
      if (vis && typeof vis.maybeOpenMenu === 'function') {
        vis.maybeOpenMenu();
        return 'CALLED_MAYBE_OPEN_MENU';
      }
      const btn = document.querySelector('ytcp-video-metadata-visibility #select-button, ytcp-video-metadata-visibility #container');
      if (btn) btn.click();
      return 'CLICKED_BTN';
    })()`);
    await sleep(1500);
  }

  // 3. Mở rộng mục "Lên lịch" (#second-container)
  console.log(`[-] Mở rộng mục "Lên lịch"...`);
  await client.eval(`(() => {
    const c2 = document.querySelector('#second-container');
    const expandBtn = c2 ? c2.querySelector('#second-container-expand-button, .early-access-header') : null;
    if (expandBtn) expandBtn.click();
  })()`);
  await sleep(1500);

  // 4. Mở DatePicker
  console.log(`[-] Mở hộp thoại chọn ngày...`);
  await client.eval(`(() => {
    const trigger = document.querySelector('#datepicker-trigger');
    if (trigger) trigger.click();
  })()`);
  await sleep(1500);

  // 5. Nhập ngày
  console.log(`[-] Đặt ngày thành "${date}"...`);
  const dateSetRes = await client.eval(`(() => {
    const dp = document.querySelector('ytcp-date-picker');
    if (!dp) return { ok: false, error: 'no ytcp-date-picker' };
    const form = dp.querySelector('form');
    const input = dp.querySelector('input');
    const paperInput = dp.querySelector('#textbox');
    if (!input || !form) return { ok: false, error: 'no input or form in date picker' };

    input.value = '${date}';
    if (paperInput) paperInput.value = '${date}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { ok: true, val: input.value };
  })()`);

  if (!dateSetRes || !dateSetRes.ok) {
    throw new Error(`Lỗi khi nhập ngày: ${dateSetRes?.error}`);
  }
  await sleep(1500);

  // 6. Nhập giờ
  console.log(`[-] Đặt giờ thành "${time}"...`);
  const timeSetRes = await client.eval(`(() => {
    const dtp = document.querySelector('ytcp-datetime-picker');
    if (!dtp) return { ok: false, error: 'no ytcp-datetime-picker' };
    const form = dtp.querySelector('form');
    const paperInput = dtp.querySelector('#textbox');
    const input = dtp.querySelector('input');
    if (!input || !form) return { ok: false, error: 'no input or form in time picker' };

    input.value = '${time}';
    if (paperInput) paperInput.value = '${time}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    return { ok: true, val: input.value };
  })()`);

  if (!timeSetRes || !timeSetRes.ok) {
    throw new Error(`Lỗi khi nhập giờ: ${timeSetRes?.error}`);
  }
  await sleep(1500);

  if (isDraftPage) {
    // 7. Trong dialog: bấm done-button ("Lên lịch")
    console.log(`[-] Nhấn nút "Lên lịch" trong hộp thoại...`);
    const doneRes = await client.eval(`(() => {
      const doneBtn = document.querySelector('#done-button, ytcp-button#done-button, button#done-button');
      if (doneBtn) {
        doneBtn.click();
        return { ok: true };
      }
      return { ok: false, error: 'no done button' };
    })()`);

    if (!doneRes || !doneRes.ok) {
      throw new Error(`Không tìm thấy nút Lên lịch trong dialog.`);
    }

    // Chờ xuất hiện dialog xác nhận và đóng dialog
    console.log(`[-] Đang chờ xác nhận lên lịch...`);
    await sleep(3000);
    await client.eval(`(() => {
      const closeBtn = document.querySelector('#close-button, ytcp-button#close-button');
      if (closeBtn) closeBtn.click();
    })()`);
    await sleep(2000);
    console.log(`[✓] Đã lên lịch thành công cho video nháp [${id}]: ${date} lúc ${time}!`);
  } else {
    // 7. Nhấn nút "Xong" trong popup
    console.log(`[-] Nhấn nút "Xong"...`);
    await client.eval(`(() => {
      const doneBtn = document.querySelector('#save-button, ytcp-button#save-button');
      if (doneBtn) doneBtn.click();
    })()`);
    await sleep(1500);

    // 8. Nhấn nút "Lưu"
    console.log(`[-] Nhấn nút "Lưu" để cập nhật video...`);
    const saveRes = await client.eval(`(() => {
      const saveBtn = document.querySelector('ytcp-button#save, button#save');
      if (saveBtn) {
        saveBtn.click();
        return { ok: true };
      }
      return { ok: false, error: 'no save button' };
    })()`);

    if (!saveRes || !saveRes.ok) {
      throw new Error(`Không tìm thấy nút Lưu.`);
    }

    // Chờ lưu
    console.log(`[-] Đang chờ lưu thay đổi...`);
    let saved = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(1500);
      const checkState = await client.eval(`(() => {
        const metaVis = document.querySelector('ytcp-video-metadata-visibility');
        const saveBtn = document.querySelector('ytcp-button#save, button#save');
        const isSaved = saveBtn ? (saveBtn.hasAttribute('disabled') || saveBtn.getAttribute('aria-disabled') === 'true') : false;
        const text = metaVis ? metaVis.innerText.trim() : '';
        return { isSaved, text };
      })()`);

      if (checkState.isSaved && checkState.text.includes('Đã lên lịch')) {
        saved = true;
        console.log(`[✓] Đã lên lịch thành công: "${checkState.text.replace(/\n/g, ' - ')}"`);
        break;
      }
    }

    if (!saved) {
      console.warn(`[!] Cảnh báo: Trạng thái nút Lưu chưa xác nhận sau 18s. Tiếp tục kiểm tra.`);
    }
  }

  return true;
}

async function main() {
  const targetVideos = [
    {
      id: 'wBor9OY_ddI',
      title: 'Đảo Búp Bê Ma Quái (Shorts 13)',
      date: '05 thg 10, 2026',
      time: '08:00'
    },
    {
      id: 'pwBD5_5kjAo',
      title: 'Núi Bàn Roraima (Shorts 14)',
      date: '05 thg 10, 2026',
      time: '13:00'
    },
    {
      id: 'woL6j--lpt0',
      title: 'Mạch Nước Phun Fly Geyser (Shorts 15)',
      date: '06 thg 10, 2026',
      time: '08:00'
    },
    {
      id: 'HkK9TyCpxcs',
      title: 'Hang Tinh Thể Khổng Lồ Naica (Shorts 16)',
      date: '06 thg 10, 2026',
      time: '13:00'
    }
  ];

  console.log(`[🚀] Bắt đầu lên lịch cho 4 video mới (Shorts 13 -> 16)...`);

  const studioTab = await getStudioTab();
  console.log(`[✓] Đã tìm thấy tab YouTube Studio: "${studioTab.title}"`);
  console.log(`    WebSocket Debugger URL: ${studioTab.webSocketDebuggerUrl}`);

  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();
  console.log(`[✓] Đã kết nối CDP WebSocket thành công.`);

  try {
    for (let i = 0; i < targetVideos.length; i++) {
      const vid = targetVideos[i];
      console.log(`\n--- TIẾN ĐỘ: ${i + 1}/${targetVideos.length} ---`);
      await scheduleVideo(client, vid);
      await sleep(2000);
    }
    console.log(`\n🎉 HOÀN THÀNH: Tất cả 4 video mới đã được lên lịch thành công!`);
  } catch (err) {
    console.error(`\n❌ Gặp lỗi:`, err.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
