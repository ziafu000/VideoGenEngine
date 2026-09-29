const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
  const candidates = [
    'powershell.exe',
    '/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',
    'pwsh.exe',
    'pwsh'
  ];
  for (const c of candidates) {
    try {
      execSync(`${c} -NoProfile -Command "exit 0"`, {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 1000
      });
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
    const who = execSync(`${ps} -NoProfile -Command "[System.Environment]::UserName"`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 2000
    }).trim();
    if (who && who.length > 0) return who;
  } catch {}
  return process.env.USER || 'User';
}

// Determine Windows Host IP from default route or fallback
function getWinHost() {
  if (process.env.WIN_HOST) return process.env.WIN_HOST;
  try {
    const route = execSync("ip route | awk '/default/ {print $3}'", {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000
    }).trim();
    if (route) return route;
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
const YOUTUBE_STUDIO_URL = process.env.YOUTUBE_STUDIO_URL || (process.env.YOUTUBE_CHANNEL_ID ? `https://studio.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}` : 'https://studio.youtube.com');
const FACEBOOK_REELS_URL = process.env.FACEBOOK_REELS_URL || 'https://business.facebook.com/latest/reels_composer';

// Robust cross-platform path conversion (WSL to Windows)
function toWinPath(p) {
  if (!p) return p;
  const abs = path.resolve(p);
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

  const match = resolvedAbs.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  // Linux internal path fallback (e.g. WSL home dir):
  // Prefer direct WSL UNC path accessible by Windows apps (//wsl.localhost/...)
  try {
    const { execFileSync } = require('child_process');
    const unc = execFileSync('wslpath', ['-m', resolvedAbs], { encoding: 'utf8' }).trim();
    if (unc) return unc;
  } catch {}

  const winTempDir = `/mnt/c/Users/${WIN_USER}/AppData/Local/Temp`;
  if (fs.existsSync(winTempDir) && fs.existsSync(resolvedAbs)) {
    try {
      if (!fs.statSync(resolvedAbs).isDirectory()) {
        const dest = path.join(winTempDir, `vg_${Date.now()}_${path.basename(resolvedAbs)}`);
        fs.copyFileSync(resolvedAbs, dest);
        return `C:\\Users\\${WIN_USER}\\AppData\\Local\\Temp\\${path.basename(dest)}`;
      }
    } catch {}
  }
  return resolvedAbs;
}

module.exports = {
  WIN_USER,
  WIN_HOST,
  CDP_PORT,
  CDP_URL,
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
  FACEBOOK_REELS_URL,
  getPowerShellCmd,
  toWinPath
};
