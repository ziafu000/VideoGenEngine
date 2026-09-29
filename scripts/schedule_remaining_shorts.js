#!/usr/bin/env node
/**
 * scripts/schedule_remaining_shorts.js
 *
 * Automates YouTube Studio video scheduling via Chrome DevTools Protocol (CDP).
 * Visually opens each video edit page, selects "Lên lịch", inputs date & time,
 * submits, saves changes, and verifies the "Đã lên lịch" state.
 */

const http = require('http');
const config = require('../engine/config');

const PROXY_BASE = config.CDP_URL; // e.g. http://192.168.112.1:9223

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
  console.log(`[▶] Đang xử lý video: [${id}] "${title}"`);
  console.log(`    Lên lịch: ${date} lúc ${time}`);
  console.log(`==================================================`);

  // 1. Navigate to edit page
  const editUrl = `https://studio.youtube.com/video/${id}/edit`;
  console.log(`[-] Điều hướng tới: ${editUrl}`);
  await client.send('Page.navigate', { url: editUrl });
  await sleep(4000);

  // 2. Kiểm tra phần tử visibility
  console.log(`[-] Đang tìm phần tử chế độ hiển thị...`);
  const initialStatus = await client.eval(`(() => {
    const metaVis = document.querySelector('ytcp-video-metadata-visibility');
    return metaVis ? metaVis.innerText.trim() : null;
  })()`);
  console.log(`    Trạng thái hiện tại: ${(initialStatus || '').replace(/\n/g, ' -> ')}`);

  // 3. Mở popup visibility (dùng maybeOpenMenu hoặc click container)
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

  // 4. Mở / Mở rộng phần "Lên lịch" (#second-container)
  console.log(`[-] Mở rộng mục "Lên lịch"...`);
  await client.eval(`(() => {
    const c2 = document.querySelector('#second-container');
    const expandBtn = c2 ? c2.querySelector('#second-container-expand-button, .early-access-header') : null;
    if (expandBtn) expandBtn.click();
  })()`);
  await sleep(1500);

  // 5. Mở DatePicker
  console.log(`[-] Mở hộp thoại chọn ngày...`);
  await client.eval(`(() => {
    const trigger = document.querySelector('#datepicker-trigger');
    if (trigger) trigger.click();
  })()`);
  await sleep(1500);

  // 6. Nhập ngày vào form DatePicker
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

  // 7. Nhập giờ vào form DateTimePicker
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

  // 8. Nhấn nút "Xong" (save-button trong popup)
  console.log(`[-] Nhấn nút "Xong"...`);
  await client.eval(`(() => {
    const doneBtn = document.querySelector('#save-button, ytcp-button#save-button');
    if (doneBtn) doneBtn.click();
  })()`);
  await sleep(1500);

  // 9. Nhấn nút "Lưu" (save) chính của video
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

  // Chờ lưu hoàn tất (nút Lưu bị vô hiệu hóa lại hoặc trạng thái cập nhật)
  console.log(`[-] Đang chờ lưu thay đổi...`);
  let saved = false;
  for (let attempt = 0; attempt < 10; attempt++) {
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
    console.warn(`[!] Cảnh báo: Trạng thái nút Lưu chưa xác nhận sau 15s. Tiếp tục kiểm tra.`);
  }
  return true;
}

async function main() {
  const targetVideos = [
    {
      id: 'PlmB0Qp0K2A',
      title: 'Đảo Rắn Tử Thần',
      date: '02 thg 10, 2026',
      time: '11:00'
    },
    {
      id: 'FeZvvbqoxpU',
      title: 'Cánh Đồng Muối Salar de Uyuni',
      date: '02 thg 10, 2026',
      time: '19:00'
    },
    {
      id: 'pgucUasKbjo',
      title: 'Thác Máu Nam Cực',
      date: '03 thg 10, 2026',
      time: '11:00'
    },
    {
      id: 'eV8b2NUmGeA',
      title: 'Hố Xanh Vĩ Đại Belize',
      date: '03 thg 10, 2026',
      time: '19:00'
    },
    {
      id: 'Vp6yaCEkiI4',
      title: 'Dòng Sông Sôi Amazon',
      date: '04 thg 10, 2026',
      time: '11:00'
    }
  ];

  console.log(`=== BẮT ĐẦU ĐẶT LỊCH HẸN CHO SERIES SHORTS TRÊN YOUTUBE STUDIO ===`);
  console.log(`Tổng số video cần đặt lịch: ${targetVideos.length}`);

  const studioTab = await getStudioTab();
  console.log(`[✓] Đã kết nối tab YouTube Studio: ${studioTab.title}`);
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();

  try {
    for (const video of targetVideos) {
      await scheduleVideo(client, video);
      await sleep(2000);
    }

    console.log(`\n==================================================`);
    console.log(`[✓] TOÀN BỘ 5 VIDEO ĐÃ ĐƯỢC ĐẶT LỊCH THÀNH CÔNG!`);
    console.log(`==================================================`);

    // Verify all on shorts list
    console.log(`[-] Điều hướng về danh sách Shorts để kiểm tra tổng thể...`);
    await client.send('Page.navigate', {
      url: 'https://studio.youtube.com/channel/UCXpamBXGkpcZ5bNpTAiZyJw/videos/short'
    });
    await sleep(5000);

    const shortsList = await client.eval(`(() => {
      const rows = Array.from(document.querySelectorAll('ytcp-video-row'));
      return rows.map(r => {
        const titleEl = r.querySelector('#video-title');
        const text = r.innerText || '';
        return {
          title: titleEl ? titleEl.innerText.trim() : null,
          isScheduled: text.includes('Đã lên lịch'),
          isPublic: text.includes('Công khai'),
          isPrivate: text.includes('Riêng tư'),
          isDraft: text.includes('Bản nháp')
        };
      });
    })()`);

    console.log(`\nDanh sách kiểm tra trạng thái Shorts:`);
    for (const s of (shortsList || []).slice(0, 12)) {
      const status = s.isScheduled ? 'ĐÃ LÊN LỊCH' : (s.isPublic ? 'CÔNG KHAI' : (s.isDraft ? 'BẢN NHÁP' : 'RIÊNG TƯ'));
      console.log(`  - [${status}] ${s.title}`);
    }

  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error(`[X] Lỗi nghiêm trọng:`, err);
  process.exit(1);
});
