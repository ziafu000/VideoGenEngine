const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

// Built-in generic fallback profiles for Vietnamese dubbing on Eleven v3
const DEFAULT_PROFILES = {
  Hero: {
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
  Dual_Voice: {
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

// Helper: Retrieve the latest history item from ElevenLabs internal API
async function getLatestHistoryItem(cdp) {
  try {
    const res = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const key = Object.keys(localStorage).find(k => k.startsWith('firebase:authUser'));
          if (!key) return null;
          const user = JSON.parse(localStorage.getItem(key));
          const token = user?.stsTokenManager?.accessToken;
          if (!token) return null;

          const histRes = await fetch('https://api.us.elevenlabs.io/v1/history?page_size=5&source=TTS', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const histData = await histRes.json();
          const item = histData.history && histData.history[0];
          return item ? { id: item.history_item_id, text: item.text, date_unix: item.date_unix } : null;
        } catch (e) {
          return null;
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    return res?.result?.value || null;
  } catch {
    return null;
  }
}

async function generateClip(cdp, rawText, destFile, profile, previousAudioHashes = new Set(), knownPrevHistoryId = null) {
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

  // 2. Query previous latest history item to detect index update
  const initialLatest = await getLatestHistoryItem(cdp);
  const previousHistoryId = knownPrevHistoryId || (initialLatest ? initialLatest.id : null);
  if (previousHistoryId) {
    console.log(`    [-] History item trước đó: ${previousHistoryId.slice(0, 10)}...`);
  }

  // 3. Thoroughly clear and set text in ProseMirror editor (prevent voice accumulation / doubling)
  console.log(`    [-] Xóa trắng editor và nhập văn bản TTS: "${text.slice(0, 45)}..."`);
  await cdp.evaluate(`(() => {
    // 3a. Try native Clear text button if present
    const clearBtn = document.querySelector('button[aria-label="Clear text"], button[data-agent-tooltip="Clear text"]');
    if (clearBtn) clearBtn.click();

    // 3b. Select all and delete contents inside ProseMirror
    const pm = document.querySelector(".ProseMirror, [contenteditable=\\"true\\"]");
    if (pm) {
      pm.focus();
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      pm.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  await sleep(300);

  // Verify editor is cleared, then insert text
  await cdp.evaluate(`(() => {
    const pm = document.querySelector(".ProseMirror, [contenteditable=\\"true\\"]");
    if (pm) {
      pm.focus();
      // Double check if text remained, clear again
      const cur = (pm.innerText || "").trim();
      if (cur.length > 0 && !cur.includes("Type your text")) {
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
      }
      document.execCommand("insertText", false, ${JSON.stringify(text)});
      pm.dispatchEvent(new Event("input", { bubbles: true }));
    }
  })()`);
  await sleep(400);

  // 4. Validate editor text
  const editorInspection = await cdp.evaluate(`(() => {
    const pm = document.querySelector(".ProseMirror, [contenteditable=\\"true\\"]");
    return pm ? (pm.innerText || '').trim() : '';
  })()`);
  if (!editorInspection || (!editorInspection.includes(text.slice(0, 20)) && !editorInspection.includes(text.slice(-20)))) {
    console.warn(`    [!] Cảnh báo editor text chưa đồng bộ. Thực hiện chèn lại khẩn cấp...`);
    await cdp.evaluate(`(() => {
      const pm = document.querySelector(".ProseMirror, [contenteditable=\\"true\\"]");
      if (pm) {
        pm.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("insertText", false, ${JSON.stringify(text)});
        pm.dispatchEvent(new Event("input", { bubbles: true }));
      }
    })()`);
    await sleep(400);
  }

  // 5. Ensure History tab is open on the right panel & search is clean
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

  // 6. Click generate speech button via DOM click
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

  // 7. Wait for generation to start and finish
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

  // 8. Poll for the specific NEW history item (strict check against previousHistoryId and target text)
  let audioSaved = false;
  let matchedHistoryItem = null;
  const targetSnippet = text.replace(/\\s+/g, ' ').trim().toLowerCase().slice(0, 30);

  process.stdout.write('    [-] Chờ index audio mới trong ElevenLabs history: ');
  for (let poll = 0; poll < 20; poll++) {
    await sleep(1000);
    const histRes = await cdp.send('Runtime.evaluate', {
      expression: `(async () => {
        try {
          const key = Object.keys(localStorage).find(k => k.startsWith('firebase:authUser'));
          if (!key) return { error: 'no_auth' };
          const user = JSON.parse(localStorage.getItem(key));
          const token = user?.stsTokenManager?.accessToken;
          if (!token) return { error: 'no_token' };

          const res = await fetch('https://api.us.elevenlabs.io/v1/history?page_size=5&source=TTS', {
            headers: { 'Authorization': 'Bearer ' + token }
          });
          const data = await res.json();
          const items = data.history || [];
          return {
            ok: true,
            items: items.map(h => {
              const textVal = h.text || (h.dialogue && Array.isArray(h.dialogue) && h.dialogue[0]?.text) || '';
              return { id: h.history_item_id, text: textVal, date_unix: h.date_unix };
            })
          };
        } catch (e) {
          return { error: e.message };
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });

    const items = histRes?.result?.value?.items || [];
    // Strict requirement: item must have different history_item_id than previous shot AND non-empty matching text
    const match = items.find(it => {
      if (previousHistoryId && it.id === previousHistoryId) return false;
      if (!it.id) return false;
      const itText = (it.text || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!itText || itText.length < 5) return false;
      return itText.includes(targetSnippet) || (itText.length >= 10 && targetSnippet.includes(itText.slice(0, 20)));
    });

    if (match) {
      matchedHistoryItem = match;
      process.stdout.write(` ✓ [ID: ${match.id.slice(0, 8)}]\n`);
      break;
    } else {
      process.stdout.write('.');
    }
  }

  if (matchedHistoryItem && matchedHistoryItem.id) {
    try {
      const b64Data = await cdp.send('Runtime.evaluate', {
        expression: `(async () => {
          try {
            const key = Object.keys(localStorage).find(k => k.startsWith('firebase:authUser'));
            const user = JSON.parse(localStorage.getItem(key));
            const token = user?.stsTokenManager?.accessToken;

            const audioRes = await fetch('https://api.us.elevenlabs.io/v1/history/' + ${JSON.stringify(matchedHistoryItem.id)} + '/audio', {
              headers: { 'Authorization': 'Bearer ' + token }
            });
            const buffer = await audioRes.arrayBuffer();
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            return { ok: true, b64: btoa(binary), size: len };
          } catch (e) {
            return { error: e.message };
          }
        })()`,
        awaitPromise: true,
        returnByValue: true
      });

      const resVal = b64Data?.result?.value;
      if (resVal && resVal.ok && resVal.b64 && resVal.size > 2000) {
        const buffer = Buffer.from(resVal.b64, 'base64');
        fs.writeFileSync(destFile, buffer);
        audioSaved = true;
      }
    } catch (err) {
      console.warn(`    [!] Lỗi fetch audio trực tiếp: ${err.message}`);
    }
  }

  // Fallback to UI download if direct API fetch failed
  if (!audioSaved) {
    console.warn(`    [!] Fallback sang tải qua UI button...`);
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
  }

  if (!audioSaved || !fs.existsSync(destFile) || fs.statSync(destFile).size < 2000) {
    throw new Error('Không thể tải hoặc lưu file MP3 từ ElevenLabs!');
  }

  // 9. Check MD5 checksum against previous shots in the same storyboard
  const fileHash = crypto.createHash('md5').update(fs.readFileSync(destFile)).digest('hex');
  if (previousAudioHashes.has(fileHash)) {
    throw new Error(`PHÁT HIỆN LỖI LẶP VOICE: File vừa tạo (${path.basename(destFile)}) có MD5 trùng 100% với một shot trước đó (${fileHash})! Dừng lại ngay lập tức.`);
  }
  previousAudioHashes.add(fileHash);

  console.log(`    [✓] Đã lưu voice clip: ${destFile} (${fs.statSync(destFile).size} bytes | MD5: ${fileHash.slice(0, 10)})`);
  return { file: destFile, historyId: matchedHistoryItem ? matchedHistoryItem.id : null, hash: fileHash };
}

// Generate voices using local VieNeu-TTS v3 Turbo engine (48 kHz)
async function generateAllVoicesVieNeu(storyboardData, targetShotIds = null, sbPath = null) {
  const { execFileSync } = require('child_process');
  const shots = storyboardData.shots || [];
  const baseName = sbPath ? path.basename(sbPath, '.json') : '';
  const episodeName = storyboardData.series_id ||
    (storyboardData.project && storyboardData.project.id ? storyboardData.project.id : '') ||
    baseName ||
    'shorts';

  const outDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // Resolve voice profile name from storyboard or default
  const profileName = storyboardData.voice_profile || (storyboardData.voice && storyboardData.voice.profile) || 'default';

  console.log(`\n=== BẮT ĐẦU TỔNG HỢP VOICE VIENEU (48 kHz): ${episodeName.toUpperCase()} ===`);
  console.log(`Profile: ${profileName} | Thư mục đích: ${outDir}`);

  const pythonBin = config.VIENEU_PYTHON || 'python3';
  const runnerScript = path.join(__dirname, 'vieneu_engine.py');

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;

    if (targetShotIds && targetShotIds.length > 0 && !targetShotIds.includes(shotId)) {
      continue;
    }

    const voiceoverText = (s.voice && s.voice.text)
      || ((s.audio && s.audio.voiceover && !/[\u3000-\u303f\u3040-\u309f\u30a0-\u30ff\uff00-\uffef\u4e00-\u9faf]/.test(s.audio.voiceover)) ? s.audio.voiceover : null)
      || (s.audio && s.audio.sub_text)
      || s.vietnamese_subtitles
      || (s.audio && s.audio.voiceover)
      || s.subtitles;

    if (!voiceoverText || voiceoverText.trim() === '' || voiceoverText.includes('Hết Tập')) {
      console.log(`[-] [${i + 1}/${shots.length}] ${shotId}: Không có lời thoại -> Bỏ qua.`);
      continue;
    }

    const destFile = path.join(outDir, `voice_${shotId}.mp3`);
    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 2000) {
      console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: File đã tồn tại (${fs.statSync(destFile).size} bytes), bỏ qua.`);
      continue;
    }

    console.log(`\n>>> [${i + 1}/${shots.length}] Tạo voice VieNeu cho ${shotId} (Profile: ${profileName})...`);
    console.log(`    Text: "${voiceoverText.slice(0, 80)}${voiceoverText.length > 80 ? '...' : ''}"`);

    try {
      execFileSync(pythonBin, [
        runnerScript,
        '--text', voiceoverText,
        '--output', destFile,
        '--profile', profileName
      ], { stdio: 'inherit' });
      console.log(`    [✓] Hoàn thành voice clip: ${destFile}`);
    } catch (err) {
      console.error(`    [!] Lỗi khi sinh voice cho ${shotId}:`, err.message);
    }
  }

  console.log(`\n✓ Hoàn tất tạo voiceover VieNeu cho ${episodeName}!`);
  return outDir;
}

// Generate voices using F5-TTS local zero-shot cloning engine (English)
async function generateAllVoicesF5(storyboardData, targetShotIds = null, sbPath = null) {
  const baseName = sbPath ? path.basename(sbPath, '.json') : '';
  const episodeName = storyboardData.series_id ||
    (storyboardData.project && storyboardData.project.id ? storyboardData.project.id : '') ||
    storyboardData.project_name ||
    baseName ||
    (storyboardData.series ? `ep${String(storyboardData.episode || 1).padStart(2, '0')}` : '') ||
    'episode_01';

  const shots = storyboardData.shots || [];
  const outDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const voiceConfig = storyboardData.voice || {};
  const speed = voiceConfig.speed || (voiceConfig.settings && voiceConfig.settings.speed) || 1.0;
  const refAudio = voiceConfig.ref_audio || path.join(config.ASSETS_DIR, 'voices', 'f5_tts_latest_ref.wav');
  const refText = voiceConfig.ref_text || "Most of us never think twice about any of this, but the person wide awake at 3am may have been the most important person in the camp.";
  const studioEq = voiceConfig.studio_eq !== false;

  console.log(`\n=== BẮT ĐẦU TỔNG HỢP VOICE F5-TTS (LOCAL ZERO-SHOT ENGLISH): ${episodeName.toUpperCase()} ===`);
  console.log(`Speed: ${speed}x | Ref Audio: ${path.basename(refAudio)} | Thư mục đích: ${outDir}`);

  const pythonBin = config.VIENEU_PYTHON || 'python3';
  const runnerScript = path.join(__dirname, 'f5_engine.py');

  // Fast Batch F5-TTS Synthesis: generate all missing shots in a single process if no specific targets
  const pendingItems = [];
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
    if (targetShotIds && targetShotIds.length > 0 && !targetShotIds.includes(shotId)) continue;
    const voiceoverText = (s.voice && s.voice.text)
      || (s.audio && s.audio.voiceover)
      || (s.audio && s.audio.sub_text)
      || s.subtitles;
    if (!voiceoverText || voiceoverText.trim() === '' || voiceoverText.includes('Hết Tập')) continue;
    const destFile = path.join(outDir, `voice_${shotId}.mp3`);
    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 2000) continue;
    pendingItems.push({ text: voiceoverText, output: destFile, shotId });
  }

  if (pendingItems.length > 1) {
    console.log(`\n>>> [Batch F5-TTS] Đang tổng hợp liên tục ${pendingItems.length} clips trong 1 phiên CUDA duy nhất...`);
    const batchJsonPath = path.join(outDir, 'batch_f5_pending.json');
    fs.writeFileSync(batchJsonPath, JSON.stringify(pendingItems.map(p => ({ text: p.text, output: p.output })), null, 2), 'utf8');
    const cmdArgs = [
      runnerScript,
      '--batch-json', batchJsonPath,
      '--ref-audio', refAudio,
      '--ref-text', refText,
      '--speed', String(speed)
    ];
    if (!studioEq) cmdArgs.push('--no-studio-eq');
    try {
      execFileSync(pythonBin, cmdArgs, { stdio: 'inherit' });
      if (fs.existsSync(batchJsonPath)) fs.unlinkSync(batchJsonPath);
      console.log(`\n✓ Hoàn tất tạo toàn bộ voiceover F5-TTS theo lô cho ${episodeName}!`);
      return outDir;
    } catch (err) {
      console.error(`    [!] Batch F5-TTS gặp lỗi, chuyển sang fallback từng shot:`, err.message);
    }
  }

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;

    if (targetShotIds && targetShotIds.length > 0 && !targetShotIds.includes(shotId)) {
      continue;
    }

    const voiceoverText = (s.voice && s.voice.text)
      || (s.audio && s.audio.voiceover)
      || (s.audio && s.audio.sub_text)
      || s.subtitles;

    if (!voiceoverText || voiceoverText.trim() === '' || voiceoverText.includes('Hết Tập')) {
      console.log(`[-] [${i + 1}/${shots.length}] ${shotId}: Không có lời thoại -> Bỏ qua.`);
      continue;
    }

    const destFile = path.join(outDir, `voice_${shotId}.mp3`);
    if (fs.existsSync(destFile) && fs.statSync(destFile).size > 2000) {
      console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: File đã tồn tại (${fs.statSync(destFile).size} bytes), bỏ qua.`);
      continue;
    }

    console.log(`\n>>> [${i + 1}/${shots.length}] Tạo voice F5-TTS cho ${shotId}...`);
    console.log(`    Text: "${voiceoverText.slice(0, 80)}${voiceoverText.length > 80 ? '...' : ''}"`);

    const cmdArgs = [
      runnerScript,
      '--text', voiceoverText,
      '--output', destFile,
      '--ref-audio', refAudio,
      '--ref-text', refText,
      '--speed', String(speed)
    ];
    if (!studioEq) {
      cmdArgs.push('--no-studio-eq');
    }

    try {
      execFileSync(pythonBin, cmdArgs, { stdio: 'inherit' });
      console.log(`    [✓] Hoàn thành voice clip: ${destFile}`);
    } catch (err) {
      console.error(`    [!] Lỗi khi sinh voice cho ${shotId}:`, err.message);
    }
  }

  console.log(`\n✓ Hoàn tất tạo voiceover F5-TTS cho ${episodeName}!`);
  return outDir;
}

// Generate all voices defined in a storyboard
async function generateAllVoices(storyboardData, targetShotIds = null, sbPath = null) {
  const provider = (storyboardData && storyboardData.voice && storyboardData.voice.provider)
    || (storyboardData && storyboardData.tts_provider)
    || process.env.TTS_PROVIDER
    || 'vieneu'; // Default to VieNeu-TTS

  const p = provider.toLowerCase();
  if (p === 'f5' || p === 'f5-tts' || p === 'f5tts' || p === 'kokoro') {
    if (p === 'kokoro') {
      console.log(`[Notice] Kokoro engine has been completely retired. Upgrading automatically to F5-TTS zero-shot studio clone.`);
    }
    return await generateAllVoicesF5(storyboardData, targetShotIds, sbPath);
  }

  if (p === 'vieneu') {
    return await generateAllVoicesVieNeu(storyboardData, targetShotIds, sbPath);
  }

  const profiles = { ...DEFAULT_PROFILES, ...(storyboardData.voice_profiles || {}) };
  const shots = storyboardData.shots || [];
  const cdp = await getElevenLabsClient();

  const baseName = sbPath ? path.basename(sbPath, '.json') : '';
  const episodeName = storyboardData.series_id ||
    (storyboardData.project && storyboardData.project.id ? storyboardData.project.id : '') ||
    baseName ||
    (storyboardData.series ? `ep${String(storyboardData.episode || 1).padStart(2, '0')}` : '') ||
    'episode_01';

  const outDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  console.log(`\n=== BẮT ĐẦU TỔNG HỢP VOICE TIẾNG VIỆT (ELEVEN V3): ${episodeName.toUpperCase()} ===`);
  console.log(`Thư mục đích: ${outDir}`);

  const seenHashes = new Set();
  let lastHistoryId = null;

  // Track hashes of already existing files
  for (let i = 0; i < shots.length; i++) {
    const sId = shots[i].id || `shot_${String(i + 1).padStart(2, '0')}`;
    const existingFile = path.join(outDir, `voice_${sId}.mp3`);
    if (fs.existsSync(existingFile) && fs.statSync(existingFile).size > 2000) {
      const h = crypto.createHash('md5').update(fs.readFileSync(existingFile)).digest('hex');
      seenHashes.add(h);
    }
  }

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
      const rawProf = profiles[speaker] || DEFAULT_PROFILES[speaker] || DEFAULT_PROFILES.narrator || DEFAULT_PROFILES.Hero;
      const prof = {
        ...rawProf,
        voiceName: rawProf.voiceName || rawProf.voice_name || 'Brian - Relatable Everyman',
        searchKey: rawProf.searchKey || rawProf.search_key || 'Brian'
      };

      console.log(`\n>>> [${i + 1}/${shots.length}] Tạo voice cho ${shotId} (Nhân vật: ${speaker} | Giọng: ${prof.voiceName})...`);
      const clipRes = await generateClip(cdp, voiceoverText, destFile, prof, seenHashes, lastHistoryId);
      if (clipRes && clipRes.historyId) {
        lastHistoryId = clipRes.historyId;
      }
      if (clipRes && clipRes.hash) {
        seenHashes.add(clipRes.hash);
      }
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
  generateAllVoicesVieNeu,
  generateAllVoicesF5,
  DEFAULT_PROFILES
};
