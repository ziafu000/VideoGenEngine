const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

// Load .env from project root (gitignored — contains user-specific paths)
const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  });
}

// Find available PowerShell executable on Windows/WSL
function getPowerShellCmd() {
  if (process.platform === 'win32') {
    try {
      execFileSync('where.exe', ['pwsh.exe'], { stdio: 'ignore', timeout: 500 });
      return 'pwsh.exe';
    } catch {}
    return 'powershell.exe';
  }

  const stdPath = '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe';
  if (fs.existsSync(stdPath)) return stdPath;

  const candidates = [
    'powershell.exe',
    'pwsh.exe',
    'pwsh'
  ];
  for (const c of candidates) {
    try {
      execFileSync('which', [c], { stdio: 'ignore', timeout: 500 });
      return c;
    } catch {}
  }
  return 'powershell.exe';
}

// Dynamically detect OS / Windows username without hardcoded assumptions
function getWinUser() {
  if (process.env.WIN_USERNAME) return process.env.WIN_USERNAME;
  if (process.platform === 'win32') {
    if (process.env.USERNAME) return process.env.USERNAME;
    try { return os.userInfo().username; } catch {}
  }
  if (process.platform === 'darwin' || (process.platform === 'linux' && !fs.existsSync('/mnt/c/Windows'))) {
    if (process.env.USER) return process.env.USER;
    try { return os.userInfo().username; } catch {}
  }
  const ps = getPowerShellCmd();
  try {
    const who = execFileSync(ps, ['-NoProfile', '-Command', '[System.Environment]::UserName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim();
    if (who && who.length > 0) return who;
  } catch {}
  return process.env.USER || process.env.USERNAME || 'User';
}

// Determine WSL guest IP on the default route interface
function getWslGuestIp() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return '';
  }
  try {
    const routeOut = execFileSync('ip', ['route'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    });
    for (const line of routeOut.split(/\r?\n/)) {
      const m = line.match(/\bsrc\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
      if (m && m[1]) return m[1];
    }
  } catch {}
  return '';
}
function getWinHost() {
  if (process.env.WIN_HOST) return process.env.WIN_HOST;
  if (process.platform === 'win32' || process.platform === 'darwin' || !fs.existsSync('/mnt/c/Windows')) {
    return '127.0.0.1';
  }
  try {
    const routeOut = execFileSync('ip', ['route'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    });
    const defaultLine = routeOut.split(/\r?\n/).find(line => line.startsWith('default '));
    if (defaultLine) {
      const parts = defaultLine.trim().split(/\s+/);
      if (parts[2]) return parts[2];
    }
  } catch {}
  return '127.0.0.1';
}

const WIN_USER = getWinUser();
const WIN_HOST = getWinHost();
const CDP_PORT = parseInt(process.env.CDP_PORT || '9223', 10);
const CDP_URL = `http://${WIN_HOST}:${CDP_PORT}`;

const PROJECT_DIR = path.resolve(__dirname, '..');
const RENDERS_DIR = path.join(PROJECT_DIR, 'renders');
const AUDIO_DIR = path.join(PROJECT_DIR, 'audio');
const OUTPUT_DIR = path.join(PROJECT_DIR, 'output');
const STORYBOARDS_DIR = path.join(PROJECT_DIR, 'storyboards');
const ASSETS_DIR = path.join(PROJECT_DIR, 'assets');

// Automatically ensure runtime directories exist on startup
[RENDERS_DIR, AUDIO_DIR, OUTPUT_DIR, STORYBOARDS_DIR, ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Resolve candidate download directories (env override, D:\Downloads on WSL, C:\Users\<user>\Downloads, or native ~/Downloads)
function resolveDownloadDirs(options = {}) {
  const envDir = options.envDir !== undefined ? options.envDir : process.env.WIN_DOWNLOADS_DIR;
  const platform = options.platform !== undefined ? options.platform : process.platform;
  const homedir = options.homedir !== undefined ? options.homedir : os.homedir();
  const winUser = options.winUser !== undefined ? options.winUser : WIN_USER;
  const existsFn = typeof options.existsFn === 'function' ? options.existsFn : (p) => fs.existsSync(p);
  const existingOnly = options.existingOnly !== false;

  const rawCandidates = [];
  if (envDir && String(envDir).trim()) {
    rawCandidates.push(String(envDir).trim());
  }

  const isWslLike = platform !== 'win32' && platform !== 'darwin' && (existsFn('/mnt/c/Users') || existsFn('/mnt/d'));
  if (isWslLike) {
    rawCandidates.push('/mnt/d/Downloads');
    if (winUser) {
      rawCandidates.push(`/mnt/c/Users/${winUser}/Downloads`);
    }
  } else {
    rawCandidates.push(path.join(homedir, 'Downloads'));
  }

  const seen = new Set();
  const deduped = [];
  for (const c of rawCandidates) {
    const normalized = String(c).replace(/[\\/]+$/, '') || c;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduped.push(normalized);
    }
  }

  if (!existingOnly) return deduped;
  const existing = deduped.filter(d => {
    try { return Boolean(existsFn(d)); } catch { return false; }
  });
  return existing.length > 0 ? existing : deduped.slice(0, 1);
}

const WIN_DOWNLOAD_CANDIDATE_DIRS = resolveDownloadDirs();
const WIN_DOWNLOADS_DIR = WIN_DOWNLOAD_CANDIDATE_DIRS[0] || (
  (process.platform === 'win32' || process.platform === 'darwin' || !fs.existsSync('/mnt/c/Users'))
    ? path.join(os.homedir(), 'Downloads')
    : `/mnt/c/Users/${WIN_USER}/Downloads`
);
const DEST_ORIGINAL = process.env.DEST_ORIGINAL || null;
const DEST_FINAL = process.env.DEST_FINAL || null;
// Dynamic channel lookup from gitignored environment variables (zero hardcoded channel IDs)
let customChannels = {};
if (process.env.YOUTUBE_CHANNELS_JSON) {
  try {
    let raw = process.env.YOUTUBE_CHANNELS_JSON.trim();
    if (raw.startsWith("'") && raw.endsWith("'")) raw = raw.slice(1, -1).trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1).trim();
    customChannels = JSON.parse(raw);
  } catch {}
}

