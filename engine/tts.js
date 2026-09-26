const fs = require('fs');
const path = require('path');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

// Built-in generic fallback profiles — series-specific voices belong in storyboard voice_profiles.
// Daisuke/Lime/Koichi are kept here only as named references so existing storyboards
// that declare those keys in voice_profiles continue to resolve correctly.
const DEFAULT_PROFILES = {
  // Generic neutral narrator — safe fallback when storyboard has no voice_profiles
  Alistair: {
    voiceName: 'Alistair',
    searchKey: 'Alistair',
    speed: 1.0,
    stability: 0.50,
    similarity: 0.75,
    style: 0.00
  },
  // Named-voice pass-throughs: resolved from storyboard voice_profiles at runtime
  Daisuke: { voiceName: 'Daisuke', searchKey: 'Daisuke', speed: 1.0, stability: 0.40, similarity: 0.80, style: 0.15 },
  Lime:    { voiceName: 'Lime',    searchKey: 'Lime',    speed: 1.0, stability: 0.35, similarity: 0.80, style: 0.25 },
  Koichi:  { voiceName: 'Koichi',  searchKey: 'Koichi',  speed: 0.95, stability: 0.85, similarity: 0.85, style: 0.00 }
};

async function getElevenLabsClient() {
  const client = await getClientForPage('elevenlabs.io');
  const winDownloads = config.toWinPath(config.WIN_DOWNLOADS_DIR);
  try {
    await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: winDownloads });
    await client.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: winDownloads, eventsEnabled: true });
  } catch {}
  return client;
}

