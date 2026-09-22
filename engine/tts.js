const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');

const DEFAULT_PROFILES = {
  Daisuke: {
    voiceName: 'Daisuke',
    searchKey: 'Daisuke',
    speed: 1.0,
    stability: 0.40,
    similarity: 0.80,
    style: 0.15
  },
  Lime: {
    voiceName: 'Lime',
    searchKey: 'Lime',
    speed: 1.0,
    stability: 0.35,
    similarity: 0.80,
    style: 0.25
  },
  Koichi: {
    voiceName: 'Koichi',
    searchKey: 'Koichi',
    speed: 0.95,
    stability: 0.85,
    similarity: 0.85,
    style: 0.00
  },
  Alistair: {
    voiceName: 'Alistair',
    searchKey: 'Alistair',
    speed: 1.0,
    stability: 0.50,
    similarity: 0.75,
    style: 0.00
  }
};

async function getElevenLabsClient() {
  return await getClientForPage('elevenlabs.io');
}

function getNewestDownload(downloadsDir) {
  try {
    const files = fs.readdirSync(downloadsDir)
      .filter(f => f.startsWith('ElevenLabs') && f.endsWith('.mp3'))
      .map(f => ({ name: f, time: fs.statSync(path.join(downloadsDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);
    return files.length > 0 ? files[0] : null;
  } catch {
    return null;
  }
}

// Helper: Detect and dismiss popups/obstacles using TypeSafe Jev
async function handleObstacles(cdp) {
  try {
    const obstacleInfo = await cdp.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]:not([data-voice-menu]), [role="alertdialog"], .modal');
      if (!dialog) return null;
      return {
        text: dialog.innerText ? dialog.innerText.slice(0, 300).replace(/[\\r\\n]+/g, ' ') : ''
      };
    })()`);

    if (obstacleInfo && obstacleInfo.text) {
      const obsOut = execSync(`browser-jev obstacle --text ${JSON.stringify(obstacleInfo.text)}`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000
      });
      const parsed = JSON.parse(obsOut);
      if (parsed.has_obstacle) {
        console.warn(`    [!] TypeSafe Jev phát hiện popup ElevenLabs: ${parsed.obstacle_type} (${parsed.suggested_action})`);
        await cdp.evaluate(`(() => {
          const btn = document.querySelector('button[aria-label="Close"], button[aria-label="Đóng"], button[data-testid="close-button"]');
          if (btn) btn.click();
        })()`);
      }
    }
  } catch {}
}

// Helper: Classify ElevenLabs TTS error using TypeSafe Jev
function classifyTtsError(text) {
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  try {
    const states = JSON.stringify({
      error: "an error, quota exceeded, character limit or speech synthesis failure occurred",
      generating: "audio speech synthesis is actively generating or rendering",
      neutral: "normal status or informational text"
    });
    const out = execSync(`browser-jev classify --states ${JSON.stringify(states)} --text ${JSON.stringify(text)}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000
    });
    return JSON.parse(out);
  } catch {
    const lower = text.toLowerCase();
    if (lower.includes('quota') || lower.includes('limit') || lower.includes('error') || lower.includes('failed') || lower.includes('lỗi')) {
      return { choice: 'error', confidence: 0.9 };
    }
    return { choice: 'neutral', confidence: 0.8 };
  }
}

async function setVoice(cdp, profile) {
  const voiceName = profile.voiceName || profile.searchKey;
  const cur = await cdp.evaluate(`(() => {
    const btn = document.querySelector('button[aria-label*="Select voice"]');
    return btn ? btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, '').trim().replace(/\\s+/g, ' ') : '';
  })()`);

  if (cur && cur.includes(voiceName)) {
    return;
  }

  console.log(`    [-] Chuyển giọng ElevenLabs sang: ${voiceName}...`);
  await cdp.evaluate(`(async () => {
    let pop = document.querySelector('[data-state="open"][role="dialog"]');
    if (!pop) {
      const btn = document.querySelector('button[aria-label*="Select voice"]');
      if (btn) btn.click();
    }
  })()`);
  await sleep(1000);

  const searchKey = profile.searchKey || voiceName;
  await cdp.evaluate(`(() => {
    const pop = document.querySelector('[data-state="open"][role="dialog"]');
    if (!pop) return;
    const input = pop.querySelector('input[placeholder*="search" i]');
    if (input) {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeSetter.call(input, ${JSON.stringify(searchKey)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  })()`);
  await sleep(1200);

  await cdp.evaluate(`(() => {
    const pop = document.querySelector('[data-state="open"][role="dialog"]');
    if (!pop) return;
    const match = Array.from(pop.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes(${JSON.stringify(searchKey)}) && el.children.length === 0);
    if (match) {
      const target = match.closest('[role="button"], button') || match.parentElement;
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  })()`);
  await sleep(1000);
}

async function setSliders(cdp, profile) {
  const sliders = [
    { label: 'Stability', val: profile.stability !== undefined ? profile.stability : 0.40 },
    { label: 'Similarity', val: profile.similarity !== undefined ? profile.similarity : 0.80 },
    { label: 'Style Exaggeration', val: profile.style !== undefined ? profile.style : 0.15 }
  ];

  for (const s of sliders) {
    const coords = await cdp.evaluate(`(() => {
      const thumb = document.querySelector('[role="slider"][aria-label="${s.label}"]');
      if (!thumb) return null;
      const track = thumb.parentElement.parentElement;
      const r = track.getBoundingClientRect();
      return { x: r.left + r.width * ${s.val}, y: r.top + r.height / 2 };
    })()`);

    if (coords && coords.x) {
      await cdp.clickMouse(coords.x, coords.y);
      await sleep(100);
    }
  }
}

