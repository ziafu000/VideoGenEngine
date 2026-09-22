const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Determine Windows Host IP from default route or fallback
function getWinHost() {
  if (process.env.WIN_HOST) return process.env.WIN_HOST;
  try {
    const route = execSync("ip route | awk '/default/ {print $3}'", { encoding: 'utf8' }).trim();
    if (route) return route;
  } catch {}
  return '127.0.0.1';
}

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

const WIN_DOWNLOADS_DIR = process.env.WIN_DOWNLOADS_DIR || '/mnt/c/Users/ASUS/Downloads';
const DEST_ORIGINAL = process.env.DEST_ORIGINAL || '/mnt/d/Billy/Work/Editing/File video original';
const DEST_FINAL = process.env.DEST_FINAL || '/mnt/d/Billy/Work/Editing/File video after edit';

function toWinPath(p) {
  if (!p) return p;
  const match = p.match(/^\/mnt\/([a-zA-Z])\/(.*)/);
  if (match) {
    const drive = match[1].toUpperCase();
    const rest = match[2].replace(/\//g, '\\');
    return `${drive}:\\${rest}`;
  }
  return p;
}

module.exports = {
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
  toWinPath
};