function getNewestDownload(downloadsDir) {
  try {
    const files = fs.readdirSync(downloadsDir)
      .filter(f => (f.endsWith('.mp3') || f.endsWith('.tmp')) && !f.endsWith('.crdownload'))
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
      const parsed = jev.obstacle(obstacleInfo.text);
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
  const res = jev.classify(text, {
    error: "an error, quota exceeded, character limit or speech synthesis failure occurred",
    generating: "audio speech synthesis is actively generating or rendering",
    neutral: "normal status or informational text"
  });
  if (res.choice) return res;
  const lower = text.toLowerCase();
  if (lower.includes('quota') || lower.includes('limit') || lower.includes('error') || lower.includes('failed') || lower.includes('lỗi')) {
    return { choice: 'error', confidence: 0.9 };
  }
  return { choice: 'neutral', confidence: 0.8 };
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

  // 0. Check & dismiss any unexpected popups / close voice dialog if stuck open
  await handleObstacles(cdp);
  await cdp.evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog && !dialog.getAttribute('data-voice-menu')) {
      const closeBtn = dialog.querySelector('button[aria-label="Close"], button[aria-label="Đóng"], button[data-testid="close-button"]');
      if (closeBtn) closeBtn.click();
    }
  })()`);

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
  await sleep(600);

  // 3. Click generate
  console.log(`    [-] Bấm Generate speech...`);
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="tts-generate"]') ||
                document.querySelector('button[aria-label="Generate speech Ctrl+Enter"]') ||
                document.querySelector('button[aria-label="Regenerate speech Ctrl+Enter"]') ||
                Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Generate speech') || b.innerText.includes('Regenerate speech'));
    if (btn && !btn.disabled) btn.click();
  })()`);

  // 4. Wait for generation to finish (wait for Loading state -> then wait for completion)
  let ready = false;
  process.stdout.write('    [-] Đang tổng hợp âm thanh: ');

  // Give 1-2s for loading state to kick in
  for (let w = 0; w < 5; w++) {
    await sleep(500);
    const isBusy = await cdp.evaluate(`(() => {
      const btn = document.querySelector('[data-testid="tts-generate"]');
      return btn && (btn.disabled || (btn.innerText && btn.innerText.includes('Loading')));
    })()`);
    if (isBusy) break;
  }

  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const state = await cdp.evaluate(`(() => {
      const genBtn = document.querySelector('[data-testid="tts-generate"]');
      const dlBtn = document.querySelector('[data-testid="tts-download-latest-button"], button[aria-label="Download latest"], button[aria-label="Download Audio"]');
      const errBanner = document.querySelector('[role="alert"], [class*="destructive"], [class*="error-message"]');
      const isLoading = genBtn && (genBtn.disabled || (genBtn.innerText && genBtn.innerText.includes('Loading')));
      return {
        isDone: (!isLoading && dlBtn && !dlBtn.disabled),
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

  // 5. Download audio using direct CDP Network response body interception + file fallback
  await cdp.send('Network.enable');

  let audioSaved = false;
  const interceptPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 8000);
    const onMsg = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.method === 'Network.responseReceived') {
          const resp = msg.params.response;
          if (resp.url.includes('/history/download') && (resp.mimeType.includes('audio') || resp.mimeType.includes('mpeg'))) {
            await sleep(500);
            try {
              const body = await cdp.send('Network.getResponseBody', { requestId: msg.params.requestId });
              if (body && body.body) {
                const buf = Buffer.from(body.body, body.base64Encoded ? 'base64' : 'binary');
                if (buf.length > 2000) {
                  fs.writeFileSync(destFile, buf);
                  audioSaved = true;
                  clearTimeout(timer);
                  cdp.ws.removeEventListener('message', onMsg);
                  resolve(true);
                }
              }
            } catch {}
          }
        }
      } catch {}
    };
    cdp.ws.addEventListener('message', onMsg);
  });

  // Click download button
  await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="tts-download-latest-button"]') ||
                document.querySelector('[data-testid="audio-player-download-button"]');
    if (btn) btn.click();
  })()`);

  await interceptPromise;

  // 6. Fallback: Check Downloads folder if network intercept didn't write the file
  if (!audioSaved || !fs.existsSync(destFile) || fs.statSync(destFile).size < 2000) {
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const newest = getNewestDownload(config.WIN_DOWNLOADS_DIR);
      if (newest && (!beforeDownload || newest.name !== beforeDownload.name || newest.time > beforeDownload.time)) {
        const downloadedFile = path.join(config.WIN_DOWNLOADS_DIR, newest.name);
        if (fs.existsSync(downloadedFile) && fs.statSync(downloadedFile).size > 2000) {
          fs.copyFileSync(downloadedFile, destFile);
          audioSaved = true;
          break;
        }
      }
    }
  }

  if (!fs.existsSync(destFile) || fs.statSync(destFile).size < 2000) {
    throw new Error('Không thể tải hoặc trích xuất file MP3 từ ElevenLabs!');
  }

  console.log(`    [✓] Đã lưu voice clip: ${destFile} (${fs.statSync(destFile).size} bytes)`);
  return destFile;
}

// Generate all voices defined in a storyboard
async function generateAllVoices(storyboardData, targetShotIds = null) {
  const profiles = { ...DEFAULT_PROFILES, ...(storyboardData.voice_profiles || {}) };
  const shots = storyboardData.shots || [];
  const cdp = await getElevenLabsClient();

  const episodeName = storyboardData.series_id ||
    (storyboardData.project && storyboardData.project.series ? `${storyboardData.project.series}_ep${String(storyboardData.project.episode || 1).padStart(2, '0')}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase() : '') ||
    (storyboardData.project && storyboardData.project.id ? storyboardData.project.id : '') ||
    (storyboardData.series ? `ashel_ep${String(storyboardData.episode || 1).padStart(2, '0')}` : '') ||
    'ashel_ep02';

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

      const speaker = (s.audio && (s.audio.speaker || s.audio.voice_model)) || s.speaker || s.voice_model || null;
      const prof = (speaker && profiles[speaker]) || profiles[Object.keys(profiles)[0]] || DEFAULT_PROFILES.Alistair;
      if (!speaker) console.warn(`    [!] shot ${s.id || i}: no speaker declared, using first voice_profile as fallback`);

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
