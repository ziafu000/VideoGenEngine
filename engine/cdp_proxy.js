// Proxy bridging Windows localhost Chrome DevTools (127.0.0.1:9222) to port 9223 for WSL access
// SEC-01 Hardened: Restricts access strictly to loopback (127.0.0.1, ::1) and WSL subnet (172.16.0.0/12).
const net = require('net');
const os = require('os');

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = parseInt(process.env.CDP_TARGET_PORT || '9222', 10);
const LISTEN_PORT = parseInt(process.env.CDP_PORT || '9223', 10);

/**
 * Validate whether a remote client IP is allowed to access the CDP proxy.
 * Only loopback (127.0.0.1, ::1) and specifically permitted WSL interfaces are allowed.
 * Does NOT allow arbitrary external LAN ranges (A03).
 * @param {string} remoteAddress
 * @returns {boolean}
 */
function isAllowedClientIp(remoteAddress) {
  if (!remoteAddress || typeof remoteAddress !== 'string') return false;
  const clean = remoteAddress.replace(/^::ffff:/i, '').trim();

  if (clean === '127.0.0.1' || clean === '::1') {
    return true;
  }

  // Explicit allowed clients via environment configuration
  if (process.env.CDP_ALLOWED_CLIENTS || process.env.CDP_ALLOWED_IPS) {
    const raw = (process.env.CDP_ALLOWED_CLIENTS || process.env.CDP_ALLOWED_IPS).trim();
    const allowedList = raw.split(/[,;\s]+/).map(ip => ip.trim());
    if (allowedList.includes(clean)) return true;
  }

  // Standard WSL vEthernet subnet (172.16.0.0/12: 172.16.0.0 - 172.31.255.255)
  const match = clean.match(/^172\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    const o2 = parseInt(match[1], 10);
    const o3 = parseInt(match[2], 10);
    const o4 = parseInt(match[3], 10);
    if (o2 >= 16 && o2 <= 31 && o3 >= 0 && o3 <= 255 && o4 >= 0 && o4 <= 255) {
      return true;
    }
  }

  return false;
}

/**
 * Discover allowed local bind addresses (127.0.0.1 and WSL vEthernet 172.16.0.0/12 interfaces).
 * Never binds to LAN interfaces (e.g. 192.168.x.x or 10.x.x.x).
 * @returns {string[]}
 */
function getBindAddresses() {
  if (process.env.CDP_PROXY_BIND) {
    const customList = process.env.CDP_PROXY_BIND.trim().split(/[,;\s]+/).map(h => h.trim()).filter(Boolean);
    const valid = customList.filter(h => isAllowedClientIp(h));
    if (valid.length > 0) {
      if (!valid.includes('127.0.0.1')) valid.unshift('127.0.0.1');
      return valid;
    }
  }

  const hosts = new Set(['127.0.0.1']);
  try {
    const ifaces = os.networkInterfaces() || {};
    for (const entries of Object.values(ifaces)) {
      for (const info of (entries || [])) {
        if (info && (info.family === 'IPv4' || info.family === 4) && isAllowedClientIp(info.address)) {
          hosts.add(info.address);
        }
      }
    }
  } catch {}
  return Array.from(hosts);
}

/**
 * Create a hardened TCP proxy server instance with immediate connection destruction for disallowed IPs.
 */
function createProxyServer() {
  return net.createServer((clientSocket) => {
    const remoteIp = clientSocket.remoteAddress || '';
    if (!isAllowedClientIp(remoteIp)) {
      console.warn(`[CDP Proxy] Rejected unauthorized connection from ${remoteIp || 'unknown'}`);
      clientSocket.destroy();
      return;
    }

    const chromeSocket = net.connect(TARGET_PORT, TARGET_HOST);

    clientSocket.pipe(chromeSocket).pipe(clientSocket);

    chromeSocket.on('error', () => {
      // Nếu Chrome chưa bật hoặc bị tắt, ngắt kết nối ngay thay vì treo client
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      chromeSocket.destroy();
    });

    // Lifecycle & cleanup bounds: ensure peer socket is destroyed when client closes (A12)
    clientSocket.on('close', () => {
      chromeSocket.destroy();
    });
    clientSocket.on('end', () => {
      chromeSocket.end();
    });
    chromeSocket.on('close', () => {
      clientSocket.destroy();
    });
    chromeSocket.on('end', () => {
      clientSocket.end();
    });
  });
}

if (require.main === module) {
  const bindHosts = getBindAddresses();
  for (const host of bindHosts) {
    const srv = createProxyServer();
    srv.on('error', (err) => {
      console.error(`[CDP Proxy] Failed to bind ${host}:${LISTEN_PORT}: ${err.message}`);
    });
    srv.listen(LISTEN_PORT, host, () => {
      console.log(`[CDP Proxy] Listening on ${host}:${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT} (WSL/Loopback ACL active)`);
    });
  }
}

module.exports = {
  isAllowedClientIp,
  getBindAddresses,
  createProxyServer
};

