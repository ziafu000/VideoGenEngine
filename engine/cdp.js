const EventEmitter = require('events');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('./config');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient extends EventEmitter {
  constructor(wsUrl) {
    super();
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.msgId = 1;
    this.pending = new Map();

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = async () => {
        try {
          await this.enableDialogHandling().catch(() => {});
        } catch {}
        resolve();
      };
      this.ws.onerror = (err) => {
        for (const [id, p] of this.pending.entries()) {
          p.reject(new Error(`WebSocket error: ${err.message || err}`));
        }
        this.pending.clear();
        reject(err);
      };
      this.ws.onclose = () => {
        for (const [id, p] of this.pending.entries()) {
          p.reject(new Error('WebSocket closed'));
        }
        this.pending.clear();
      };
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
        } else if (data.method) {
          this.emit(data.method, data.params);
          if (data.method === 'Page.javascriptDialogOpening') {
            console.log(`[CDP] Auto-accepting JavaScript dialog: "${data.params?.message || ''}"`);
            this.send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('[CDP Parse Error]', err);
      }
    };
  }

  send(method, params = {}, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      let timer = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error(`CDP method '${method}' timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (val) => {
          if (timer) clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        }
      });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  async evaluate(expr, returnByValue = true) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue,
      awaitPromise: true
    });
    if (res && res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Runtime.evaluate exception');
    }
    return res && res.result ? res.result.value : null;
  }

  async eval(expr, returnByValue = true) {
    return this.evaluate(expr, returnByValue);
  }

  async enableDialogHandling() {
    try {
      await this.send('Page.enable');
      await this.evaluate('window.onbeforeunload = null;');
    } catch {}
  }

  async captureScreenshot(filePath = null) {
    try {
      await this.send('Page.enable').catch(() => {});
      const res = await this.send('Page.captureScreenshot', { format: 'png' });
      if (res && res.data) {
        const buf = Buffer.from(res.data, 'base64');
        if (filePath) {
          const dir = path.dirname(filePath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(filePath, buf);
          console.log(`[CDP Screenshot] Đã chụp ảnh màn hình lưu tại: ${filePath}`);
        }
        return buf;
      }
    } catch (e) {
      console.warn('[CDP Screenshot Error]', e.message);
    }
    return null;
  }

  async captureDiagnosticScreenshot(filename = null, dir = null) {
    return await captureDiagnosticScreenshot(filename, dir, this);
  }

  async dismissModals() {
    try {
      return await this.evaluate(`(() => {
        const clicked = [];
        const leaveKeywords = ['Leave', 'Rời khỏi', 'Discard', 'Hủy', 'Xác nhận', 'Thoát', 'Got it', 'Đã hiểu', 'Allow', 'Cho phép', 'Close', 'Đóng', 'Not now', 'Để sau'];
        const btns = Array.from(document.querySelectorAll('button, div[role="button"], [aria-label]'));
        for (const b of btns) {
          const text = (b.innerText || b.getAttribute('aria-label') || '').trim();
          if (leaveKeywords.some(kw => text === kw || text.startsWith(kw))) {
            const isModal = b.closest('[role="dialog"], [role="alertdialog"], .modal, .TUXModal, ytcp-dialog, tp-yt-paper-dialog');
            if (isModal) {
              b.click();
              clicked.push(text);
            }
          }
        }
        return clicked;
      })()`);
    } catch {
      return [];
    }
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
    for (const [id, p] of this.pending.entries()) {
      p.reject(new Error('CDPClient closed manually'));
    }
    this.pending.clear();
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
  const page = pages.find(p => p.type === 'page' && p.url && (
    typeof urlPattern === 'string'
      ? (p.url.startsWith('http') && p.url.includes(urlPattern) && !p.url.includes('RotateCookiesPage') && !p.url.includes('accounts.google.com') && !p.url.includes('stripe') && !p.url.includes('inner.html'))
      : urlPattern.test(p.url)
  ));
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

/**
 * Capture visual diagnostic evidence of unexpected modals, errors, or page state.
 * 1. Attempts direct screenshot using active CDPClient instance if available.
 * 2. Falls back to `chrome-devtools-axi screenshot <path>` CLI if CDPClient is offline/busy.
 * Supports CHROME_DEVTOOLS_AXI_SESSION environment variable for isolated sessions.
 *
 * @param {string} [filename] - Custom output filename (default: diagnostic_<timestamp>.png)
 * @param {string} [dir] - Output directory (default: renders/diagnostics)
 * @param {CDPClient} [clientInstance] - Optional active CDPClient
 * @returns {Promise<string|null>} - Absolute path of saved screenshot, or null on failure
 */
async function captureDiagnosticScreenshot(filename = null, dir = null, clientInstance = null) {
  const targetDir = dir || path.join(config.RENDERS_DIR, 'diagnostics');
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const name = filename || `diagnostic_${Date.now()}.png`;
  const targetFile = path.resolve(targetDir, name);

  // 1. Direct CDP client capture
  if (clientInstance && typeof clientInstance.send === 'function') {
    try {
      await clientInstance.send('Page.enable').catch(() => {});
      const res = await clientInstance.send('Page.captureScreenshot', { format: 'png' });
      if (res && res.data) {
        fs.writeFileSync(targetFile, Buffer.from(res.data, 'base64'));
        console.log(`[CDP Diagnostic] Đã lưu ảnh chẩn đoán: ${targetFile}`);
        return targetFile;
      }
    } catch (e) {
      console.warn(`[CDP Diagnostic] Direct CDP captureScreenshot thất bại: ${e.message}. Đang thử chrome-devtools-axi...`);
    }
  }

  // 2. Fallback to chrome-devtools-axi screenshot
  try {
    const session = process.env.CHROME_DEVTOOLS_AXI_SESSION || config.CHROME_DEVTOOLS_AXI_SESSION || null;
    const env = { ...process.env };
    if (session) {
      env.CHROME_DEVTOOLS_AXI_SESSION = session;
    }
    spawnSync('chrome-devtools-axi', ['screenshot', targetFile], {
      encoding: 'utf8',
      env,
      timeout: 12000
    });
    if (fs.existsSync(targetFile) && fs.statSync(targetFile).size > 100) {
      console.log(`[CDP Diagnostic] Đã lưu ảnh chẩn đoán qua chrome-devtools-axi${session ? ` [Session: ${session}]` : ''}: ${targetFile}`);
      return targetFile;
    }
  } catch (err) {
    console.warn(`[CDP Diagnostic] chrome-devtools-axi screenshot thất bại: ${err.message}`);
  }

  return null;
}

module.exports = {
  CDPClient,
  listPages,
  getClientForPage,
  captureDiagnosticScreenshot,
  sleep
};