const YOUTUBE_STUDIO_URL = process.env.YOUTUBE_STUDIO_URL || 'https://studio.youtube.com';

function resolveChannelUrl(channelIdOrName) {
  if (!channelIdOrName) return null;
  if (channelIdOrName.startsWith('http://') || channelIdOrName.startsWith('https://')) {
    return channelIdOrName;
  }
  const normalized = String(channelIdOrName).toLowerCase().replace(/[\s-]+/g, '_');
  const matchedId = customChannels[normalized] || channelIdOrName;
  if (matchedId.startsWith('http://') || matchedId.startsWith('https://')) {
    return matchedId;
  }
  return `https://studio.youtube.com/channel/${matchedId}`;
}
const FACEBOOK_ASSET_ID = process.env.FACEBOOK_ASSET_ID || null;
const FACEBOOK_BUSINESS_ID = process.env.FACEBOOK_BUSINESS_ID || null;
const FACEBOOK_REELS_URL = process.env.FACEBOOK_REELS_URL ||
  (FACEBOOK_ASSET_ID ? `https://business.facebook.com/latest/reels_composer/?asset_id=${FACEBOOK_ASSET_ID}${FACEBOOK_BUSINESS_ID ? `&business_id=${FACEBOOK_BUSINESS_ID}` : ''}&ref=biz_web_home_create_reel&context_ref=HOME` : 'https://business.facebook.com/latest/reels_composer');
const TTS_PROVIDER = process.env.TTS_PROVIDER || 'vieneu';
const VIENEU_DEFAULT_VENV = process.platform === 'win32'
  ? path.join(os.homedir(), 'ai', 'vieneu', '.venv', 'Scripts', 'python.exe')
  : path.join(os.homedir(), 'ai/vieneu/.venv/bin/python');
const DEFAULT_PYTHON_CMD = process.platform === 'win32' ? 'python' : 'python3';
const VIENEU_PYTHON = process.env.VIENEU_PYTHON || (fs.existsSync(VIENEU_DEFAULT_VENV) ? VIENEU_DEFAULT_VENV : DEFAULT_PYTHON_CMD);

// Cache toWinPath results to reduce expensive wslpath subprocess invocations (PERF-04)
const winPathCache = new Map();
const MAX_WINPATH_CACHE = 1000;

