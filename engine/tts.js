const fs = require('fs');
const path = require('path');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

// Built-in generic fallback profiles for Vietnamese dubbing on Eleven v3
const DEFAULT_PROFILES = {
  Ashel: {
    voiceName: 'Adam',
    searchKey: 'Adam',
    speed: 1.0,
    stability: 0.50,
    similarity: 0.75,
    style: 0.00
  },
  Selena: {
    voiceName: 'Rachel',
    searchKey: 'Rachel',
    speed: 1.0,
    stability: 0.50,
    similarity: 0.75,
    style: 0.00
  },
  'Protocol: Root': {
    voiceName: 'Marcus',
    searchKey: 'Marcus',
    speed: 0.95,
    stability: 0.60,
    similarity: 0.85,
    style: 0.00
  },
  Protocol: {
    voiceName: 'Marcus',
    searchKey: 'Marcus',
    speed: 0.95,
    stability: 0.60,
    similarity: 0.85,
    style: 0.00
  },
  Protocol_and_Ashel: {
    voiceName: 'Adam',
    searchKey: 'Adam',
    speed: 1.0,
    stability: 0.50,
    similarity: 0.75,
    style: 0.00
  }
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
      .filter(f => f.endsWith('.mp3') && !f.endsWith('.crdownload'))
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
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      }
    }
  } catch {}
}

