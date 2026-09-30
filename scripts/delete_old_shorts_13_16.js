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

async function deleteVideo(client, videoId) {
  console.log(`[-] Đang xóa video cũ: ${videoId}...`);
  await client.send('Page.navigate', { url: `https://studio.youtube.com/video/${videoId}/edit` });
  await sleep(4000);

  // 1. Mở menu overflow
  const opened = await client.eval(`(() => {
    const btn = document.querySelector('#overflow-menu-button');
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  })()`);
  if (!opened) throw new Error('Không tìm thấy nút overflow-menu-button');
  await sleep(1500);

  // 2. Click mục "Xóa"
  const clickedXoa = await client.eval(`(() => {
    const items = Array.from(document.querySelectorAll('tp-yt-paper-item, ytcp-menu-service-item, [role="menuitem"]'));
    const xoaItem = items.find(i => i.innerText?.trim() === 'Xóa');
    if (xoaItem) {
      xoaItem.click();
      return true;
    }
    return false;
  })()`);
  if (!clickedXoa) throw new Error('Không tìm thấy mục Xóa trong menu');
  await sleep(2000);

  // 3. Tích checkbox xác nhận và click "Xóa vĩnh viễn"
  const confirmed = await client.eval(`(() => {
    const dlg = document.querySelector('#delete-dialog');
    if (!dlg) return { ok: false, error: 'no delete dialog' };
    const checkbox = dlg.querySelector('tp-yt-paper-checkbox, [role="checkbox"]');
    if (!checkbox) return { ok: false, error: 'no checkbox' };
    checkbox.click();
    
    const confirmBtn = dlg.querySelector('#confirm-button');
    if (!confirmBtn) return { ok: false, error: 'no confirm button' };
    
    // Đợi 500ms rồi click confirmBtn
    setTimeout(() => {
      confirmBtn.click();
    }, 500);

    return { ok: true };
  })()`);

  if (!confirmed.ok) throw new Error(`Lỗi xác nhận xóa: ${confirmed.error}`);
  console.log(`    [✓] Đã kích hoạt lệnh xóa video ${videoId}! Chờ hoàn tất...`);
  await sleep(5000);
}

async function main() {
  const studioTab = await getStudioTab();
  const client = new CDPClient(studioTab.webSocketDebuggerUrl);
  await client.connect();

  const oldVideos = ['wBor9OY_ddI', 'pwBD5_5kjAo', 'woL6j--lpt0', 'HkK9TyCpxcs'];
  for (const vid of oldVideos) {
    try {
      await deleteVideo(client, vid);
    } catch (e) {
      console.warn(`[!] Lỗi khi xóa video ${vid}: ${e.message}`);
    }
  }

  client.close();
}

main().catch(console.error);
