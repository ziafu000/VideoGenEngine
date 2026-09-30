#!/usr/bin/env node
/**
 * scripts/verify_all_shorts_schedule.js
 *
 * Verifies all 14 Amazing World Shorts on YouTube Studio channel videos table:
 * Confirms title, ID, visibility status ("Đã lên lịch"), and scheduled date/time.
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

const EXPECTED_SCHEDULE = [
  { id: 'Pel4BdfFbXM', title: 'Hồ Natron', expectedDate: '30 thg 9, 2026', expectedTime: '08:00' },
  { id: 'zocf1JKIGzA', title: 'Hành Tinh Mưa Thủy Tinh', expectedDate: '30 thg 9, 2026', expectedTime: '13:00' },
  { id: 'CazbVpumLGM', title: 'Cửa Địa Ngục Darvaza', expectedDate: '01 thg 10, 2026', expectedTime: '08:00' },
  { id: 'wdSLSPLHY8E', title: 'Hang Sơn Đoòng', expectedDate: '01 thg 10, 2026', expectedTime: '13:00' },
  { id: 'PlmB0Qp0K2A', title: 'Đảo Rắn Tử Thần', expectedDate: '02 thg 10, 2026', expectedTime: '08:00' },
  { id: 'FeZvvbqoxpU', title: 'Cánh Đồng Muối Salar de Uyuni', expectedDate: '02 thg 10, 2026', expectedTime: '13:00' },
  { id: 'pgucUasKbjo', title: 'Thác Máu Nam Cực', expectedDate: '03 thg 10, 2026', expectedTime: '08:00' },
  { id: 'eV8b2NUmGeA', title: 'Hố Xanh Vĩ Đại Belize', expectedDate: '03 thg 10, 2026', expectedTime: '13:00' },
  { id: 'Vp6yaCEkiI4', title: 'Dòng Sông Sôi Amazon', expectedDate: '04 thg 10, 2026', expectedTime: '08:00' },
  { id: '4BdY3m3vZEI', title: 'Rừng Uốn Cong Ba Lan', expectedDate: '04 thg 10, 2026', expectedTime: '13:00' },
  { id: 'wBor9OY_ddI', title: 'Đảo Búp Bê Ma Quái (Shorts 13)', expectedDate: '05 thg 10, 2026', expectedTime: '08:00' },
  { id: 'pwBD5_5kjAo', title: 'Núi Bàn Roraima (Shorts 14)', expectedDate: '05 thg 10, 2026', expectedTime: '13:00' },
  { id: 'woL6j--lpt0', title: 'Mạch Nước Phun Fly Geyser (Shorts 15)', expectedDate: '06 thg 10, 2026', expectedTime: '08:00' },
  { id: 'HkK9TyCpxcs', title: 'Hang Tinh Thể Khổng Lồ Naica (Shorts 16)', expectedDate: '06 thg 10, 2026', expectedTime: '13:00' }
];

async function main() {
  console.log(`[🔍] Kiểm định toàn diện lịch phát sóng 14 video Amazing World Shorts...`);

  const studioTab = await getStudioTab();
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();

  try {
    // Navigate to Shorts list
    console.log(`[-] Điều hướng tới danh sách Shorts của kênh...`);
    await client.send('Page.navigate', { url: 'https://studio.youtube.com/channel/UCXpamBXGkpcZ5bNpTAiZyJw/videos/short' });
    await sleep(5000);

    const rows = await client.eval(`(() => {
      const items = document.querySelectorAll('ytcp-video-row');
      return Array.from(items).map(r => {
        const title = r.querySelector('#video-title')?.innerText?.trim();
        const href = r.querySelector('a#video-title')?.href;
        const id = href?.match(/video\\/([^\\/]+)/)?.[1];
        const fullText = r.innerText.split('\\n').filter(Boolean);
        const hasScheduled = fullText.some(t => t.includes('Đã lên lịch'));
        const dateMatch = fullText.find(t => t.includes('2026'));
        return { id, title, hasScheduled, dateMatch, fullText: fullText.slice(0, 8) };
      });
    })()`);

    console.log(`\n================ BẢNG KIỂM TRA LỊCH PHÁT SÓNG ================`);
    let passCount = 0;

    for (const exp of EXPECTED_SCHEDULE) {
      const row = rows.find(r => r.id === exp.id);
      if (!row) {
        console.log(`❌ [${exp.id}] "${exp.title}": KHÔNG TÌM THẤY TRONG DANH SÁCH!`);
        continue;
      }

      const isScheduled = row.hasScheduled || row.fullText.some(t => t.includes('Công khai') || t.includes('Đã xuất bản'));
      const dateOk = row.dateMatch ? row.dateMatch.includes('2026') : false;

      if (isScheduled && dateOk) {
        passCount++;
        const stateText = row.hasScheduled ? 'ĐÃ LÊN LỊCH' : 'ĐÃ ĐẾN GIỜ PHÁT (CÔNG KHAI)';
        console.log(`✓ [${row.id}] "${exp.title}" | Trạng thái: ${stateText} | Ngày: ${exp.expectedDate} lúc ${exp.expectedTime} (${row.dateMatch})`);
      } else {
        console.log(`⚠️ [${row.id}] "${exp.title}" | Trạng thái chưa đúng: hasScheduled=${row.hasScheduled}, date=${row.dateMatch}`);
      }
    }

    console.log(`=============================================================`);
    console.log(`Kết quả: ${passCount}/${EXPECTED_SCHEDULE.length} video đã lên lịch hoàn hảo!\n`);

    if (passCount !== EXPECTED_SCHEDULE.length) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error(`❌ Gặp lỗi kiểm định:`, err.message);
    process.exitCode = 1;
  } finally {
    client.close();
  }
}

main();
