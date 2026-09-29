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
  },
  narrator: {
    voiceName: 'Brian',
    searchKey: 'Brian',
    model: 'eleven_v3',
    speed: 1.05,
    stability: 0.42,
    similarity: 0.80,
    style: 0.18
  },
  narrator_fresh: {
    voiceName: 'Brian',
    searchKey: 'Brian',
    model: 'eleven_v3',
    speed: 1.05,
    stability: 0.42,
    similarity: 0.80,
    style: 0.18
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
    const tab = Array.from(document.querySelectorAll("button, [role=\\"tab\\"]")).find(e => e.innerText && e.innerText.trim() === "Settings");
    if (tab) tab.click();
  })()`);
  await sleep(400);

  // 2. Check current voice
  const cur = await cdp.evaluate(`(() => {
    const h = Array.from(document.querySelectorAll("h5, h4, h6")).find(e => e.innerText && e.innerText.trim() === "Voice");
    if (h && h.parentElement) {
      const btn = h.parentElement.querySelector("button");
      if (btn) return btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, "").trim();
    }
    const btn = document.querySelector('button[aria-label*="Select voice"]');
    return btn ? btn.innerText.replace(/@keyframes[^{]+{[^}]+}/g, '').trim().replace(/\\s+/g, ' ') : '';
  })()`);

  if (cur && cur.includes(voiceName)) {
    return;
  }

  console.log(`    [-] Chuyển giọng ElevenLabs sang: ${voiceName}...`);

  // 3. Open Voice selector dialog if not open
  await cdp.evaluate(`(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const isOpen = dialogs.some(d => d.innerText && (d.innerText.includes("Explore") || d.innerText.includes("My Voices")));
    if (!isOpen) {
      const h = Array.from(document.querySelectorAll("h5, h4, h6")).find(e => e.innerText && e.innerText.trim() === "Voice");
      if (h && h.parentElement) {
        const btn = h.parentElement.querySelector("button");
        if (btn) { btn.click(); return; }
      }
      const btn = document.querySelector('button[aria-label*="Select voice"]');
      if (btn) btn.click();
    }
  })()`);
  await sleep(1000);

  // 4. Click Explore tab in voice modal
  await cdp.evaluate(`(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const voiceDialog = dialogs.find(d => d.innerText && (d.innerText.includes("Explore") || d.innerText.includes("My Voices")));
    if (!voiceDialog) return;
    const el = Array.from(voiceDialog.querySelectorAll('button, [role="tab"]')).find(e => e.innerText && e.innerText.trim() === "Explore");
    if (el) el.click();
  })()`);
  await sleep(600);

  // 5. Search for the voice
  const searchKey = profile.searchKey || voiceName;

  await cdp.evaluate(`(() => {
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
    const voiceDialog = dialogs.find(d => d.innerText && (d.innerText.includes("Explore") || d.innerText.includes("My Voices")));
    if (!voiceDialog) return;
    const input = voiceDialog.querySelector('input[placeholder="Start typing to search..."]');
    if (!input) return;
    input.focus();
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    nativeInputValueSetter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    nativeInputValueSetter.call(input, ${JSON.stringify(searchKey)});
    input.dispatchEvent(new Event("input", { bubbles: true }));
  })()`);

  // 6. Wait for search results and click matching voice row
  let clicked = false;
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(500);
    const res = await cdp.evaluate(`(() => {
      const key = ${JSON.stringify(voiceName)};
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"]'));
      const voiceDialog = dialogs.find(d => d.innerText && (d.innerText.includes("Explore") || d.innerText.includes("My Voices")));
      if (!voiceDialog) return { ok: false };

      const lis = Array.from(voiceDialog.querySelectorAll('li'));
      if (lis.length === 0) return { ok: false };

      const match = (key.toLowerCase() === "marcus")
        ? (lis.find(li => li.innerText && li.innerText.toLowerCase().includes("robotic")) || lis.find(li => li.innerText && li.innerText.includes(key)))
        : (lis.find(li => li.innerText && li.innerText.includes(key)) || lis[0]);

      if (!match) return { ok: false };
      const btn = match.querySelector("button[class*='inset-0']") || match.querySelector("button");
      if (btn) {
        btn.click();
        return { ok: true };
      }
      return { ok: false };
    })()`);

    if (res && res.ok) {
      clicked = true;
      break;
    }
  }

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

  // 6 & 7. Trigger download and capture new MP3 file
  let audioSaved = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(attempt === 0 ? 3000 : 2000);

    await cdp.evaluate(`(() => {
      const btn = document.querySelector('button[aria-label="Download Audio"]')
        || document.querySelector('[data-testid="audio-player-download-button"]')
        || document.querySelector('button[aria-label="Download"]');
      if (btn) btn.click();
    })()`);

    await sleep(1500);
    const newest = getNewestDownload(config.WIN_DOWNLOADS_DIR);
    if (newest) {
      const isNew = !beforeDownload || (newest.name !== beforeDownload.name) || (newest.time > beforeDownload.time);
      if (isNew) {
        const downloadedFile = path.join(config.WIN_DOWNLOADS_DIR, newest.name);
        try {
          if (fs.existsSync(downloadedFile) && fs.statSync(downloadedFile).size > 2000) {
            fs.copyFileSync(downloadedFile, destFile);
            audioSaved = true;
            break;
          }
        } catch (err) {
          // Retry next loop
        }
      }
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

      // Check text: Ưu tiên voice.text (chuẩn Shorts mới), rồi sub_text tiếng Việt hoặc vietnamese_subtitles
      const voiceoverText = (s.voice && s.voice.text)
        || ((s.audio && s.audio.voiceover && !/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(s.audio.voiceover)) ? s.audio.voiceover : null)
        || (s.audio && s.audio.sub_text)
        || s.vietnamese_subtitles
        || (s.audio && s.audio.voiceover)
        || s.subtitles;

      if (!voiceoverText || voiceoverText.trim() === '' || voiceoverText.includes('Hết Tập')) {
        console.log(`[-] [${i + 1}/${shots.length}] ${shotId}: Không có lời thoại (SFX/Ambient/Outro) -> Bỏ qua.`);
        continue;
      }

      const destFile = path.join(outDir, `voice_${shotId}.mp3`);
      if (fs.existsSync(destFile) && fs.statSync(destFile).size > 2000) {
        console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: File đã tồn tại (${fs.statSync(destFile).size} bytes), bỏ qua.`);
        continue;
      }

      const speaker = (s.voice && (s.voice.speaker || s.voice.voice_model))
        || (s.audio && (s.audio.speaker || s.audio.voice_model))
        || s.speaker
        || s.voice_model
        || 'narrator';
      const rawProf = profiles[speaker] || DEFAULT_PROFILES[speaker] || DEFAULT_PROFILES.narrator || DEFAULT_PROFILES.Ashel;
      const prof = {
        ...rawProf,
        voiceName: rawProf.voiceName || rawProf.voice_name || 'Brian - Relatable Everyman',
        searchKey: rawProf.searchKey || rawProf.search_key || 'Brian'
      };

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