const IS_FFMPEG_ELF = (() => {
  if (process.platform === 'win32' || process.platform === 'darwin') return false;
  try {
    const ffBin = execFileSync('which', ['ffmpeg'], { encoding: 'utf8', timeout: 1000 }).trim();
    if (ffBin && fs.existsSync(ffBin)) {
      const fd = fs.openSync(fs.realpathSync(ffBin), 'r');
      const buf = Buffer.alloc(4);
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
    }
  } catch {}
  return false;
})();

// Robust cross-platform path conversion (Native Windows / macOS / Linux / WSL)
function toWinPath(p) {
  if (!p) return p;
  const rawStr = String(p);
  const rawMntMatch = rawStr.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
  if (rawMntMatch && process.platform === 'win32') {
    const drive = rawMntMatch[1].toUpperCase();
    const rest = rawMntMatch[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }

  const stack = new Error().stack || '';
  const isBrowserCaller = /youtube_uploader|facebook_uploader|tiktok_uploader|board\.js/.test(stack);
  const abs = path.resolve(p);
  const cacheKey = `${isBrowserCaller ? 'W:' : 'F:'}${abs}`;
  if (winPathCache.has(cacheKey)) {
    return winPathCache.get(cacheKey);
  }

  if (process.platform === 'win32') {
    const winNorm = path.win32.normalize(abs);
    if (winPathCache.size >= MAX_WINPATH_CACHE) {
      const firstKey = winPathCache.keys().next().value;
      winPathCache.delete(firstKey);
    }
    winPathCache.set(cacheKey, winNorm);
    return winNorm;
  }

  if (process.platform === 'darwin') {
    if (winPathCache.size >= MAX_WINPATH_CACHE) {
      const firstKey = winPathCache.keys().next().value;
      winPathCache.delete(firstKey);
    }
    winPathCache.set(cacheKey, abs);
    return abs;
  }

  // Resolve symlinks if path or its parent directory is a symlink (WSL / Windows compatibility)
  let resolvedAbs = abs;
  try {
    if (fs.existsSync(abs)) {
      resolvedAbs = fs.realpathSync(abs);
    } else {
      const parent = path.dirname(abs);
      if (fs.existsSync(parent)) {
        resolvedAbs = path.join(fs.realpathSync(parent), path.basename(abs));
      }
    }
  } catch {}

  let result = resolvedAbs;
  const match = resolvedAbs.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
  if (match && (!IS_FFMPEG_ELF || isBrowserCaller || !fs.existsSync(resolvedAbs))) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    result = `${drive}:\\${rest}`;
  } else if (!match && (!IS_FFMPEG_ELF || isBrowserCaller) && (fs.existsSync('/mnt/c/Windows') || process.env.WSL_DISTRO_NAME)) {
    // Linux internal path fallback (e.g. WSL home dir):
    // Prefer direct WSL UNC path accessible by Windows apps (//wsl.localhost/...)
    let uncSuccess = false;
    try {
      const { execFileSync } = require('child_process');
      const unc = execFileSync('wslpath', ['-m', resolvedAbs], { encoding: 'utf8', timeout: 5000 }).trim();
      if (unc) {
        result = unc;
        uncSuccess = true;
      }
    } catch {}

    if (!uncSuccess) {
      const winTempDir = `/mnt/c/Users/${WIN_USER}/AppData/Local/Temp`;
      if (fs.existsSync(winTempDir) && fs.existsSync(resolvedAbs)) {
        try {
          if (!fs.statSync(resolvedAbs).isDirectory()) {
            const dest = path.join(winTempDir, `vg_${Date.now()}_${path.basename(resolvedAbs)}`);
            fs.copyFileSync(resolvedAbs, dest);
            result = `C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\${path.basename(dest)}`;
          }
        } catch {}
      }
    }
  }

  if (winPathCache.size >= MAX_WINPATH_CACHE) {
    const firstKey = winPathCache.keys().next().value;
    winPathCache.delete(firstKey);
  }
  winPathCache.set(cacheKey, result);
  return result;
}

/**
 * Sanitize an identifier (shot ID, episode ID, series ID) to prevent directory traversal (A14)
 * Only allows alphanumeric, underscore, and hyphen characters.
 * @param {string} id
 * @param {string} fallback
 * @returns {string}
 */