async function generateClip(cdp, text, destFile, profile) {
  const dir = path.dirname(destFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const beforeDownload = getNewestDownload(config.WIN_DOWNLOADS_DIR);

  // 0. Check & dismiss any unexpected popups via TypeSafe Jev
  await handleObstacles(cdp);

  // 1. Voice & Sliders
  await setVoice(cdp, profile);
  await setSliders(cdp, profile);

  // 2. Set text in textarea
  console.log(`    [-] Nhập văn bản TTS: "${text.slice(0, 35)}..."`);
  await cdp.evaluate(`(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await sleep(500);

  // 3. Click generate
  console.log(`    [-] Bấm Generate speech...`);
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Generate speech Ctrl+Enter"]') ||
                document.querySelector('button[aria-label="Regenerate speech Ctrl+Enter"]') ||
                Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Generate speech') || b.innerText.includes('Regenerate speech'));
    if (btn && !btn.disabled) btn.click();
  })()`);

  // 4. Wait for generation to finish
  let ready = false;
  process.stdout.write('    [-] Đang tổng hợp âm thanh: ');
  for (let i = 0; i < 30; i++) {
    await sleep(1500);
    const state = await cdp.evaluate(`(() => {
      const loading = document.querySelectorAll('[data-loading="true"], .animate-spin, svg.animate-spin');
      const audio = document.querySelector('audio');
      const errBanner = document.querySelector('[role="alert"], [class*="destructive"], [class*="error-message"]');
      return {
        isDone: (loading.length === 0 && audio && audio.duration > 0),
        errorText: errBanner ? errBanner.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null
      };
    })()`);

    if (state && state.errorText) {
      const jErr = classifyTtsError(state.errorText);
      if (jErr.choice === 'error') {
        process.stdout.write(' ✗\n');
        throw new Error(`ElevenLabs báo lỗi TTS [TypeSafe Jev: ${jErr.choice}]: ${state.errorText}`);
      }
    }

    if (state && state.isDone) {
      ready = true;
      break;
    }
    process.stdout.write('.');
  }
  process.stdout.write(ready ? ' ✓\n' : ' ✗\n');

  if (!ready) {
    throw new Error('Timeout khi chờ ElevenLabs tạo âm thanh!');
  }

  // 5. Download audio
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('button[aria-label="Download Audio"]') ||
                document.querySelector('button[aria-label="Download latest"]');
    if (btn) {
      btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      btn.click();
    }
  })()`);

  // 6. Move file from Downloads
  let downloadedFile = null;
  for (let i = 0; i < 15; i++) {
    await sleep(1000);
    const newest = getNewestDownload(config.WIN_DOWNLOADS_DIR);
    if (newest && (!beforeDownload || newest.name !== beforeDownload.name || newest.time > beforeDownload.time)) {
      downloadedFile = path.join(config.WIN_DOWNLOADS_DIR, newest.name);
      break;
    }
  }

  if (!downloadedFile || !fs.existsSync(downloadedFile)) {
    throw new Error('Không tìm thấy file MP3 vừa tải về trong thư mục Downloads!');
  }

  fs.copyFileSync(downloadedFile, destFile);
  console.log(`    [✓] Đã lưu voice clip: ${destFile} (${fs.statSync(destFile).size} bytes)`);
  return destFile;
}

// Generate all voices defined in a storyboard
async function generateAllVoices(storyboardData, targetShotIds = null) {
  const profiles = { ...DEFAULT_PROFILES, ...(storyboardData.voice_profiles || {}) };
  const shots = storyboardData.shots || [];
  const cdp = await getElevenLabsClient();

  const episodeName = storyboardData.project && storyboardData.project.series
    ? (storyboardData.project.series + '_ep' + String(storyboardData.project.episode || 1).padStart(2, '0')).replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    : 'voices';

  const outDir = path.join(config.AUDIO_DIR, episodeName);

  try {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;

      if (targetShotIds && targetShotIds.length > 0 && !targetShotIds.includes(shotId)) {
        continue;
      }

      const voiceoverText = (s.audio && (s.audio.voiceover || s.audio.japanese_voiceover)) || s.japanese_voiceover || s.voiceover;
      if (!voiceoverText || voiceoverText.trim() === '') {
        console.log(`[-] [${i + 1}/${shots.length}] ${shotId}: Không có lời thoại (SFX/Ambient/Outro) -> Bỏ qua.`);
        continue;
      }

      const destFile = path.join(outDir, `voice_${shotId}.mp3`);
      if (fs.existsSync(destFile) && fs.statSync(destFile).size > 1000) {
        console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: File đã tồn tại (${fs.statSync(destFile).size} bytes), bỏ qua.`);
        continue;
      }

      const speaker = (s.audio && (s.audio.speaker || s.audio.voice_model)) || s.speaker || s.voice_model || 'Daisuke';
      const prof = profiles[speaker] || profiles.Daisuke;

      console.log(`\n>>> [${i + 1}/${shots.length}] Tạo voice cho ${shotId} (Người nói: ${speaker})...`);
      await generateClip(cdp, voiceoverText, destFile, prof);
    }
  } finally {
    cdp.close();
  }

  console.log(`\n✓ Hoàn tất tạo voiceover cho dự án!`);
  return outDir;
}

module.exports = {
  getElevenLabsClient,
  generateClip,
  generateAllVoices,
  DEFAULT_PROFILES
};
