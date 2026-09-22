const http = require('http');
const config = require('./config');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.msgId = 1;
    this.pending = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = resolve;
      this.ws.onerror = reject;
    });

    this.ws.onmessage = (evt) => {
      try {
        const data = JSON.parse(evt.data);
        if (data.id && this.pending.has(data.id)) {
          const { resolve, reject } = this.pending.get(data.id);
          this.pending.delete(data.id);
          if (data.error) {
            reject(new Error(`CDP Error (${data.error.code}): ${data.error.message}`));
          } else {
            resolve(data.result);
          }
        }
      } catch (err) {
        console.error('[CDP Parse Error]', err);
      }
    };
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expr, returnByValue = true) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue,
      awaitPromise: true
    });
    return res && res.result ? res.result.value : null;
  }

  async clickMouse(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await sleep(60);
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1
    });
    await sleep(60);
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

async function listPages() {
  const jsonUrl = `${config.CDP_URL}/json/list`;
  const res = await fetch(jsonUrl);
  if (!res.ok) {
    throw new Error(`Failed to list CDP pages: ${res.statusText}`);
  }
  return await res.json();
}

async function getClientForPage(urlPattern) {
  const pages = await listPages();
  const page = pages.find(p => p.type === 'page' && p.url && (typeof urlPattern === 'string' ? p.url.includes(urlPattern) : urlPattern.test(p.url)));
  if (!page) {
    throw new Error(`No open page found matching pattern: ${urlPattern}`);
  }
  if (!page.webSocketDebuggerUrl) {
    throw new Error(`Page found but missing webSocketDebuggerUrl: ${page.url}`);
  }
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.ready;
  return client;
}

module.exports = {
  CDPClient,
  listPages,
  getClientForPage,
  sleep
};
