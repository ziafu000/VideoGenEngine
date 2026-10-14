const EventEmitter = require('events');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const config = require('./config');

const clientPool = new Map();
const DEFAULT_IDLE_TTL_MS = 1500;
const EVAL_OBJECT_GROUP = 'videogen-eval';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class CDPClient extends EventEmitter {
  constructor(wsUrl, options = {}) {
    super();
    this.wsUrl = wsUrl;
    this.ws = new WebSocket(wsUrl);
    this.msgId = 1;
    this.pending = new Map();
    this._closed = false;
    this._pooled = Boolean(options.pooled);
    this._poolKeys = new Set();
    this._refCount = 0;
    this._idleTimer = null;
    this._idleTtlMs = typeof options.idleTtlMs === 'number' ? options.idleTtlMs : DEFAULT_IDLE_TTL_MS;
    this._dialogEnabled = false;
    this._evalCount = 0;

    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = async () => {
        try {
          await this.enableDialogHandling().catch(() => {});
        } catch {}
        resolve();
      };
      this.ws.onerror = (err) => {
        this._cleanupPoolEntry();
        for (const [, p] of this.pending.entries()) {
          p.reject(new Error(`WebSocket error: ${err.message || err}`));
        }
        this.pending.clear();
        reject(err);
      };
      this.ws.onclose = () => {
        this._cleanupPoolEntry();
        for (const [, p] of this.pending.entries()) {
          p.reject(new Error('WebSocket closed'));
        }
        this.pending.clear();
      };
    });
    this.ready.catch(() => {});

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

  _cleanupPoolEntry() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this._closed = true;
    this._refCount = 0;
    for (const k of this._poolKeys) {
      if (clientPool.get(k) === this) {
        clientPool.delete(k);
      }
    }
    this._poolKeys.clear();
  }

  isOpen() {
    return Boolean(!this._closed && this.ws && this.ws.readyState === 1);
  }

  retain() {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
    this._refCount++;
    return this;
  }

  release(force = false) {
    if (force || !this._pooled || this._closed) {
      this.forceClose();
      return;
    }
    this._refCount = Math.max(0, this._refCount - 1);
    if (this._refCount === 0) {
      if (this._idleTimer) clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => {
        this._idleTimer = null;
        if (this._refCount === 0) {
          this.forceClose();
        }
      }, this._idleTtlMs);
      if (this._idleTimer && typeof this._idleTimer.unref === 'function') {
        this._idleTimer.unref();
      }
    }
  }

  forceClose() {
    this._cleanupPoolEntry();
    try {
      this.ws.close();
    } catch {}
    for (const [, p] of this.pending.entries()) {
      p.reject(new Error('CDPClient closed manually'));
    }
    this.pending.clear();
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
      objectGroup: EVAL_OBJECT_GROUP,
      returnByValue,
      awaitPromise: true
    });
    this._evalCount++;
    if (!returnByValue && res?.result?.objectId) {
      this.send('Runtime.releaseObject', { objectId: res.result.objectId }, 3000).catch(() => {});
    } else if (this._evalCount % 25 === 0) {
      this.releaseMemory().catch(() => {});
    }
    if (res && res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description || 'Runtime.evaluate exception');
    }
    return res && res.result ? res.result.value : null;
  }

  async eval(expr, returnByValue = true) {
    return this.evaluate(expr, returnByValue);
  }

  async releaseMemory() {
    if (!this.isOpen()) return;
    try {
      await this.send('Runtime.releaseObjectGroup', { objectGroup: EVAL_OBJECT_GROUP }, 5000).catch(() => {});
      await this.send('Runtime.discardConsoleEntries', {}, 5000).catch(() => {});
    } catch {}
  }

  async enableDialogHandling() {
    if (this._dialogEnabled) return;
    try {
      await this.send('Page.enable');
      await this.evaluate('window.onbeforeunload = null;');
      this._dialogEnabled = true;
    } catch {}
  }

  async captureScreenshot(filePath = null) {
    try {
      if (!this._dialogEnabled) {
        await this.send('Page.enable').catch(() => {});
      }
      const res = await this.send('Page.captureScreenshot', { format: 'png' });
      if (res && res.data) {
        const buf = Buffer.from(res.data, 'base64');
        res.data = null;
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

  close(force = false) {
    this.release(force);
  }
}

function closeAllClients() {
  for (const client of new Set(clientPool.values())) {
    try {
      client.forceClose();
    } catch {}
  }
  clientPool.clear();
}

function getPoolStats() {
  const unique = new Set(clientPool.values());
  return {
    keys: clientPool.size,
    activeClients: Array.from(unique).filter(c => c.isOpen()).length
  };
}

process.once('exit', () => {
  closeAllClients();
});

async function listPages() {
  const jsonUrl = `${config.CDP_URL}/json/list`;
  const res = await fetch(jsonUrl);
  if (!res.ok) {
    throw new Error(`Failed to list CDP pages: ${res.statusText}`);
  }
  return await res.json();
}

async function getClientForPage(urlPattern, options = {}) {
  const reuse = options.reuse !== false;
  const patternKey = typeof urlPattern === 'string' ? `pattern:${urlPattern}` : `regex:${String(urlPattern)}`;

  if (reuse && clientPool.has(patternKey)) {
    const cached = clientPool.get(patternKey);
    if (cached && cached.isOpen()) {
      cached.retain();
      return cached;
    }
    clientPool.delete(patternKey);
  }

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

  const wsKey = `ws:${page.webSocketDebuggerUrl}`;
  if (reuse && clientPool.has(wsKey)) {
    const cachedByWs = clientPool.get(wsKey);
    if (cachedByWs && cachedByWs.isOpen()) {
      cachedByWs._poolKeys.add(patternKey);
      clientPool.set(patternKey, cachedByWs);
      cachedByWs.retain();
      return cachedByWs;
    }
    clientPool.delete(wsKey);
  }

  const client = new CDPClient(page.webSocketDebuggerUrl, {
    pooled: reuse,
    idleTtlMs: options.idleTtlMs
  });
  await client.ready;

  if (reuse) {
    client._poolKeys.add(patternKey);
    client._poolKeys.add(wsKey);
    clientPool.set(patternKey, client);
    clientPool.set(wsKey, client);
    client.retain();
  }
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
        const buf = Buffer.from(res.data, 'base64');
        res.data = null;
        fs.writeFileSync(targetFile, buf);
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
  closeAllClients,
  getPoolStats,
  captureDiagnosticScreenshot,
  sleep
};
