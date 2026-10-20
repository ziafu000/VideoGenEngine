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

// Dynamically detect Windows username without hardcoded assumptions
function getWinUser() {
  if (process.env.WIN_USERNAME) return process.env.WIN_USERNAME;
  const ps = getPowerShellCmd();
  try {
    const who = execFileSync(ps, ['-NoProfile', '-Command', '[System.Environment]::UserName'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim();
    if (who && who.length > 0) return who;
  } catch {}
  return process.env.USER || 'User';
}

// Determine WSL guest IP on the default route interface
function getWslGuestIp() {
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

const WIN_DOWNLOADS_DIR = process.env.WIN_DOWNLOADS_DIR || `/mnt/c/Users/${WIN_USER}/Downloads`;
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
const VIENEU_DEFAULT_VENV = path.join(os.homedir(), 'ai/vieneu/.venv/bin/python');
const VIENEU_PYTHON = process.env.VIENEU_PYTHON || (fs.existsSync(VIENEU_DEFAULT_VENV) ? VIENEU_DEFAULT_VENV : 'python3');

// Cache toWinPath results to reduce expensive wslpath subprocess invocations (PERF-04)
const winPathCache = new Map();
const MAX_WINPATH_CACHE = 1000;

// Robust cross-platform path conversion (WSL to Windows)
function toWinPath(p) {
  if (!p) return p;
  const abs = path.resolve(p);
  if (winPathCache.has(abs)) {
    return winPathCache.get(abs);
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
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    result = `${drive}:\\${rest}`;
  } else {
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
  winPathCache.set(abs, result);
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

module.exports = {
  WIN_USER,
  WIN_HOST,
  CDP_PORT,
  CDP_URL,
  CHROME_DEVTOOLS_AXI_SESSION,
  PROJECT_DIR,
  RENDERS_DIR,
  AUDIO_DIR,
  OUTPUT_DIR,
  STORYBOARDS_DIR,
  ASSETS_DIR,
  WIN_DOWNLOADS_DIR,
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
  getWslGuestIp,
  toWinPath,
  sanitizeIdentifier,
  isPathContained
};