function sanitizeIdentifier(id, fallback = 'default') {
  if (!id || typeof id !== 'string') return fallback;
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Verify whether a target path is safely contained within an allowed base directory (A14)
 * @param {string} baseDir
 * @param {string} targetPath
 * @returns {boolean}
 */
function isPathContained(baseDir, targetPath) {
  const rel = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

const CHROME_DEVTOOLS_AXI_SESSION = process.env.CHROME_DEVTOOLS_AXI_SESSION || null;

// Convert a WSL drive mount path (/mnt/<drive>/...) to a Windows drive path (<DRIVE>:\\...).
// Returns null when the path is not under a /mnt/<drive> mount.
function mntToWinDrivePath(p) {
  if (!p || typeof p !== 'string') return null;
  const match = p.replace(/\\/g, '/').match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (!match) return null;
  const drive = match[1].toUpperCase();
  const rest = (match[2] || '').replace(/\/+$/, '').replace(/\//g, '\\');
  return `${drive}:\\${rest}`;
}

// Resolve where a Linux-internal file must be staged so Windows Chrome can read it.
// The staging directory is the configured downloads dir (WIN_DOWNLOADS_DIR by default);
// returns null when that directory is not on a Windows drive mount.
function resolveUploadStaging(absPath, downloadsDir = WIN_DOWNLOADS_DIR) {
  if (!absPath || !downloadsDir) return null;
  const winDir = mntToWinDrivePath(path.posix.resolve(String(downloadsDir).replace(/\\/g, '/')));
  if (!winDir) return null;
  const destName = path.basename(absPath);
  return {
    copyTo: path.posix.join(String(downloadsDir).replace(/\\/g, '/'), destName),
    winPath: winDir.endsWith('\\') ? `${winDir}${destName}` : `${winDir}\\${destName}`
  };
}

// Convert a path so that Windows Chrome (via CDP DOM.setFileInputFiles) can always access it.
// In WSL, files living on the Linux filesystem are staged into WIN_DOWNLOADS_DIR first.
function toWinUploadPath(p, options = {}) {
  if (!p) return p;
  if (process.platform === 'win32' || process.platform === 'darwin') return toWinPath(p);
  const abs = path.resolve(p);
  const direct = mntToWinDrivePath(abs);
  if (direct) return direct;

  const isWsl = options.isWsl !== undefined
    ? Boolean(options.isWsl)
    : (fs.existsSync('/mnt/c/Windows') || Boolean(process.env.WSL_DISTRO_NAME));
  if (isWsl) {
    const staging = resolveUploadStaging(abs, options.downloadsDir || WIN_DOWNLOADS_DIR);
    if (staging) {
      try {
        if (!fs.existsSync(staging.copyTo) || fs.statSync(staging.copyTo).size !== fs.statSync(abs).size) {
          fs.mkdirSync(path.dirname(staging.copyTo), { recursive: true });
          fs.copyFileSync(abs, staging.copyTo);
        }
        return staging.winPath;
      } catch {}
    }
  }
  return toWinPath(p);
}

module.exports = {
  WIN_USER,
  WIN_HOST,
  CDP_PORT,
  CDP_URL,
  CHROME_DEVTOOLS_AXI_SESSION,
  toWinUploadPath,
  mntToWinDrivePath,
  resolveUploadStaging,
  PROJECT_DIR,
  RENDERS_DIR,
  AUDIO_DIR,
  OUTPUT_DIR,
  STORYBOARDS_DIR,
  ASSETS_DIR,
  WIN_DOWNLOADS_DIR,
  WIN_DOWNLOAD_CANDIDATE_DIRS,
  resolveDownloadDirs,
  DEST_ORIGINAL,
  DEST_FINAL,
  YOUTUBE_STUDIO_URL,
  resolveChannelUrl,
  FACEBOOK_ASSET_ID,
  FACEBOOK_BUSINESS_ID,
  FACEBOOK_REELS_URL,
  TTS_PROVIDER,
  VIENEU_PYTHON,
  getPowerShellCmd,
  getWinHost,
  getWslGuestIp,
  toWinPath,
  sanitizeIdentifier,
  isPathContained
};
