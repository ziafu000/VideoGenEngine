#!/usr/bin/env node
/**
 * scripts/reschedule_existing_shorts.js
 *
 * Reschedules the 10 existing Amazing World Shorts to the new daily slots:
 * 08:00 (morning) and 13:00 (afternoon).
 *
 * 30 thg 9: 08:00 (Hồ Natron Pel4BdfFbXM) & 13:00 (Hành Tinh Mưa Thủy Tinh zocf1JKIGzA)
 * 01 thg 10: 08:00 (Cửa Địa Ngục Darvaza CazbVpumLGM) & 13:00 (Hang Sơn Đoòng wdSLSPLHY8E)
 * 02 thg 10: 08:00 (Đảo Rắn Tử Thần PlmB0Qp0K2A) & 13:00 (Cánh Đồng Muối Salar de Uyuni FeZvvbqoxpU)
 * 03 thg 10: 08:00 (Thác Máu Nam Cực pgucUasKbjo) & 13:00 (Hố Xanh Vĩ Đại Belize eV8b2NUmGeA)
 * 04 thg 10: 08:00 (Dòng Sông Sôi Amazon Vp6yaCEkiI4) & 13:00 (Rừng Uốn Cong Ba Lan 4BdY3m3vZEI)
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

async function rescheduleVideo(client, video) {
  const { id, title, date, time } = video;
  console.log(`\n==================================================`);
  console.log(`[▶] Đang xử lý video: [${id}] "${title}"`);
  console.log(`    Lên lịch mới: ${date} lúc ${time}`);
  console.log(`==================================================`);

  // 1. Điều hướng tới edit page
  const editUrl = `https://studio.youtube.com/video/${id}/edit`;
  console.log(`[-] Điều hướng tới: ${editUrl}`);
  await client.send('Page.navigate', { url: editUrl });
  
  // Chờ trang tải đầy đủ (metadata-visibility xuất hiện)
  let loaded = false;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const hasVis = await client.eval(`!!document.querySelector('ytcp-video-metadata-visibility')`);
    if (hasVis) {
      loaded = true;
      break;
    }
  }
  if (!loaded) {
    throw new Error(`Trang edit ${id} không tải được ytcp-video-metadata-visibility sau 15s`);
  }
  await sleep(1000);

  // 2. Mở popup visibility
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

  // 7. Nhấn nút "Xong" (save-button trong popup)
  console.log(`[-] Nhấn nút "Xong"...`);
  await client.eval(`(() => {
    const doneBtn = document.querySelector('#save-button, ytcp-button#save-button');
    if (doneBtn) doneBtn.click();
  })()`);
  await sleep(1500);

  // 8. Nhấn nút "Lưu" để cập nhật video
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
  return true;
}

async function main() {
  const targetVideos = [
    {
      id: 'Pel4BdfFbXM',
      title: 'Hồ Natron',
      date: '30 thg 9, 2026',
      time: '08:00'
    },
    {
      id: 'zocf1JKIGzA',
      title: 'Hành Tinh Mưa Thủy Tinh',
      date: '30 thg 9, 2026',
      time: '13:00'
    },
    {
      id: 'CazbVpumLGM',
      title: 'Cửa Địa Ngục Darvaza',
      date: '01 thg 10, 2026',
      time: '08:00'
    },
    {
      id: 'wdSLSPLHY8E',
      title: 'Hang Sơn Đoòng',
      date: '01 thg 10, 2026',
      time: '13:00'
    },
    {
      id: 'PlmB0Qp0K2A',
      title: 'Đảo Rắn Tử Thần',
      date: '02 thg 10, 2026',
      time: '08:00'
    },
    {
      id: 'FeZvvbqoxpU',
      title: 'Cánh Đồng Muối Salar de Uyuni',
      date: '02 thg 10, 2026',
      time: '13:00'
    },
    {
      id: 'pgucUasKbjo',
      title: 'Thác Máu Nam Cực',
      date: '03 thg 10, 2026',
      time: '08:00'
    },
    {
      id: 'eV8b2NUmGeA',
      title: 'Hố Xanh Vĩ Đại Belize',
      date: '03 thg 10, 2026',
      time: '13:00'
    },
    {
      id: 'Vp6yaCEkiI4',
      title: 'Dòng Sông Sôi Amazon',
      date: '04 thg 10, 2026',
      time: '08:00'
    },
    {
      id: '4BdY3m3vZEI',
      title: 'Rừng Uốn Cong Ba Lan',
      date: '04 thg 10, 2026',
      time: '13:00'
    }
  ];

  console.log(`[🚀] Bắt đầu điều chỉnh lịch phát cho 10 video cũ sang khung giờ 08:00 và 13:00...`);

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
      await rescheduleVideo(client, vid);
      await sleep(2000);
    }
    console.log(`\n🎉 HOÀN THÀNH: Tất cả 10 video đã được điều chỉnh lịch thành công!`);
  } catch (err) {
    console.error(`\n❌ Gặp lỗi:`, err.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