async function setVoice(cdp, profile) {
  const voiceName = profile.voiceName || profile.searchKey || 'Adam';

  // 1. Ensure Settings tab is selected on the right panel
  await cdp.evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll("button, [role=\\"tab\\"]")).find(e => e.innerText === "Settings");
    if (tab) tab.click();
  })()`);
  await sleep(400);

  // 2. Check current voice
  const cur = await cdp.evaluate(`(() => {
    const headings = Array.from(document.querySelectorAll("*")).filter(e => e.innerText === "Voice" && e.children.length === 0);
    for (const h of headings) {
      const parent = h.parentElement;
      const btn = parent ? parent.querySelector("button") : null;
      if (btn) return btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, "").trim();
    }
    const btn = document.querySelector('button[aria-label*="Select voice"]');
    return btn ? btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, '').trim().replace(/\\s+/g, ' ') : '';
  })()`);

  if (cur && cur.includes(voiceName)) {
    return;
  }

  console.log(`    [-] Chuyển giọng ElevenLabs sang: ${voiceName}...`);

  // 3. Open Voice selector dialog
  await cdp.evaluate(`(() => {
    let pop = document.querySelector('[data-state="open"][role="dialog"]');
    if (!pop) {
      const headings = Array.from(document.querySelectorAll("*")).filter(e => e.innerText === "Voice" && e.children.length === 0);
      for (const h of headings) {
        const parent = h.parentElement;
        const btn = parent ? parent.querySelector("button") : null;
        if (btn) { btn.click(); return; }
      }
      const btn = document.querySelector('button[aria-label*="Select voice"]');
      if (btn) btn.click();
    }
  })()`);
  await sleep(1000);

  // 4. Click Explore tab in voice modal
  await cdp.evaluate(`(() => {
    const el = Array.from(document.querySelectorAll("button, [role=\\"tab\\"]")).find(e => e.innerText === "Explore");
    if (el) el.click();
  })()`);
  await sleep(600);

  // 5. Search for the voice
  const searchKey = profile.searchKey || voiceName;

  // Clear existing search text via clear button or DOM
  await cdp.evaluate(`(() => {
    const input = document.querySelector('input[placeholder="Start typing to search..."]');
    if (input) {
      const parent = input.parentElement;
      const btn = parent ? parent.querySelector("button") : null;
      if (btn) btn.click();
    }
  })()`);
  await sleep(300);

  const inputRect = (await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const i = document.querySelector('input[placeholder="Start typing to search..."]');
      if (!i) return null;
      const r = i.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`,
    returnByValue: true
  })).result.value;

  if (inputRect) {
    await cdp.clickMouse(inputRect.x, inputRect.y);
    await sleep(200);
    await cdp.send('Input.insertText', { text: searchKey });
    await sleep(1500);
  }

  // 6. Find matching voice row and click its trigger button
  const clicked = (await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const key = ${JSON.stringify(voiceName)};
      const lis = Array.from(document.querySelectorAll("li")).filter(li => li.innerText && li.innerText.includes(key));
      if (lis.length === 0) return false;
      const match = (key.toLowerCase() === "marcus")
        ? (lis.find(li => li.innerText.toLowerCase().includes("robotic")) || lis[0])
        : lis[0];
      const btn = match.querySelector("button[class*='inset-0']");
      if (btn) { btn.click(); return true; }
      return false;
    })()`,
    returnByValue: true
  })).result.value;

  if (!clicked) {
    console.warn(`    [!] Không tìm thấy element cho giọng ${voiceName}`);
  }
  await sleep(1000);
}

function cleanDialogueText(text) {
  if (!text) return '';
  return text
    .replace(/\{\\[^}]+\}/g, '') // Remove ASS formatting tags e.g. {\b1}, {\b0}
    .replace(/\\N/g, ' ')        // Replace line breaks with spaces
    .replace(/\[\s*GIAO THỨC CỘI NGUỒN\s*\]/gi, '[ GIAO THỨC CỘI NGUỒN ]')
    .replace(/\s+/g, ' ')
    .trim();
}

async function generateClip(cdp, rawText, destFile, profile) {
  const text = cleanDialogueText(rawText);
  if (!text || text.length === 0) {
    console.log(`    [-] Văn bản rỗng, bỏ qua.`);
    return null;
  }

  const dir = path.dirname(destFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const beforeDownload = getNewestDownload(config.WIN_DOWNLOADS_DIR);

  // 0. Check & dismiss any unexpected popups
  await handleObstacles(cdp);

  // 1. Select Voice
  await setVoice(cdp, profile);

  // 2. Set text in ProseMirror editor
  console.log(`    [-] Nhập văn bản TTS: "${text.slice(0, 45)}..."`);
  await cdp.evaluate(`(() => {
    const pm = document.querySelector(".ProseMirror, [contenteditable=\\"true\\"]");
    if (pm) {
      pm.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, ${JSON.stringify(text)});
      pm.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  await sleep(600);

  // 3. Ensure History tab is open on the right panel & search is clean
  await cdp.evaluate(`(() => {
    const tab = Array.from(document.querySelectorAll("button, [role=\\"tab\\"]")).find(e => e.innerText === "History");
    if (tab) tab.click();
    const hi = document.querySelector("input[placeholder*='history' i]");
    if (hi && hi.value) {
      hi.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      hi.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  await sleep(400);

  // 4. Click generate speech button via DOM click
  console.log(`    [-] Bấm Generate speech (Eleven v3)...`);
  const clicked = await cdp.evaluate(`(() => {
    const btn = document.querySelector('[data-testid="tts-generate"]') ||
      Array.from(document.querySelectorAll("button")).find(b => b.innerText.includes("Generate speech") || b.innerText.includes("Regenerate speech"));
    if (btn && !btn.disabled) {
      btn.click();
      return true;
    }
    return false;
  })()`);

  if (!clicked) {
    throw new Error('Nút Generate speech bị vô hiệu hóa hoặc không tìm thấy!');
  }

  // 5. Wait for generation to start and finish
  let ready = false;
  let sawLoading = false;
  process.stdout.write('    [-] Đang tổng hợp âm thanh: ');

  for (let i = 0; i < 40; i++) {
    await sleep(600);
    const state = await cdp.evaluate(`(() => {
      const b = document.querySelector('[data-testid="tts-generate"]') ||
        Array.from(document.querySelectorAll("button")).find(el => el.innerText.includes("Generate speech") || el.innerText.includes("Regenerate speech"));
      const errBanner = document.querySelector('[role="alert"], [class*="destructive"], [class*="error-message"]');
      const isLoading = b && (b.getAttribute("data-loading") === "true" || b.disabled);
      return {
        isLoading: !!isLoading,
        errorText: errBanner ? errBanner.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null
      };
    })()`);

    if (state && state.errorText) {
      process.stdout.write(' ✗\n');
      throw new Error(`ElevenLabs báo lỗi TTS: ${state.errorText}`);
    }

    if (state && state.isLoading) {
      sawLoading = true;
      process.stdout.write('L');
    } else if (sawLoading || (i > 4 && !state.isLoading)) {
      ready = true;
      break;
    } else {
      process.stdout.write('.');
    }
  }
  process.stdout.write(ready ? ' ✓\n' : ' ✗\n');

  if (!ready) {
    throw new Error('Timeout khi chờ ElevenLabs tạo âm thanh!');
  }

  await sleep(1500);

  // 6. Download from History panel
  // Hover over top history item to reveal download button
  const hoverCoords = await cdp.evaluate(`(() => {
    const list = Array.from(document.querySelectorAll("span")).filter(e => e.parentElement && e.parentElement.className.includes("line-clamp-1"));
    if (list.length === 0) return null;
    const r = list[0].getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  })()`);

  if (hoverCoords) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverCoords.x, y: hoverCoords.y });
    await sleep(400);
  }

  // Click Download icon on that row
  const dlIconCoords = await cdp.evaluate(`(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(b => {
      const r = b.getBoundingClientRect();
      return b.getAttribute("aria-label") === "Download" && r.left > 1300;
    });
    if (!btn) return null;
    const r = btn.getBoundingClientRect();
    return { x: r.left + r.width/2, y: r.top + r.height/2 };
  })()`);

  if (dlIconCoords) {
    await cdp.clickMouse(dlIconCoords.x, dlIconCoords.y);
    await sleep(500);

    // Click MP3 / 44.1kHz in the download dropdown
    const mp3Coords = await cdp.evaluate(`(() => {
      const item = Array.from(document.querySelectorAll("*")).find(e => e.innerText && e.innerText.includes("44.1kHz") && e.children.length === 0);
      const btn = item ? item.closest("[role='menuitem'], button, div") : null;
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2 };
    })()`);

    if (mp3Coords) {
      await cdp.clickMouse(mp3Coords.x, mp3Coords.y);
    }
  } else {
    // Fallback to bottom player download button
    await cdp.evaluate(`(() => {
      const dl = document.querySelector('[data-testid="audio-player-download-button"]') || document.querySelector('button[aria-label="Download"]');
      if (dl) dl.click();
    })()`);
  }

  // 7. Capture downloaded file
  let audioSaved = false;
  for (let i = 0; i < 15; i++) {
    await sleep(800);
    const newest = getNewestDownload(config.WIN_DOWNLOADS_DIR);
    if (newest && (!beforeDownload || newest.name !== beforeDownload.name || newest.time > beforeDownload.time)) {
      const downloadedFile = path.join(config.WIN_DOWNLOADS_DIR, newest.name);
      try {
        if (fs.existsSync(downloadedFile) && fs.statSync(downloadedFile).size > 2000) {
          fs.copyFileSync(downloadedFile, destFile);
          audioSaved = true;
          break;
        }
      } catch {}
    }
  }

  if (!audioSaved || !fs.existsSync(destFile) || fs.statSync(destFile).size < 2000) {
    throw new Error('Không thể tải hoặc lưu file MP3 từ ElevenLabs!');
  }

  console.log(`    [✓] Đã lưu voice clip: ${destFile} (${fs.statSync(destFile).size} bytes)`);
  return destFile;
}

// Generate all voices defined in a storyboard
async function generateAllVoices(storyboardData, targetShotIds = null, sbPath = null) {
  const profiles = { ...DEFAULT_PROFILES, ...(storyboardData.voice_profiles || {}) };
  const shots = storyboardData.shots || [];
  const cdp = await getElevenLabsClient();

  const baseName = sbPath ? path.basename(sbPath, '.json') : '';
  const episodeName = storyboardData.series_id ||
    (storyboardData.project && storyboardData.project.id ? storyboardData.project.id : '') ||
    baseName ||
    (storyboardData.series ? `ashel_ep${String(storyboardData.episode || 1).padStart(2, '0')}` : '') ||
    'ashel_ep02';

  const outDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n=== BẮT ĐẦU TỔNG HỢP VOICE TIẾNG VIỆT (ELEVEN V3): ${episodeName.toUpperCase()} ===`);
  console.log(`Thư mục đích: ${outDir}`);

  try {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;

      if (targetShotIds && targetShotIds.length > 0 && !targetShotIds.includes(shotId)) {
        continue;
      }

      // Check text: Ưu tiên sub_text tiếng Việt hoặc vietnamese_subtitles
      const voiceoverText = (s.audio && s.audio.voiceover && !/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(s.audio.voiceover))
        ? s.audio.voiceover
        : (s.audio && s.audio.sub_text) || s.vietnamese_subtitles || s.audio.voiceover;

      if (!voiceoverText || voiceoverText.trim() === '' || voiceoverText.includes('Hết Tập')) {
        console.log(`[-] [${i + 1}/${shots.length}] ${shotId}: Không có lời thoại (SFX/Ambient/Outro) -> Bỏ qua.`);
        continue;
      }

      const destFile = path.join(outDir, `voice_${shotId}.mp3`);
      if (fs.existsSync(destFile) && fs.statSync(destFile).size > 2000) {
        console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: File đã tồn tại (${fs.statSync(destFile).size} bytes), bỏ qua.`);
        continue;
      }

      const speaker = (s.audio && (s.audio.speaker || s.audio.voice_model)) || s.speaker || s.voice_model || 'Ashel';
      const prof = profiles[speaker] || DEFAULT_PROFILES[speaker] || DEFAULT_PROFILES.Ashel;

      console.log(`\n>>> [${i + 1}/${shots.length}] Tạo voice cho ${shotId} (Nhân vật: ${speaker} | Giọng: ${prof.voiceName})...`);
      await generateClip(cdp, voiceoverText, destFile, prof);
      await sleep(1000);
    }
  } finally {
    cdp.close();
  }

  console.log(`\n✓ Hoàn tất tạo voiceover Tiếng Việt cho ${episodeName}!`);
  return outDir;
}

module.exports = {
  getElevenLabsClient,
  generateClip,
  generateAllVoices,
  DEFAULT_PROFILES
};
