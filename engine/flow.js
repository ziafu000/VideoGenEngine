const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');
const jev = require('./jev');

async function getFlowClient(existingCdp = null) {
  if (existingCdp && typeof existingCdp.isOpen === 'function' && existingCdp.isOpen()) {
    existingCdp.retain();
    return existingCdp;
  }
  const client = await getClientForPage('flow.google.com');
  await client.send('Page.bringToFront').catch(() => {});
  return client;
}

/**
 * Prune stale offscreen DOM tiles, unload background media elements, and release V8 RemoteObject handles
 * to prevent DOM/Base64 memory bloat during multi-hundred-shot batch runs.
 */
async function pruneFlowDomMemory(cdp, maxTiles = 12) {
  if (!cdp || (typeof cdp.isOpen === 'function' && !cdp.isOpen())) return;
  try {
    await cdp.evaluate(`((limit) => {
      const videoTiles = Array.from(document.querySelectorAll('flow-video-tile'));
      for (let i = limit; i < videoTiles.length; i++) {
        const tile = videoTiles[i];
        const vids = tile.querySelectorAll('video');
        vids.forEach(v => {
          try {
            v.pause();
            v.removeAttribute('src');
            v.load();
          } catch {}
        });
        const imgs = tile.querySelectorAll('img');
        imgs.forEach(img => {
          try { img.removeAttribute('src'); } catch {}
        });
      }
      const imageTiles = Array.from(document.querySelectorAll('flow-image-tile, flow-media-tile'));
      for (let i = limit; i < imageTiles.length; i++) {
        const tile = imageTiles[i];
        const imgs = tile.querySelectorAll('img');
        imgs.forEach(img => {
          try { img.removeAttribute('src'); } catch {}
        });
      }
      return true;
    })(${Number(maxTiles) || 12})`);
  } catch {}
  if (typeof cdp.releaseMemory === 'function') {
    await cdp.releaseMemory();
  }
}

// 1. Get status of Google Flow UI
async function getStatus(options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    return await cdp.evaluate(`(() => {
      const pm = document.querySelector('.ProseMirror');
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      const videoTiles = document.querySelectorAll('flow-video-tile');
      const pendingTile = document.querySelector('flow-pending-tile');
      const loading = document.querySelectorAll('mat-progress-spinner, mat-progress-bar, .loading, .spinner');
      const activeChips = Array.from(document.querySelectorAll('flow-character-ingredient-chip')).filter(c => !c.innerText.includes('add'));
      const settingsBtn = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');

      return {
        promptValue: pm ? pm.innerText.trim() : null,
        attachedCharacters: activeChips.map(c => c.innerText.trim()),
        generateBtnReady: genBtn ? !genBtn.disabled : false,
        totalVideoTiles: videoTiles.length,
        isGenerating: !!pendingTile || loading.length > 0,
        currentSettings: settingsBtn ? settingsBtn.innerText.replace(/[\\r\\n]+/g, ' ').trim() : ''
      };
    })()`);
  } finally {
    cdp.close();
  }
}

// 2. Clear attached characters / ingredients, prompt text, and dismiss any stale error cards/toasts
async function clearCharacters(options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    return await cdp.evaluate(`(async () => {
      // Dismiss any failed generation cards only (never delete valid tiles or assets)
      const errTiles = Array.from(document.querySelectorAll('flow-error-tile'));
      errTiles.forEach(t => {
        const delBtns = Array.from(t.querySelectorAll('button')).filter(b => {
          const txt = (b.innerText || b.textContent || '').trim();
          const aria = (b.getAttribute('aria-label') || '').trim();
          return txt.includes('delete_forever') || txt.includes('Xóa') || txt.includes('Xoá') || aria === 'Xóa' || aria === 'Xoá';
        });
        delBtns.forEach(b => b.click());
      });
      if (errTiles.length > 0) {
        await new Promise(r => setTimeout(r, 600));
      }

      // Dismiss any lingering snackbars / toasts
      const snackDismiss = Array.from(document.querySelectorAll('snack-bar-container button, .mat-mdc-snack-bar-container button')).find(b => b.innerText && (b.innerText.includes('Đóng') || b.innerText.includes('Close')));
      if (snackDismiss) snackDismiss.click();

      // Clear any attached ingredient chips (loop up to 4 passes for Angular re-render)
      for (let pass = 0; pass < 4; pass++) {
        const cancelButtons = Array.from(document.querySelectorAll(
          'flow-ingredient-bar button, .ingredient-bar button, flow-ingredient-chip button, flow-ingredient-chip mat-icon, flow-character-ingredient-chip button, flow-character-ingredient-chip mat-icon, [class*="ingredient-chip"] button, .prompt-ingredients button'
        )).filter(b => {
          const txt = (b.innerText || b.textContent || '').trim().toLowerCase();
          const aria = (b.getAttribute('aria-label') || '').trim().toLowerCase();
          if (aria.includes('thêm thành phần') || aria.includes('add ingredient')) return false;
          return txt.includes('cancel') || txt.includes('close') || aria.includes('xóa') || aria.includes('xoá') || aria.includes('remove') || aria.includes('delete');
        });
        if (cancelButtons.length === 0) break;
        cancelButtons.forEach(b => b.click());
        await new Promise(r => setTimeout(r, 250));
      }

      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && (b.innerText.includes('Xoá câu lệnh') || b.innerText.includes('Xóa câu lệnh') || b.innerText.includes('Clear prompt')));
      if (clearBtn) clearBtn.click();

      const pm = document.querySelector('.ProseMirror');
      if (pm) {
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      }
      return true;
    })()`);
  } finally {
    cdp.close();
  }
}

// Pure helper: normalize ingredient / character label for exact matching
function normalizeIngredientLabel(label) {
  return String(label || '').replace(/^@/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Pure helper: exact accessible-name matcher for Google Flow ingredient options.
 * Matches "<name> Nhân vật", "<name> Character", or exact "<name>" ONLY — NEVER substring matching,
 * so "Name" will never falsely match "Name 1980s Nhân vật".
 */
function matchExactIngredientOption(options, targetName) {
  const cleanTarget = normalizeIngredientLabel(targetName);
  if (!cleanTarget || !Array.isArray(options) || options.length === 0) return null;

  const exactCandidates = new Set([
    `${cleanTarget} nhân vật`,
    `${cleanTarget} character`,
    cleanTarget
  ]);

  const roleOptions = options.filter(o => o && typeof o === 'object' && o.role === 'option');
  const pool = roleOptions.length > 0 ? roleOptions : options;

  // Pass 1: prefer "<name> Nhân vật" / "<name> Character"
  for (const item of pool) {
    const rawText = typeof item === 'string' ? item : (item.text || '');
    const rawAria = typeof item === 'object' && item ? (item.ariaLabel || item.aria || '') : '';
    const normText = normalizeIngredientLabel(rawText);
    const normAria = normalizeIngredientLabel(rawAria);
    if (normText === `${cleanTarget} nhân vật` || normText === `${cleanTarget} character` ||
        normAria === `${cleanTarget} nhân vật` || normAria === `${cleanTarget} character`) {
      return item;
    }
  }

  // Pass 2: exact bare name match (still zero substring matching)
  for (const item of pool) {
    const rawText = typeof item === 'string' ? item : (item.text || '');
    const rawAria = typeof item === 'object' && item ? (item.ariaLabel || item.aria || '') : '';
    const normText = normalizeIngredientLabel(rawText);
    const normAria = normalizeIngredientLabel(rawAria);
    if (exactCandidates.has(normText) || exactCandidates.has(normAria)) {
      return item;
    }
  }

  return null;
}

// 3a. Attach an ingredient via Flow's Ingredients picker ("Thêm thành phần vào ô nhập câu lệnh") with exact matching
async function addIngredient(charName, options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    const res = await cdp.evaluate(`(async (rawTargetName) => {
      const norm = (s) => String(s || '').replace(/^@/, '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const cleanTarget = norm(rawTargetName);
      const exactWithType = new Set([cleanTarget + ' nhân vật', cleanTarget + ' character']);
      const exactBare = cleanTarget;

      const findExactOption = () => {
        const panes = Array.from(document.querySelectorAll('.cdk-overlay-pane'));
        const allOptions = panes.flatMap(p => Array.from(p.querySelectorAll('[role="option"], button[role="option"]')));
        const pool = allOptions.length > 0
          ? allOptions
          : panes.flatMap(p => Array.from(p.querySelectorAll('.asset-item, .character-tile-container, button')));
        const getLabels = (el) => [
          norm(el.innerText || el.textContent || ''),
          norm(el.getAttribute('aria-label') || '')
        ];
        let hit = pool.find(el => getLabels(el).some(l => exactWithType.has(l)));
        if (!hit) {
          hit = pool.find(el => getLabels(el).some(l => l === exactBare));
        }
        return { hit, count: pool.length };
      };

      const addBtn = document.querySelector(
        'button[aria-label="Thêm thành phần vào ô nhập câu lệnh"], button[aria-label="Add ingredient to prompt"], button[aria-label="Add ingredients to prompt"], button.add-menu-trigger'
      );
      if (!addBtn) {
        return { fallbackToMention: true };
      }

      addBtn.click();
      await new Promise(r => setTimeout(r, 700));

      let { hit } = findExactOption();
      if (!hit) {
        // Click Nhân vật tab inside picker if present
        const tabCandidates = Array.from(document.querySelectorAll('.cdk-overlay-pane [role="tab"], .cdk-overlay-pane button, .cdk-overlay-pane mat-list-item'));
        const charTab = tabCandidates.find(el => {
          const t = norm(el.innerText || '');
          return t === 'nhân vật' || t === 'characters' || t === 'character';
        });
        if (charTab) {
          charTab.click();
          await new Promise(r => setTimeout(r, 600));
          ({ hit } = findExactOption());
        }
      }

      if (!hit) {
        const searchInput = document.querySelector('.cdk-overlay-pane input[placeholder*="Tìm kiếm"], .cdk-overlay-pane input[placeholder*="Search"], .cdk-overlay-pane input');
        if (searchInput) {
          searchInput.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(searchInput, rawTargetName.replace(/^@/, ''));
          else searchInput.value = rawTargetName.replace(/^@/, '');
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 500));
          ({ hit } = findExactOption());
        }
      }

      if (!hit) {
        return { error: 'Không tìm thấy chính xác thành phần "' + rawTargetName + '" trong menu Thành phần' };
      }

      hit.scrollIntoView({ block: 'center' });
      hit.click();
      await new Promise(r => setTimeout(r, 550));

      const insertBtn = Array.from(document.querySelectorAll('.cdk-overlay-pane button, button')).find(b => {
        const t = (b.innerText || '').trim();
        return t.includes('Thêm vào câu lệnh') || t.includes('Add to prompt');
      });
      if (insertBtn && !insertBtn.disabled) {
        insertBtn.click();
        await new Promise(r => setTimeout(r, 600));
      }

      const chips = Array.from(document.querySelectorAll('.ProseMirror .mention-chip, flow-character-ingredient-chip, flow-ingredient-chip'))
        .map(c => (c.innerText || '').replace(/\\s+/g, ' ').trim());
      return { ok: true, character: rawTargetName, chips };
    })(${JSON.stringify(charName)})`);

    if (res && res.fallbackToMention) {
      return await addCharacter(charName, { ...options, cdp, skipIngredientPicker: true });
    }
    if (res && res.error) {
      // Dismiss lingering overlay cleanly
      await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
      throw new Error(res.error);
    }
    // Dismiss overlay if still open
    await cdp.evaluate(`(() => {
      const hasAddBtn = Array.from(document.querySelectorAll('.cdk-overlay-pane button')).some(b => (b.innerText || '').includes('Thêm vào câu lệnh') || (b.innerText || '').includes('Add to prompt'));
      return hasAddBtn;
    })()`).then(async (stillOpen) => {
      if (stillOpen) {
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
        await sleep(250);
      }
    }).catch(() => {});
    return res;
  } finally {
    cdp.close();
  }
}

// 3. Add character ingredient chip (prefers Ingredients picker with exact matching; falls back to @ mention with exact matching)
async function addCharacter(charName, options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    if (!options.skipIngredientPicker) {
      const hasPicker = await cdp.evaluate(`!!document.querySelector('button[aria-label="Thêm thành phần vào ô nhập câu lệnh"], button[aria-label="Add ingredient to prompt"], button[aria-label="Add ingredients to prompt"], button.add-menu-trigger')`);
      if (hasPicker) {
        return await addIngredient(charName, { ...options, cdp });
      }
    }

    const res = await cdp.evaluate(`(async () => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };

      pm.focus();
      const p = pm.querySelector('p') || pm;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      if (pm.querySelectorAll('.mention-chip').length > 0 && !p.innerText.endsWith(' ')) {
        document.execCommand('insertText', false, ' ');
      }
      document.execCommand('insertText', false, '@');
      await new Promise(r => setTimeout(r, 750));

      // Click tab 'Nhân vật' if available in overlay
      const navItems = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-list-item, .cdk-overlay-pane button, .cdk-overlay-pane span'));
      const charTab = navItems.find(i => (i.innerText || '').includes('Nhân vật'));
      if (charTab) {
        charTab.click();
        await new Promise(r => setTimeout(r, 750));
      }

      const norm = (s) => String(s || '').replace(/^@/, '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const cleanName = norm(${JSON.stringify(charName)});
      const exactSet = new Set([cleanName + ' nhân vật', cleanName + ' character', cleanName]);
      const pickExact = (els) => els.find(o => exactSet.has(norm(o.innerText)) || exactSet.has(norm(o.getAttribute('aria-label'))));

      let options = Array.from(document.querySelectorAll('.cdk-overlay-pane [role="option"], .cdk-overlay-pane button, .cdk-overlay-pane .asset-item, .cdk-overlay-pane .character-tile-container'));
      let target = pickExact(options);
      if (!target) {
        const searchInput = document.querySelector('.cdk-overlay-pane input[placeholder*="Tìm kiếm"], .cdk-overlay-pane input[placeholder*="Search"], .cdk-overlay-pane input');
        if (searchInput) {
          searchInput.focus();
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          if (setter) setter.call(searchInput, ${JSON.stringify(charName.replace(/^@/, ''))});
          else searchInput.value = ${JSON.stringify(charName.replace(/^@/, ''))};
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 450));
          options = Array.from(document.querySelectorAll('.cdk-overlay-pane [role="option"], .cdk-overlay-pane button, .cdk-overlay-pane .asset-item, .cdk-overlay-pane .character-tile-container'));
          target = pickExact(options);
        }
      }
      if (!target) return { error: 'Không tìm thấy chính xác nhân vật ' + ${JSON.stringify(charName)} + ' trong menu' };
      target.click();

      await new Promise(r => setTimeout(r, 650));
      const insertBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Thêm vào câu lệnh') || (b.innerText || '').includes('Add to prompt'));
      if (insertBtn) insertBtn.click();

      // Wait for overlay to close and mention-chip to settle in live ProseMirror (up to 2.0s)
      for (let w = 0; w < 14; w++) {
        await new Promise(r => setTimeout(r, 150));
        const mChips = Array.from(document.querySelectorAll('.ProseMirror .mention-chip')).map(c => norm(c.innerText));
        if (mChips.includes(cleanName)) break;
      }
      await new Promise(r => setTimeout(r, 250));

      const chips = Array.from(document.querySelectorAll('.ProseMirror .mention-chip')).map(c => c.innerText.trim());
      const ingCount = document.querySelectorAll('flow-character-ingredient-chip').length;
      return { ok: true, character: ${JSON.stringify(charName)}, chipsInPrompt: chips, ingCount };
    })()`);
    if (res && res.error) {
      throw new Error(res.error);
    }
    return res;
  } finally {
    cdp.close();
  }
}

// 4. Submit prompt with Zero Physical Descriptors check & chip preservation
async function submitPrompt(promptText, options = {}) {
  // Pre-flight prompt screening with TypeSafe Jev if available
  try {
    const parsed = jev.screenPrompt(promptText);
    if (parsed.safe === false && parsed.risk_score > 0.70) {
      console.warn(`[!] CẢNH BÁO TYPESAFE JEV: Prompt có rủi ro chính sách cao (${parsed.risk_score}): ${parsed.reason}`);
    }
  } catch {}

  // Pre-flight Timeline Prompting syntax check for multi-second video clips
  const hasTimelineMarkers = /\[?\b\d+(\.\d+)?s?\s*[-–—]\s*\d+(\.\d+)?s?\]?/i.test(promptText);
  if (!hasTimelineMarkers && promptText.length > 60 && !promptText.includes('NO TITLE BANNER')) {
    console.warn(`[!] [SOP TIMELINE PROMPTING] Lưu ý: Prompt video chưa chứa mốc thời gian (ví dụ: [0.0s - 3.0s]). Đảm bảo áp dụng Timeline Prompting theo WORKFLOW.md §8.10 để tối ưu camera choreography.`);
  }

  const cdp = await getFlowClient(options.cdp);
  try {
    // Check if Google Flow is out of credits before submitting
    const creditState = await cdp.evaluate(`(() => {
      const warnBtn = document.querySelector('.prompt-warning-button');
      const creditBanner = document.querySelector('.credit-banner, [class*="credit-banner"]');
      return {
        warnLabel: warnBtn ? (warnBtn.getAttribute('aria-label') || '') : '',
        bannerText: creditBanner ? (creditBanner.innerText || '') : ''
      };
    })()`);
    const creditCheck = detectInsufficientCredits(creditState);
    if (creditCheck.outOfCredits) {
      throw new Error(`[Google Flow] Insufficient credits: ${creditCheck.msg}`);
    }

    const inputRes = await cdp.evaluate(`(() => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };
      pm.focus();

      const chips = pm.querySelectorAll('.mention-chip');
      if (chips && chips.length > 0) {
        const lastChip = chips[chips.length - 1];
        const range = document.createRange();
        range.setStartAfter(lastChip);
        range.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        document.execCommand('insertText', false, ' ' + ${JSON.stringify(promptText)});
      } else {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
        document.execCommand('insertText', false, ${JSON.stringify(promptText)});
      }

      pm.dispatchEvent(new Event('input', { bubbles: true }));
      pm.dispatchEvent(new Event('change', { bubbles: true }));
      pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));

      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"], button[aria-label="Tạo"]');
      return {
        ok: true,
        textEntered: pm.innerText.trim().slice(0, 60) + '...',
        chipsCount: pm.querySelectorAll('.mention-chip').length,
        readyToSubmit: genBtn ? !genBtn.disabled : false
      };
    })()`);

    await sleep(1000);

    const clickRes = await cdp.evaluate(`(() => {
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"], button[aria-label="Tạo"]');
      if (genBtn && !genBtn.disabled) {
        genBtn.click();
        return { submitted: true };
      }
      return { submitted: false, reason: 'Generate button not ready or disabled' };
    })()`);

    // Give 2.5s for Google Flow to register the generation and insert the pending tile
    await sleep(2500);

    return { ...inputRes, ...clickRes };
  } finally {
    cdp.close();
  }
}

// Helper: Classify Google Flow prompt refusal or policy violation using TypeSafe Jev
function classifyPromptRefusal(text) {
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  const lower = text.toLowerCase();
  // Upscaling progress toasts or informational notifications are never prompt refusals
  if (lower.includes('đang tăng') || lower.includes('độ phân giải') || lower.includes('upscaling') || lower.includes('quá trình này có thể mất')) {
    return { choice: 'neutral', confidence: 1.0 };
  }
  const res = jev.classify(text, {
    refusal: "prompt was refused, blocked or violates safety policy or community guidelines",
    error: "system error, capacity limit or generation failure occurred",
    neutral: "normal generation or progress status"
  });
  if (res.choice) return res;
  if (lower.includes('không thành công') || lower.includes('vi phạm') || lower.includes('policy') || lower.includes('violate') || lower.includes('blocked') || lower.includes('failed')) {
    return { choice: 'refusal', confidence: 0.9 };
  }
  return { choice: 'neutral', confidence: 0.8 };
}

// 5. Wait for render to complete (pending tile appears then disappears)
async function waitForRender(timeoutSec = 240, options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    let hasSeenPending = false;
    const start = Date.now();
    process.stdout.write('[-] Đang render trên Google Flow: ');

    while ((Date.now() - start) < timeoutSec * 1000) {
      await sleep(3000);
      const state = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile0 = tiles[0];
        if (!tile0) return { hasPending: false, isReady: false };

        const text = tile0.innerText || '';
        const m = text.match(/\\b(\\d{1,3})%/);
        const pctNum = m ? parseInt(m[1], 10) : null;
        const realVideo = Array.from(tile0.querySelectorAll('video')).find(v => !v.closest('flow-pending-tile') && v.src && (v.src.includes('flow-content.google') || v.src.startsWith('http')));
        const hasVideo = !!realVideo;
        const hasThumb = !!tile0.querySelector('img.thumbnail, img');
        const tile0Pending = tile0.querySelectorAll('flow-pending-tile').length > 0;

        const isActivelyPending = (tile0Pending || (pctNum !== null && pctNum < 100)) && !(hasVideo && pctNum === 100);
        const isReady = (hasVideo || hasThumb) && !isActivelyPending;

        const err = tile0.querySelector('.error-message, [role="alert"]');
        const refusal = tile0.innerText && (tile0.innerText.includes('Không thành công') || tile0.innerText.includes('vi phạm chính sách') || tile0.innerText.includes('policy') || tile0.innerText.includes('violate'))
          ? tile0.innerText
          : null;

        return {
          hasPending: isActivelyPending,
          isReady: isReady,
          pct: m ? m[0] : null,
          error: err ? err.innerText.trim().replace(/[\\r\\n]+/g, ' ') : null,
          refusal: refusal ? refusal.trim().replace(/[\\r\\n]+/g, ' ') : null
        };
      })()`);

      const refusalCandidate = state.refusal || state.error;
      if (refusalCandidate) {
        const jRef = classifyPromptRefusal(refusalCandidate);
        if (jRef.choice === 'refusal' || jRef.choice === 'error') {
          process.stdout.write('\n');
          throw new Error(`Google Flow từ chối câu lệnh chính sách [TypeSafe Jev: ${jRef.choice}]: ${refusalCandidate}`);
        }
      }

      if (state.hasPending) {
        hasSeenPending = true;
        process.stdout.write(state.pct ? `[${state.pct}]` : '*');
      } else if (hasSeenPending && state.isReady) {
        process.stdout.write(' ✓ XONG!\n');
        return true;
      } else {
        process.stdout.write('.');
        // Fail fast if pending tile hasn't appeared within 35s of submission
        if (!hasSeenPending && (Date.now() - start) > 35000) {
          process.stdout.write('\n');
          throw new Error('Timeout 35s: Google Flow chưa kích hoạt render (không thấy pending tile)!');
        }
      }
    }

    process.stdout.write('\n');
    throw new Error(`Timeout ${timeoutSec}s khi chờ Google Flow render!`);
  } finally {
    cdp.close();
  }
}

// Helper: verify downloaded or cached MP4 using ffprobe (codec_type=video), rejecting HTML redirects & truncated files
function verifyVideoFileWithFfprobe(filePath, options = {}) {
  const minBytes = typeof options.minBytes === 'number' ? options.minBytes : 10000;
  const execFn = typeof options.execFn === 'function' ? options.execFn : execFileSync;

  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, reason: 'file_not_found' };
  }
  const stat = fs.statSync(filePath);
  if (stat.size < minBytes) {
    return { valid: false, reason: 'file_too_small', size: stat.size };
  }

  // Reject HTML login redirects or text error responses saved with .mp4 extension
  try {
    const fd = fs.openSync(filePath, 'r');
    const headBuf = Buffer.alloc(64);
    const bytesRead = fs.readSync(fd, headBuf, 0, 64, 0);
    fs.closeSync(fd);
    const headStr = headBuf.slice(0, bytesRead).toString('utf8').trim().toLowerCase();
    if (headStr.startsWith('<!doctype') || headStr.startsWith('<html') || headStr.startsWith('<?xml')) {
      return { valid: false, reason: 'html_redirect_or_text_response', size: stat.size };
    }
  } catch (err) {
    return { valid: false, reason: `read_header_failed: ${err.message}` };
  }

  try {
    const target = config.toWinPath(filePath);
    const out = execFn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      target
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    const parsed = JSON.parse(out || '{}');
    const vStream = (parsed.streams || []).find(s => s.codec_type === 'video');
    const duration = parseFloat(parsed.format && parsed.format.duration);
    if (!vStream) {
      return { valid: false, reason: 'no_video_stream', size: stat.size };
    }
    if (!Number.isFinite(duration) || duration <= 0) {
      return { valid: false, reason: 'invalid_duration', size: stat.size };
    }
    return {
      valid: true,
      codec: vStream.codec_name || 'unknown',
      width: Number(vStream.width) || 0,
      height: Number(vStream.height) || 0,
      duration,
      size: stat.size
    };
  } catch (err) {
    return { valid: false, reason: `ffprobe_failed: ${err.message}`, size: stat.size };
  }
}

// Helper: get candidate download directories to monitor for Chrome downloads
function getCandidateDownloadDirs(customDirs = null) {
  if (Array.isArray(customDirs) && customDirs.length > 0) return customDirs;
  if (typeof config.resolveDownloadDirs === 'function') {
    return config.resolveDownloadDirs();
  }
  return [config.WIN_DOWNLOADS_DIR].filter(Boolean);
}

// Helper: scan all candidate download directories for the newest completed .mp4
function findLatestMp4InDirs(dirs = null) {
  const candidates = getCandidateDownloadDirs(dirs);
  const allFiles = [];
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        if (!f.endsWith('.mp4') || f.endsWith('.crdownload') || f.includes('why_videogen')) continue;
        const full = path.join(dir, f);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) {
            allFiles.push({ file: full, dir, name: f, mtime: st.mtimeMs, size: st.size });
          }
        } catch {}
      }
    } catch {}
  }
  allFiles.sort((a, b) => b.mtime - a.mtime);
  return allFiles.length > 0 ? allFiles[0] : null;
}

// Helper: snapshot all existing .mp4 files across candidate download dirs
function snapshotMp4sInDirs(dirs = null) {
  const candidates = getCandidateDownloadDirs(dirs);
  const snap = new Map();
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.mp4') || f.endsWith('.crdownload')) continue;
        const full = path.join(dir, f);
        try {
          const st = fs.statSync(full);
          if (st.isFile()) snap.set(full, `${st.mtimeMs}:${st.size}`);
        } catch {}
      }
    } catch {}
  }
  return snap;
}

function findNewMp4SinceSnapshot(beforeSnap, dirs = null, minBytes = 100000) {
  const candidates = getCandidateDownloadDirs(dirs);
  const fresh = [];
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.mp4') || f.endsWith('.crdownload') || f.includes('why_videogen')) continue;
        const full = path.join(dir, f);
        try {
          const st = fs.statSync(full);
          if (!st.isFile() || st.size < minBytes) continue;
          const sig = `${st.mtimeMs}:${st.size}`;
          if (!beforeSnap.has(full) || beforeSnap.get(full) !== sig) {
            fresh.push({ file: full, dir, name: f, mtime: st.mtimeMs, size: st.size });
          }
        } catch {}
      }
    } catch {}
  }
  fresh.sort((a, b) => b.mtime - a.mtime);
  return fresh.length > 0 ? fresh[0] : null;
}

// Helper: get newest .mp4 across Windows/candidate Downloads directories
function getLatestMp4InDownloads(dirs = null) {
  return findLatestMp4InDirs(dirs);
}

// Helper: check if any Chrome download is currently in progress across candidate directories
function hasActiveCrdownload(dirs = null) {
  const candidates = getCandidateDownloadDirs(dirs);
  for (const dir of candidates) {
    if (!dir || !fs.existsSync(dir)) continue;
    try {
      if (fs.readdirSync(dir).some(f => f.endsWith('.crdownload'))) return true;
    } catch {}
  }
  return false;
}

// 6a. Direct 720p download (prefers Flow native menu more_vert -> Tải xuống -> 720p + ffprobe validation)
async function downloadLatestDirect(targetFile, options = {}) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cdp = await getFlowClient(options.cdp);
  const downloadDirs = getCandidateDownloadDirs(options.downloadDirs);
  const beforeSnap = snapshotMp4sInDirs(downloadDirs);

  try {
    // 1. Prefer Flow's native menu download (more_vert / Tuỳ chọn khác -> hover/click Tải xuống -> click 720p)
    const openMenuRes = await cdp.evaluate(`(async () => {
      const tile = document.querySelector('flow-video-tile');
      if (!tile) return { error: 'Không tìm thấy thẻ video Flow' };
      tile.scrollIntoView({ block: 'center' });
      const moreBtn = Array.from(tile.querySelectorAll('button')).find(b =>
        b.getAttribute('aria-label') === 'Tuỳ chọn khác' ||
        b.getAttribute('aria-label') === 'Tùy chọn khác' ||
        b.getAttribute('aria-label') === 'More options' ||
        (b.innerText || '').includes('more_vert')
      );
      if (!moreBtn) return { error: 'Không tìm thấy nút more_vert trên thẻ video' };
      moreBtn.click();
      await new Promise(r => setTimeout(r, 600));

      const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"]'));
      const dlBtn = menuItems.find(i => {
        const t = (i.innerText || '').trim();
        return t.includes('Tải xuống') || t.includes('Download');
      });
      if (!dlBtn) return { error: 'Không tìm thấy nút Tải xuống trong menu' };
      const r = dlBtn.getBoundingClientRect();
      dlBtn.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      dlBtn.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      dlBtn.click();
      return { ok: true, dlPt: (r.width > 0 && r.height > 0) ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } : null };
    })()`);

    let triggeredNative720 = false;
    if (openMenuRes && openMenuRes.ok) {
      if (openMenuRes.dlPt && typeof cdp.send === 'function') {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: openMenuRes.dlPt.x, y: openMenuRes.dlPt.y }).catch(() => {});
      }
      await sleep(650);
      const click720Res = await cdp.evaluate(`(() => {
        const subItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"]'));
        const b720 = subItems.find(b => (b.innerText || '').includes('720p'));
        if (!b720) return { error: 'Không tìm thấy mục 720p trong menu tải xuống' };
        b720.click();
        return { ok: true, text: b720.innerText };
      })()`);
      if (click720Res && click720Res.ok) {
        triggeredNative720 = true;
      }
    }

    if (triggeredNative720) {
      console.log(`    [-] Đã kích hoạt tải 720p từ menu Google Flow (đang theo dõi ${downloadDirs.join(', ')})...`);
      const pollStart = Date.now();
      const timeoutMs = 60000;
      while ((Date.now() - pollStart) < timeoutMs) {
        await sleep(600);
        if (hasActiveCrdownload(downloadDirs)) continue;
        const current = findNewMp4SinceSnapshot(beforeSnap, downloadDirs, 100000);
        if (current) {
          // Wait briefly for filesystem flush
          await sleep(500);
          if (hasActiveCrdownload(downloadDirs)) continue;
          const probe = verifyVideoFileWithFfprobe(current.file);
          if (!probe.valid) {
            console.warn(`    [!] File tải xuống chưa đạt ffprobe (${probe.reason}), tiếp tục chờ...`);
            continue;
          }
          try {
            if (fs.existsSync(targetFile)) fs.unlinkSync(targetFile);
          } catch {}
          fs.copyFileSync(current.file, targetFile);
          const targetProbe = verifyVideoFileWithFfprobe(targetFile);
          if (!targetProbe.valid) {
            try { fs.unlinkSync(targetFile); } catch {}
            throw new Error(`File đích không vượt qua kiểm định ffprobe sau khi sao chép: ${targetProbe.reason}`);
          }
          try { fs.unlinkSync(current.file); } catch {}
          console.log(`    [✓] Đã lưu & kiểm định video 720p thành công: ${targetFile} (${(targetProbe.size / 1024 / 1024).toFixed(2)} MB, ${targetProbe.width}x${targetProbe.height}, ${targetProbe.duration.toFixed(2)}s)`);
          return targetFile;
        }
      }
      console.warn('    [!] Timeout chờ file 720p trong Downloads, fallback qua video src URL...');
    }

    // Dismiss any open menu overlay before fallback hover
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
    await sleep(300);

    let videoSrc = null;
    for (let i = 0; i < 12; i++) {
      const tileRect = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile = tiles[0];
        if (!tile || tile.querySelector('flow-pending-tile')) return null;
        tile.scrollIntoView({ block: 'center' });
        const r = tile.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()`);
      if (tileRect) {
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.max(10, tileRect.x - 15), y: Math.max(10, tileRect.y - 15) });
        await sleep(100);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tileRect.x, y: tileRect.y });
        await sleep(500);
      }

      videoSrc = await cdp.evaluate(`(() => {
        const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
        const tile = tiles[0];
        if (!tile || tile.querySelector('flow-pending-tile')) return null;
        tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const container = tile.querySelector('.container');
        if (container) container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const v = Array.from(tile.querySelectorAll('video')).find(el => !el.closest('flow-pending-tile') && el.src && (el.src.includes('flow-content.google') || el.src.startsWith('http')));
        return v ? v.src : null;
      })()`);

      if (videoSrc) break;
      await sleep(700);
    }

    if (!videoSrc) {
      throw new Error('Không lấy được Direct Signed CDN URL từ thẻ video Flow!');
    }

    // Validate target URL origin (A04)
    let parsedUrl;
    try {
      parsedUrl = new URL(videoSrc);
    } catch {
      throw new Error(`Đường dẫn video không hợp lệ: ${videoSrc}`);
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error(`Giao thức không an toàn: ${parsedUrl.protocol}`);
    }
    const isGoogleFlow = parsedUrl.hostname === 'flow-content.google' ||
                         parsedUrl.hostname === 'flow.google.com' ||
                         parsedUrl.hostname.endsWith('.google.com') ||
                         parsedUrl.hostname.endsWith('.googleusercontent.com');
    if (!isGoogleFlow) {
      throw new Error(`Origin video không được tin cậy (chỉ chấp nhận domain Google Flow): ${parsedUrl.hostname}`);
    }

    console.log(`    [-] Tải nhanh qua Direct CDN (720p): ${videoSrc.slice(0, 60)}...`);

    let cookieArgs = [];
    if (parsedUrl.hostname === 'flow.google.com') {
      try {
        const cookieRes = await cdp.send('Network.getCookies', { urls: ['https://flow.google.com'] });
        if (cookieRes && cookieRes.cookies && cookieRes.cookies.length > 0) {
          const cookieStr = cookieRes.cookies.map(c => `${c.name}=${c.value}`).join('; ');
          cookieArgs = [
            '-H', `Cookie: ${cookieStr}`,
            '-H', 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          ];
        }
      } catch {}
    }

    try {
      if (fs.existsSync(targetFile) || fs.lstatSync(targetFile).isSymbolicLink()) {
        fs.unlinkSync(targetFile);
      }
    } catch {}

    try {
      execFileSync('curl', ['-s', '-f', '-L', '--max-time', '120', ...cookieArgs, videoSrc, '-o', targetFile]);
    } catch (curlErr) {
      if (cookieArgs.length > 0) {
        execFileSync('curl', ['-s', '-f', '-L', '--max-time', '120', videoSrc, '-o', targetFile]);
      } else {
        throw curlErr;
      }
    }

    const probe = verifyVideoFileWithFfprobe(targetFile);
    if (!probe.valid) {
      try { fs.unlinkSync(targetFile); } catch {}
      throw new Error(`File tải về không hợp lệ qua ffprobe (${probe.reason}): ${targetFile}`);
    }
    console.log(`    [✓] Đã lưu & kiểm định video 720p thành công: ${targetFile} (${(probe.size / 1024 / 1024).toFixed(2)} MB, ${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s)`);
    return targetFile;
  } finally {
    cdp.close();
  }
}

// Helper: Classify Google Flow toast/message using TypeSafe Jev System One
function classifyUpscaleToast(text) {
  if (typeof text !== 'string') {
    if (text && typeof text === 'object') {
      text = text.value || text.text || text.message || JSON.stringify(text);
    } else {
      return { choice: 'neutral', confidence: 1.0 };
    }
  }
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  const res = jev.classify(text, {
    in_progress: "video resolution is currently being upscaled or processed in background",
    error: "an error, quota limit, concurrency warning, refusal or failure occurred",
    neutral: "normal page state or confirmation message"
  });
  if (res.choice) return res;
  const lower = text.toLowerCase();
  if (lower.includes('đang tăng') || lower.includes('tăng độ phân giải') || lower.includes('upscaling') || lower.includes('processing')) {
    return { choice: 'in_progress', confidence: 0.9 };
  }
  if (lower.includes('lỗi') || lower.includes('thất bại') || lower.includes('error') || lower.includes('failed') || lower.includes('quá nhiều yêu cầu')) {
    return { choice: 'error', confidence: 0.9 };
  }
  return { choice: 'neutral', confidence: 0.8 };
}

// 6b. Cloud AI Super-Resolution (1080p Full HD upscale & download)
async function downloadCloud1080p(targetFile, timeoutSec = 240, options = {}) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const beforeFile = getLatestMp4InDownloads();
  const beforeMtime = beforeFile ? beforeFile.mtime : 0;

  console.log('    [-] Kích hoạt Cloud 1080p Super-Resolution trên Google Flow...');
  const cdp = await getFlowClient(options.cdp);

  try {
    // 2. Click Tải xuống -> 1080p
    const triggerRes = await cdp.evaluate(`(async () => {
      const tile = document.querySelector('flow-video-tile');
      if (!tile) return { error: 'Không tìm thấy thẻ video Flow' };

      const moreBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tuỳ chọn khác' || (b.innerText || '').includes('more_vert'));
      if (!moreBtn) return { error: 'Không tìm thấy nút more_vert trên thẻ video' };
      moreBtn.click();
      await new Promise(r => setTimeout(r, 600));

      const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
      const dlBtn = menuItems.find(i => (i.innerText || '').includes('Tải xuống'));
      if (!dlBtn) return { error: 'Không tìm thấy nút Tải xuống trong menu' };
      dlBtn.click();
      await new Promise(r => setTimeout(r, 600));

      const subItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
      const b1080 = subItems.find(b => (b.innerText || '').includes('1080p'));
      if (!b1080) return { error: 'Không tìm thấy mục 1080p trong menu tải xuống' };

      b1080.click();
      return { ok: true, text: b1080.innerText };
    })()`);

    if (triggerRes && triggerRes.error) {
      throw new Error(triggerRes.error);
    }

    await sleep(800);
    const toastRes = await cdp.evaluate(`(() => {
      const snack = document.querySelector('snack-bar-container, .mat-mdc-snack-bar-container');
      return snack ? snack.innerText : null;
    })()`);

    if (toastRes) {
      const jClass = classifyUpscaleToast(toastRes);
      if (jClass.choice === 'error') {
        throw new Error(`Google Flow Cloud Upscale báo lỗi: "${toastRes}"`);
      }
      if (jClass.choice === 'in_progress') {
        console.log(`    [-] [TypeSafe Jev: ${jClass.choice}] Google Flow đang xử lý tăng độ phân giải trên Cloud...`);
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
      }
    }

    // 3. Poll for upscale completion & download trigger
    const startWait = Date.now();
    let downloadedFile = null;
    process.stdout.write('    [-] Đang chờ Google Cloud hoàn thành 1080p: ');

    while ((Date.now() - startWait) < timeoutSec * 1000) {
      await sleep(10000);

      const current = getLatestMp4InDownloads();
      if (current && current.mtime > beforeMtime + 500 && !hasActiveCrdownload()) {
        downloadedFile = current;
        process.stdout.write(' ✓ XONG!\n');
        break;
      }

      // Re-trigger 1080p click
      const pollRes = await cdp.evaluate(`(async () => {
        const tile = document.querySelector('flow-video-tile');
        if (!tile) return null;
        const moreBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tuỳ chọn khác' || (b.innerText || '').includes('more_vert'));
        let dlBtn = Array.from(tile.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === 'Tải xuống');
        if (!dlBtn && moreBtn) {
          moreBtn.click();
          await new Promise(r => setTimeout(r, 600));
          const menuItems = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
          dlBtn = menuItems.find(i => (i.innerText || '').includes('Tải xuống'));
        }
        if (!dlBtn) return null;
        dlBtn.click();
        await new Promise(r => setTimeout(r, 600));

        const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="menuitem"]'));
        const b1080 = items.find(b => b.innerText && b.innerText.includes('1080p'));
        if (!b1080) return null;
        b1080.click();
        return { ok: true };
      })()`);

      await sleep(500);
      const pollToast = await cdp.evaluate(`(() => {
        const snack = document.querySelector('snack-bar-container, .mat-mdc-snack-bar-container');
        return snack ? snack.innerText : null;
      })()`);

      if (pollToast) {
        const jPoll = classifyUpscaleToast(pollToast);
        if (jPoll.choice === 'error') {
          process.stdout.write('\n');
          throw new Error(`Google Flow Cloud Upscale báo lỗi khi thăm dò: "${pollToast}"`);
        }
        if (jPoll.choice === 'in_progress') {
          process.stdout.write('*');
          await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
          await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, unmodifiedText: '', text: '' });
        }
      } else {
        process.stdout.write('.');
      }

      await sleep(2000);
      const afterPoll = getLatestMp4InDownloads();
      if (afterPoll && afterPoll.mtime > beforeMtime + 500 && !hasActiveCrdownload()) {
        downloadedFile = afterPoll;
        process.stdout.write(' ✓ XONG!\n');
        break;
      }
    }

    if (!downloadedFile) {
      process.stdout.write('\n');
      throw new Error(`Timeout ${timeoutSec}s khi chờ Google Cloud upscale 1080p`);
    }

    while (hasActiveCrdownload()) {
      await sleep(1000);
    }

    try {
      if (fs.existsSync(targetFile) || fs.lstatSync(targetFile).isSymbolicLink()) {
        fs.unlinkSync(targetFile);
      }
    } catch {}

    fs.copyFileSync(downloadedFile.file, targetFile);
    const probe = verifyVideoFileWithFfprobe(targetFile);
    if (!probe.valid) {
      try { fs.unlinkSync(targetFile); } catch {}
      throw new Error(`File 1080p tải về không vượt qua kiểm định ffprobe (${probe.reason}): ${targetFile}`);
    }
    const sizeMb = (probe.size / 1024 / 1024).toFixed(2);
    console.log(`    [✓] Đã lưu & kiểm định video 1080p thành công: ${targetFile} (${sizeMb} MB, ${probe.width}x${probe.height}, ${probe.duration.toFixed(2)}s)`);
    return targetFile;
  } finally {
    cdp.close();
  }
}

// Pure helper: resolve Google Flow video settings from storyboard + CLI options
function resolveFlowVideoConfig(sb = {}, options = {}) {
  const project = (sb && sb.project) || {};
  const geometry = (sb && sb.geometry) || {};
  const visuals = (sb && sb.visuals) || {};
  const flowProjectUrl = options.flowProjectUrl || sb.flow_project_url || project.flow_project_url || null;
  const rawMode = options.flowMode || sb.flow_mode || project.flow_mode || null;
  const flowMode = rawMode ? String(rawMode).toLowerCase() : null;
  const isShorts = (sb.ratio === '9:16') || (sb.aspect_ratio === '9:16') || (geometry.aspect_ratio === '9:16') || (sb.format === 'shorts_40s') || (project.aspect_ratio === '9:16');
  const ratio = options.ratio || sb.ratio || sb.aspect_ratio || geometry.aspect_ratio || project.aspect_ratio || (isShorts ? '9:16' : '16:9');
  const resolution = options.resolution || sb.resolution || project.resolution || geometry.resolution || '1080p';
  const clipDurationNum = Number(options.clipDuration || sb.clip_duration || sb.duration_per_shot_sec || project.clip_duration || 10);
  const clipDuration = Number.isFinite(clipDurationNum) && clipDurationNum > 0 ? clipDurationNum : 10;
  const durationLabel = `${clipDuration} giây`;
  const model = options.model || sb.model || visuals.model || project.model || 'Omni 1.1 Flash';

  return {
    flowProjectUrl,
    flowMode,
    ratio,
    resolution,
    clipDuration,
    durationLabel,
    model
  };
}

// Pure helper: derive Google Flow /character route from project URL or current tab URL
function buildCharacterRouteUrl(flowProjectUrl, currentUrl = '') {
  const source = String(flowProjectUrl || currentUrl || '').trim();
  const match = source.match(/^(https?:\/\/flow\.google\.com\/project\/[^/?#]+)/i);
  if (match) {
    return `${match[1]}/character`;
  }
  return null;
}

// Helper: navigate Flow tab to a specific project URL if set (reuse without reloading when already there)
async function openFlowProject(projectUrl, options = {}) {
  if (!projectUrl) return false;
  const targetBase = String(projectUrl).replace(/\/+$/, '');
  const cdp = await getFlowClient(options.cdp);
  try {
    const currentUrl = await cdp.evaluate('location.href').catch(() => '');
    const currentNorm = String(currentUrl || '').split('?')[0].replace(/\/+$/, '');
    if (currentNorm !== targetBase) {
      console.log(`    [-] Mở dự án Google Flow chỉ định: ${targetBase}`);
      await cdp.send('Page.navigate', { url: targetBase });
      const start = Date.now();
      while (Date.now() - start < 25000) {
        await sleep(800);
        const ready = await cdp.evaluate(`Boolean(document.querySelector('.settings-trigger-button, button.prompt-settings-trigger, .ProseMirror, flow-project-nav-list'))`).catch(() => false);
        if (ready) break;
      }
      await sleep(1000);
    }
    return true;
  } finally {
    cdp.close();
  }
}

// Helper: list existing exact character names in the current Flow project
async function listExistingProjectCharacters(options = {}) {
  const cdp = await getFlowClient(options.cdp);
  try {
    const names = await cdp.evaluate(`(async () => {
      const addBtn = document.querySelector(
        'button[aria-label="Thêm thành phần vào ô nhập câu lệnh"], button[aria-label="Add ingredient to prompt"], button[aria-label="Add ingredients to prompt"], button.add-menu-trigger'
      );
      if (!addBtn) return [];
      addBtn.click();
      await new Promise(r => setTimeout(r, 700));

      const opts = Array.from(document.querySelectorAll('.cdk-overlay-pane [role="option"]'));
      const found = [];
      for (const el of opts) {
        const raw = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
        const m = raw.match(/^(.+?)\\s+(?:Nhân vật|Character)$/i);
        if (m && m[1]) found.push(m[1].trim());
      }
      return found;
    })()`);
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' }).catch(() => {});
    await sleep(300);
    return Array.isArray(names) ? names : [];
  } finally {
    cdp.close();
  }
}

// Helper: select Nano Banana Pro inside model selector (used on /character route where Flow resets after portrait)
async function selectCharacterModelNanoBananaPro(cdp) {
  await cdp.evaluate(`(async () => {
    const trigger = document.querySelector('button[aria-label="Chọn nhóm mô hình"], button[aria-label*="model"], .model-select-trigger-content');
    if (!trigger) return false;
    if ((trigger.innerText || '').includes('Nano Banana Pro')) return true;
    trigger.click();
    await new Promise(r => setTimeout(r, 500));
    const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane [role="option"], .cdk-overlay-pane mat-option'));
    const proItem = items.find(i => (i.innerText || '').toLowerCase().includes('nano banana pro')) ||
                    items.find(i => (i.innerText || '').toLowerCase().includes('pro'));
    if (proItem) {
      proItem.click();
      await new Promise(r => setTimeout(r, 400));
      return true;
    }
    return false;
  })()`);
}

// Helper: wait for /character portrait or body generation completion
// Completion criteria: !aria-busy, "Tải hình ảnh xuống" present, and no "%" progress in "Nhật ký"
async function waitForCharacterGeneration(cdp, timeoutSec = 120) {
  const start = Date.now();
  while ((Date.now() - start) < timeoutSec * 1000) {
    await sleep(2000);
    const state = await cdp.evaluate(`(() => {
      const busyEl = document.querySelector('[aria-busy="true"]');
      const dlBtn = Array.from(document.querySelectorAll('button, a')).find(el => {
        const t = (el.innerText || el.getAttribute('aria-label') || '').trim();
        return t.includes('Tải hình ảnh xuống') || t.includes('Download image');
      });
      // Check Nhật ký (History/Log) panel or pending tiles for active % progress
      const logContainers = Array.from(document.querySelectorAll('[aria-label*="Nhật ký"], [aria-label*="History"], aside, section, flow-pending-tile'));
      let hasPercent = false;
      for (const c of logContainers) {
        const txt = c.innerText || '';
        if ((txt.includes('Nhật ký') || txt.includes('History') || c.tagName === 'FLOW-PENDING-TILE') && /\\b\\d{1,2}%/.test(txt)) {
          hasPercent = true;
          break;
        }
      }
      const pendingTile = !!document.querySelector('flow-pending-tile, mat-progress-spinner');
      return {
        isBusy: Boolean(busyEl) || pendingTile,
        hasDownloadBtn: Boolean(dlBtn),
        hasPercent
      };
    })()`);

    if (state && !state.isBusy && state.hasDownloadBtn && !state.hasPercent) {
      return true;
    }
  }
  throw new Error(`Timeout ${timeoutSec}s khi chờ Google Flow tạo ảnh nhân vật trên /character!`);
}

// 1b. Automate Google Flow /character route to create character assets from storyboard.characters
async function createCharacterAssets(sb, options = {}) {
  const characters = Array.isArray(sb && sb.characters) ? sb.characters : [];
  if (characters.length === 0) {
    console.log('[i] Storyboard không khai báo mảng "characters", bỏ qua bước tạo nhân vật.');
    return { created: [], skipped: [] };
  }

  const force = Boolean(options.force);
  const flowCfg = resolveFlowVideoConfig(sb, options);
  const cdp = await getFlowClient(options.cdp);
  const created = [];
  const skipped = [];

  try {
    if (flowCfg.flowProjectUrl) {
      await openFlowProject(flowCfg.flowProjectUrl, { cdp });
    }

    const currentUrl = await cdp.evaluate('location.href').catch(() => '');
    const charRouteUrl = buildCharacterRouteUrl(flowCfg.flowProjectUrl, currentUrl);
    if (!charRouteUrl) {
      throw new Error('Không xác định được URL dự án Google Flow (cần mở một dự án hoặc đặt flow_project_url).');
    }

    const existingNames = await listExistingProjectCharacters({ cdp });
    const existingNormSet = new Set(existingNames.map(normalizeIngredientLabel));

    for (let i = 0; i < characters.length; i++) {
      const ch = characters[i];
      if (!ch || !ch.name || !ch.portrait_prompt) {
        console.warn(`[!] Bỏ qua mục characters[${i}] thiếu name hoặc portrait_prompt.`);
        continue;
      }

      const normName = normalizeIngredientLabel(ch.name);
      if (!force && existingNormSet.has(normName)) {
        console.log(`[✓] [${i + 1}/${characters.length}] Nhân vật "${ch.name}" đã tồn tại chính xác trong dự án Flow, bỏ qua (dùng --force để tạo lại).`);
        skipped.push(ch.name);
        continue;
      }

      console.log(`\n>>> [${i + 1}/${characters.length}] Tạo tài sản nhân vật trên Flow /character: "${ch.name}"`);
      await cdp.send('Page.navigate', { url: charRouteUrl });
      const navStart = Date.now();
      while (Date.now() - navStart < 20000) {
        await sleep(700);
        const ready = await cdp.evaluate(`Boolean(document.querySelector('.ProseMirror, textarea, button[aria-label="Chọn nhóm mô hình"]'))`).catch(() => false);
        if (ready) break;
      }
      await sleep(800);

      // Optional face reference character attachment
      if (ch.reference_character) {
        console.log(`    [-] Đính kèm nhân vật tham chiếu khuôn mặt: "${ch.reference_character}"`);
        await addIngredient(ch.reference_character, { cdp });
      }

      // Explicitly select Nano Banana Pro before portrait generation
      await selectCharacterModelNanoBananaPro(cdp);

      // Submit portrait prompt
      console.log(`    [-] Gửi portrait_prompt (Nano Banana Pro)...`);
      await submitPrompt(ch.portrait_prompt, { cdp });
      await waitForCharacterGeneration(cdp, 120);

      // Fill Tên nhân vật & Tính cách của nhân vật
      await cdp.evaluate(`((nameVal, descVal) => {
        const setField = (el, val) => {
          if (!el) return false;
          el.focus();
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) setter.call(el, val);
          else el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        };
        const fields = Array.from(document.querySelectorAll('input, textarea'));
        const findField = (keywords) => fields.find(el => {
          const hay = [
            el.getAttribute('aria-label') || '',
            el.getAttribute('placeholder') || '',
            el.getAttribute('name') || '',
            (el.closest('mat-form-field, label, div')?.innerText || '')
          ].join(' ').toLowerCase();
          return keywords.some(k => hay.includes(k));
        });
        const nameEl = findField(['tên nhân vật', 'character name']);
        const descEl = findField(['tính cách của nhân vật', 'character personality', 'character description', 'tính cách']);
        setField(nameEl, nameVal);
        if (descVal) setField(descEl, descVal);
        return { nameFilled: Boolean(nameEl), descFilled: Boolean(descEl) };
      })(${JSON.stringify(ch.name)}, ${JSON.stringify(ch.description || '')})`);
      await sleep(500);

      // Optional body generation step
      if (ch.body_prompt) {
        console.log(`    [-] Kích hoạt "Tạo cơ thể" và chọn lại Nano Banana Pro...`);
        const clickedBody = await cdp.evaluate(`(() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => {
            const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
            return t.includes('Tạo cơ thể') || t.includes('Generate body');
          });
          if (btn) { btn.click(); return true; }
          return false;
        })()`);
        if (!clickedBody) {
          throw new Error(`Không tìm thấy nút "Tạo cơ thể" cho nhân vật "${ch.name}"`);
        }
        await sleep(900);

        // Flow resets to Nano Banana 2.1 after portrait creation — explicitly re-select Nano Banana Pro
        await selectCharacterModelNanoBananaPro(cdp);
        await clearCharacters({ cdp });
        await submitPrompt(ch.body_prompt, { cdp });
        await waitForCharacterGeneration(cdp, 120);
      }

      // Click Xong / Done to save character asset
      const clickedDone = await cdp.evaluate(`(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => {
          const t = (b.innerText || '').trim().toLowerCase();
          return t === 'xong' || t === 'done';
        });
        if (btn) { btn.click(); return true; }
        return false;
      })()`);
      if (!clickedDone) {
        throw new Error(`Không tìm thấy nút "Xong" để lưu nhân vật "${ch.name}"`);
      }
      await sleep(1800);
      existingNormSet.add(normName);
      created.push(ch.name);
      console.log(`    [✓] Đã lưu thành công nhân vật "${ch.name}" vào dự án Google Flow.`);
    }

    // Return to main project URL after character creation
    if (flowCfg.flowProjectUrl) {
      await openFlowProject(flowCfg.flowProjectUrl, { cdp });
    }
    return { created, skipped };
  } finally {
    cdp.close();
  }
}

// 6. Download latest rendered video (Default: 1080p Cloud with safe 720p fallback)
async function downloadLatest(targetFile, options = {}) {
  const resolution = options.resolution || process.env.VIDEOGEN_RESOLUTION || '1080p';
  const timeoutSec = options.timeoutSec || 240;

  if (resolution === '1080p') {
    try {
      return await downloadCloud1080p(targetFile, timeoutSec, options);
    } catch (err) {
      console.warn(`    [!] Cảnh báo khi tải 1080p Cloud: ${err.message}`);
      console.warn('    [-] Tự động chuyển sang tải bản 720p gốc làm fallback an toàn...');
      return await downloadLatestDirect(targetFile, options);
    }
  }

  return await downloadLatestDirect(targetFile, options);
}

// 7. Ensure Flow Settings (Supports both Image/Nano Banana Pro and Video/Ingredients/Omni 1.1 Flash)
async function ensureFlowSettings({
  mode = 'image',
  flowMode = null,
  ratio = '16:9',
  resolution = null,
  clipDuration = null,
  duration = null,
  model = null,
  cdp: existingCdp = null
} = {}) {
  const effectiveMode = (mode === 'video' || flowMode === 'ingredients' || flowMode === 'frames') ? 'video' : 'image';
  if (effectiveMode === 'video') {
    const durLabel = duration || (clipDuration ? `${clipDuration} giây` : '10 giây');
    return await ensureVideoSettings({
      flowMode: flowMode || null,
      ratio: ratio || '16:9',
      resolution: resolution || '720p',
      duration: durLabel,
      clipDuration: clipDuration || 10,
      model: model || 'Omni 1.1 Flash',
      cdp: existingCdp
    });
  }

  const effectiveModel = model || 'Nano Banana Pro';
  const cdp = await getFlowClient(existingCdp);
  const settingsKey = `image:${ratio}:${effectiveModel}`;
  try {
    const triggerExists = await cdp.evaluate(`(() => {
      return !!document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
    })()`);
    if (!triggerExists) {
      throw new Error('[Flow Preflight Error] Không tìm thấy settings trigger button trên giao diện Flow (DOM rỗng hoặc chưa tải xong).');
    }

    const curSettings = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    const hasBanana = curSettings.includes('Banana');
    const hasRatio = ratio === '16:9' ? (curSettings.includes('crop_16_9') || curSettings.includes('16:9')) : (curSettings.includes('crop_9_16') || curSettings.includes('9:16'));
    const hasPro = effectiveModel === 'Nano Banana Pro' ? curSettings.includes('Pro') : true;

    if (hasBanana && hasRatio && hasPro) {
      cdp._verifiedFlowSettings = settingsKey;
      return true;
    }

    console.log(`    [-] [Flow Preflight] Tự động cấu hình chuẩn giao diện Flow: ${effectiveModel} | ${ratio}...`);

    await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      if (b) b.click();
    })()`);
    await sleep(600);

    await cdp.evaluate(`(() => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-button-toggle, .cdk-overlay-pane button, [role="radio"]'));
      const imgBtn = btns.find(b => (b.innerText || '').includes('Hình ảnh') || (b.innerText || '').includes('Image'));
      if (imgBtn) imgBtn.click();
    })()`);
    await sleep(500);

    await cdp.evaluate(`((targetRatio) => {
      const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane mat-button-toggle, .cdk-overlay-pane button, [role="radio"]'));
      const ratioBtn = btns.find(b => (b.innerText || '').includes(targetRatio));
      if (ratioBtn) ratioBtn.click();
    })(${JSON.stringify(ratio)})`);
    await sleep(500);

    if (effectiveModel === 'Nano Banana Pro') {
      await cdp.evaluate(`(() => {
        const btn = document.querySelector('button[aria-label="Chọn nhóm mô hình"], .model-select-trigger-content, [aria-label*="model"]');
        if (btn) btn.click();
      })()`);
      await sleep(600);

      await cdp.evaluate(`(() => {
        const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane mat-option'));
        const proItem = items.find(i => (i.innerText || '').toLowerCase().includes('pro'));
        if (proItem) proItem.click();
      })()`);
      await sleep(500);
    }

    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' });
    await sleep(500);

    const verified = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    if (!verified || (!verified.includes('Banana') && !verified.includes('Pro') && !verified.includes('crop'))) {
      throw new Error(`[Flow Preflight Error] Cài đặt hình ảnh chưa được xác nhận trên giao diện: "${verified || 'DOM trống'}"`);
    }

    cdp._verifiedFlowSettings = settingsKey;
    console.log(`    [✓] [Flow Preflight] Đã kích hoạt cấu hình Flow chuẩn: "${verified}"`);
    return true;
  } finally {
    cdp.close();
  }
}

// 7b. Ensure Flow Video Settings (Video, Ingredients/Thành phần, Ratio, Resolution, Duration, x1, Model)
async function ensureVideoSettings({
  flowMode = null,
  ratio = '9:16',
  resolution = null,
  duration = '10 giây',
  clipDuration = null,
  model = 'Omni 1.1 Flash',
  cdp: existingCdp = null
} = {}) {
  const cdp = await getFlowClient(existingCdp);
  const effectiveDuration = duration || (clipDuration ? `${clipDuration} giây` : '10 giây');
  const durationDigits = String(effectiveDuration).match(/\d+/)?.[0] || '10';
  const targetResLabel = resolution === '360p' ? '360p' : (resolution === '720p' ? '720p' : null);
  const wantsIngredients = flowMode === 'ingredients' || flowMode === 'thành phần';
  const settingsKey = `video:${flowMode || 'default'}:${ratio}:${targetResLabel || 'any'}:${effectiveDuration}:${model}`;
  try {
    // Ensure 'Tất cả nội dung nghe nhìn' (All media) tab is selected so flow-video-tile elements render in viewport
    await cdp.evaluate(`(() => {
      const items = Array.from(document.querySelectorAll('flow-project-nav-list mat-list-item, .mdc-list-item'));
      const allMedia = items.find(i => (i.innerText || '').includes('Tất cả nội dung') || (i.innerText || '').includes('All media'));
      if (allMedia && !allMedia.classList.contains('mdc-list-item--activated')) {
        allMedia.click();
      }
      const vp = document.querySelector('cdk-virtual-scroll-viewport');
      if (vp) vp.scrollTop = 0;
    })()`);

    const triggerExists = await cdp.evaluate(`(() => {
      if (document.querySelector('.settings-trigger-button, button.prompt-settings-trigger')) return true;
      const createBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText && (b.innerText.includes('Start Creating') || b.innerText.includes('Dự án mới') || b.innerText.includes('New Project')));
      if (createBtn) { createBtn.click(); return 'clicked_create'; }
      return false;
    })()`);
    if (triggerExists === 'clicked_create') {
      await sleep(3500);
    } else if (!triggerExists) {
      throw new Error('[Flow Preflight Error] Không tìm thấy settings trigger button trên giao diện Flow (DOM rỗng hoặc chưa tải xong).');
    }

    const curSettings = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    const hasVideo = curSettings.includes('Video') || curSettings.includes('videocam');
    const hasDuration = curSettings.includes(effectiveDuration) || curSettings.includes(durationDigits);
    const hasRatio = ratio === '9:16' ? (curSettings.includes('crop_9_16') || curSettings.includes('9:16')) : (curSettings.includes('crop_16_9') || curSettings.includes('16:9'));
    const hasRes = !targetResLabel || curSettings.includes(targetResLabel);
    const hasX1 = curSettings.includes('x1');

    // When Ingredients mode or explicit model is requested and not yet verified on this session, open popover to verify exact toggle & model
    const alreadyVerifiedExact = cdp._verifiedFlowSettings === settingsKey;
    if (hasVideo && hasDuration && hasRatio && hasRes && hasX1 && (!wantsIngredients || alreadyVerifiedExact)) {
      cdp._verifiedFlowSettings = settingsKey;
      return true;
    }

    console.log(`    [-] [Flow Preflight] Tự động cấu hình chuẩn video Flow: ${wantsIngredients ? 'Thành phần | ' : ''}${ratio} | ${targetResLabel || 'auto'} | ${effectiveDuration} | x1 (${model})...`);

    const rect = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
    })()`);
    if (rect && typeof cdp.clickMouse === 'function') {
      await cdp.clickMouse(rect.x, rect.y);
    } else {
      await cdp.evaluate(`(() => {
        const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
        if (b) b.click();
      })()`);
    }
    await sleep(600);

    const clickRadioIfUnchecked = async (matchFnSrc, argVal = null) => {
      const pt = await cdp.evaluate(`((arg) => {
        const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button[role="radio"], .cdk-overlay-pane button'));
        const matcher = ${matchFnSrc};
        const target = btns.find(b => matcher(b, arg));
        if (!target) return null;
        if (target.getAttribute('aria-checked') === 'true') return { alreadyChecked: true };
        const r = target.getBoundingClientRect();
        return (r.width > 0 && r.height > 0)
          ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }
          : { domClick: true };
      })(${JSON.stringify(argVal)})`);
      if (!pt || pt.alreadyChecked) return;
      if (pt.x !== undefined && typeof cdp.clickMouse === 'function') {
        await cdp.clickMouse(pt.x, pt.y);
      } else {
        await cdp.evaluate(`((arg) => {
          const btns = Array.from(document.querySelectorAll('.cdk-overlay-pane button[role="radio"], .cdk-overlay-pane button'));
          const matcher = ${matchFnSrc};
          const target = btns.find(b => matcher(b, arg));
          if (target) target.click();
        })(${JSON.stringify(argVal)})`);
      }
      await sleep(400);
    };

    // 1. Video mode
    await clickRadioIfUnchecked(`(b) => (b.innerText || '').includes('Video') || (b.innerText || '').includes('videocam')`);

    // 2. Ingredients (Thành phần) sub-mode if requested
    if (wantsIngredients) {
      await clickRadioIfUnchecked(`(b) => (b.innerText || '').includes('Thành phần') || (b.innerText || '').includes('Ingredients')`);
    }

    // 3. Aspect Ratio (16:9 or 9:16)
    await clickRadioIfUnchecked(`(b, r) => (b.innerText || '').includes(r)`, ratio);

    // 4. Model selector (e.g. Omni 1.1 Flash)
    if (model) {
      const needModelSwitch = await cdp.evaluate(`((targetModel) => {
        const btn = document.querySelector('.cdk-overlay-pane button[aria-label="Chọn nhóm mô hình"], .cdk-overlay-pane button[aria-label*="model"], button[aria-label="Chọn nhóm mô hình"]');
        if (!btn) return false;
        if ((btn.innerText || '').toLowerCase().includes(targetModel.toLowerCase())) return false;
        btn.click();
        return true;
      })(${JSON.stringify(model)})`);
      if (needModelSwitch) {
        await sleep(500);
        await cdp.evaluate(`((targetModel) => {
          const items = Array.from(document.querySelectorAll('.cdk-overlay-pane button, .cdk-overlay-pane [role="menuitem"], .cdk-overlay-pane [role="option"], .cdk-overlay-pane mat-option'));
          const hit = items.find(i => (i.innerText || '').toLowerCase().includes(targetModel.toLowerCase()));
          if (hit) hit.click();
        })(${JSON.stringify(model)})`);
        await sleep(450);
      }
    }

    // 5. Resolution toggle (720p / 360p)
    if (targetResLabel) {
      await clickRadioIfUnchecked(`(b, res) => (b.innerText || '').trim().startsWith(res)`, targetResLabel);
    }

    // 6. Clip Duration & Count x1
    await clickRadioIfUnchecked(`(b, d) => (b.innerText || '').includes(d.label) || (b.innerText || '').trim() === (d.digits + 's')`, { label: effectiveDuration, digits: durationDigits });
    await clickRadioIfUnchecked(`(b) => (b.innerText || '').trim() === 'x1'`);

    // Close overlay
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 27, text: '' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, text: '' });
    await sleep(500);

    const verified = await cdp.evaluate(`(() => {
      const b = document.querySelector('.settings-trigger-button, button.prompt-settings-trigger');
      return b ? b.innerText.replace(/\\s+/g, ' ').trim() : '';
    })()`);

    if (!verified || (!verified.includes('Video') && !verified.includes('videocam') && !verified.includes('crop') && !verified.includes(durationDigits))) {
      throw new Error(`[Flow Preflight Error] Cài đặt Video chưa được xác nhận trên giao diện: "${verified || 'DOM trống'}"`);
    }

    cdp._verifiedFlowSettings = settingsKey;
    console.log(`    [✓] [Flow Preflight] Đã kích hoạt cấu hình Video Flow chuẩn: "${verified.replace(/\\n/g, ' ')}"`);
    return true;
  } finally {
    cdp.close();
  }
}

// 8. Generate image via Google Flow (Nano Banana Pro) with in-browser Base64 fetch & Zero-Dupe Guard
async function generateImage({ prompt, outputPath, seenHashes = null, timeoutSec = 80, retries = 3, cdp: existingCdp = null }) {
  const cdp = await getFlowClient(existingCdp);
  try {
    await ensureFlowSettings({ mode: 'image', ratio: '16:9', model: 'Nano Banana Pro', cdp });
    for (let attempt = 1; attempt <= retries; attempt++) {
      // Wait for any pre-existing pending tile from previous shot to complete
      for (let w0 = 0; w0 < 45; w0++) {
        const stillPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (!stillPending) break;
        await sleep(1000);
      }

      const initialUrls = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('flow-image-tile img, flow-media-tile img')).slice(0, 12).map(i => i.src).filter(Boolean))()`);
      const initialSet = new Set(initialUrls || []);

      // Focus and clear ProseMirror
      const pmRect = await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        if (!pm) return null;
        const r = pm.getBoundingClientRect();
        return { x: Math.round(r.x + 20), y: Math.round(r.y + 20) };
      })()`);
      if (pmRect) await cdp.clickMouse(pmRect.x, pmRect.y);
      await sleep(80);

      await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        pm.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      })()`);
      await sleep(100);

      // Insert prompt
      await cdp.send('Input.insertText', { text: prompt });
      await cdp.evaluate(`(() => {
        const pm = document.querySelector('.ProseMirror');
        if (pm) {
          pm.dispatchEvent(new Event('input', { bubbles: true }));
          pm.dispatchEvent(new Event('change', { bubbles: true }));
          pm.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        }
      })()`);
      await sleep(350);

      // Wait for Angular to enable the generate button and click it via CDP native mouse event
      let btnRect = null;
      for (let w = 0; w < 15; w++) {
        await sleep(150);
        btnRect = await cdp.evaluate(`(() => {
          const b = document.querySelector('button[aria-label="Bắt đầu tạo"], button.generate-icon-button');
          if (!b || b.disabled || b.classList.contains('mat-mdc-button-disabled')) return null;
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) };
        })()`);
        if (btnRect) break;
      }

      if (btnRect) {
        await cdp.clickMouse(btnRect.x, btnRect.y);
      } else {
        // Fallback: send Enter key
        await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, text: '\r' });
        await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, text: '\r' });
      }

      // Wait for pending tile to appear
      let hasPending = false;
      for (let p = 0; p < 8; p++) {
        await sleep(250);
        hasPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (hasPending) break;
      }
      if (!hasPending && btnRect) {
        await cdp.clickMouse(btnRect.x, btnRect.y);
      }

      // Wait for generation to complete (pending tile disappears)
      const startWait = Date.now();
      let freshUrl = null;
      let seenPending = hasPending;

      while (Date.now() - startWait < timeoutSec * 1000) {
        await sleep(1500);

        // Track pending state
        const curPending = await cdp.evaluate('!!document.querySelector("flow-pending-tile")');
        if (curPending) seenPending = true;

        // Check for error tile or rate limit card
        const errText = await cdp.evaluate(`(() => {
          const cards = document.querySelectorAll('flow-error-tile, [class*="error"], mat-card');
          for (const c of cards) {
            if (c.innerText && (c.innerText.includes('Không thành công') || c.innerText.includes('hoạt động bất thường') || c.innerText.includes('unusual activity'))) {
              return c.innerText;
            }
          }
          return null;
        })()`);

        if (errText) {
          console.warn(`    └─ [!] Phát hiện cảnh báo giãn cách Google Flow ("${errText.replace(/\\n/g, ' ').slice(0, 50)}..."), tạm dừng 10s và tải lại trang...`);
          await sleep(10000);
          try {
            cdp._verifiedFlowSettings = null;
            await cdp.send('Page.reload');
            await sleep(5000);
            await ensureFlowSettings({ mode: 'image', ratio: '16:9', model: 'Nano Banana Pro', cdp });
          } catch {}
          break;
        }

        // Only consider the top tile completed when flow-pending-tile has vanished from the FIRST tile
        const topTileResult = await cdp.evaluate(`(() => {
          const firstTile = document.querySelector('flow-image-tile');
          if (!firstTile) return null;
          const pending = firstTile.querySelector('flow-pending-tile');
          if (pending) return { pending: true, src: null };
          const img = firstTile.querySelector('img');
          return {
            pending: false,
            src: (img && img.src && (img.src.includes('flow-content.google') || img.src.startsWith('http'))) ? img.src : null
          };
        })()`);

        if (topTileResult && !topTileResult.pending && topTileResult.src) {
          if (!initialSet.has(topTileResult.src)) {
            freshUrl = topTileResult.src;
            break;
          }
        }
      }

      if (!freshUrl) {
        console.warn(`    └─ [!] Timeout khi chờ ảnh (lần thử ${attempt}/${retries}), đang thử lại...`);
        await sleep(2000);
        continue;
      }

      // Fetch base64 directly inside Chrome session without split() array duplication
      let b64 = await cdp.evaluate(`(async (url) => {
        try {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => {
              const res = typeof r.result === 'string' ? r.result : '';
              const commaIdx = res.indexOf(',');
              r.onloadend = null;
              r.onerror = null;
              resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
            };
            r.onerror = () => {
              r.onloadend = null;
              r.onerror = null;
              resolve(null);
            };
            r.readAsDataURL(blob);
          });
        } catch { return null; }
      })(${JSON.stringify(freshUrl)})`);

      if (!b64 || b64.length < 5000) {
        b64 = null;
        console.warn(`    └─ [!] Dữ liệu base64 ảnh không hợp lệ (lần thử ${attempt}/${retries})...`);
        continue;
      }

      const buf = Buffer.from(b64, 'base64');
      b64 = null; // Free Base64 string reference immediately to prevent heap bloat
      const hash = crypto.createHash('md5').update(buf).digest('hex');

      if (seenHashes && seenHashes.has(hash)) {
        console.warn(`    └─ [!] Phát hiện ảnh trùng lặp (${hash.slice(0, 8)}...), tự động sinh lại...`);
        await sleep(2000);
        continue;
      }

      const outDir = path.dirname(outputPath);
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outputPath, buf);
      const byteSize = buf.length;
      if (seenHashes) seenHashes.add(hash);
      await pruneFlowDomMemory(cdp);
      console.log(`    [✓] Đã lưu ảnh Nano Banana Pro: ${outputPath} (${(byteSize / 1024).toFixed(1)} KB, MD5: ${hash.slice(0, 8)})`);
      return { path: outputPath, hash, size: byteSize };
    }
    throw new Error(`Thất bại khi sinh ảnh sau ${retries} lần thử!`);
  } finally {
    cdp.close();
  }
}

/**
 * Batch render all shots of a storyboard with cache checks, MD5 duplicate guards, and shared CDP session reuse.
 */
async function renderStoryboard(sb, options = {}) {
  const {
    resolution: requestedResolution = null,
    targetShots = [],
    sbPath = '',
    force = false
  } = options;

  const flowCfg = resolveFlowVideoConfig(sb, { resolution: requestedResolution || undefined });
  const resolution = flowCfg.resolution;

  const baseName = sbPath ? path.basename(sbPath, '.json') : 'storyboard';
  const rawEpisodeName = sb.series_id || (sb.project && sb.project.id ? sb.project.id : '') || sb.project_name || baseName;
  const episodeName = config.sanitizeIdentifier(rawEpisodeName, 'storyboard');
  const epRenderDir = path.resolve(config.RENDERS_DIR, episodeName);
  if (!config.isPathContained(config.RENDERS_DIR, epRenderDir)) {
    throw new Error(`Đường dẫn thư mục render không an toàn: ${epRenderDir}`);
  }
  if (!fs.existsSync(epRenderDir)) fs.mkdirSync(epRenderDir, { recursive: true });

  const isImageMode = (sb.engine === 'nano_banana_pro') || 
                      (sb.format === 'minimalist_explainer') || 
                      (sb.render_mode === 'image') ||
                      (sb.visual_engine === 'nano_banana_pro');
  const seenHashes = new Set();
  const seenVideoHashes = new Set();
  if (fs.existsSync(epRenderDir)) {
    const existingFiles = fs.readdirSync(epRenderDir);
    for (const f of existingFiles) {
      try {
        if (f.endsWith('.png')) {
          const h = crypto.createHash('md5').update(fs.readFileSync(path.join(epRenderDir, f))).digest('hex');
          seenHashes.add(h);
        } else if (f.endsWith('.mp4')) {
          const h = crypto.createHash('md5').update(fs.readFileSync(path.join(epRenderDir, f))).digest('hex');
          seenVideoHashes.add(h);
        }
      } catch {}
    }
  }

  const shots = sb.shots || [];
  console.log(`=== BẮT ĐẦU RENDER GOOGLE FLOW CHO: ${(sb.project && sb.project.title) || sb.title || episodeName} [${isImageMode ? 'NANO BANANA PRO (IMAGE)' : `${flowCfg.flowMode ? flowCfg.flowMode.toUpperCase() + ' · ' : ''}${flowCfg.ratio} · ${resolution.toUpperCase()}`}] ===`);

  let sharedCdp = null;
  let projectOpened = false;
  try {
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const rawShotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      const shotId = config.sanitizeIdentifier(rawShotId, `shot_${i + 1}`);
      if (targetShots.length > 0 && !targetShots.includes(shotId)) continue;

      const isShotImage = isImageMode || s.type === 'image' || (!s.flow_prompt && s.image_prompt);
      const ext = isShotImage ? '.png' : '.mp4';
      const outFile = path.join(epRenderDir, `${shotId}${ext}`);
      const promptText = s.image_prompt || s.flow_prompt || s.prompt || '';
      const contentHash = crypto.createHash('md5').update(promptText + ':' + (isShotImage ? 'image' : resolution)).digest('hex');
      const hashFile = path.join(epRenderDir, `.${shotId}.hash`);

      if (!force) {
        if (isShotImage) {
          if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000 && fs.existsSync(hashFile) && fs.readFileSync(hashFile, 'utf8').trim() === contentHash) {
            console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: Đã tồn tại với nội dung đồng nhất trong ${episodeName}/, bỏ qua.`);
            continue;
          }
        } else if (fs.existsSync(outFile)) {
          const existingProbe = verifyVideoFileWithFfprobe(outFile);
          if (existingProbe.valid) {
            console.log(`[✓] [${i + 1}/${shots.length}] ${shotId}: Đã tồn tại & đạt kiểm định ffprobe (${existingProbe.width}x${existingProbe.height}, ${existingProbe.duration.toFixed(2)}s), bỏ qua (dùng --force để render lại).`);
            continue;
          } else {
            console.warn(`[!] [${i + 1}/${shots.length}] ${shotId}: File hiện có không đạt ffprobe (${existingProbe.reason}), sẽ render lại.`);
          }
        }
      }

      if (!sharedCdp || !sharedCdp.isOpen()) {
        sharedCdp = await getFlowClient();
        projectOpened = false;
      }

      if (!projectOpened && flowCfg.flowProjectUrl) {
        await openFlowProject(flowCfg.flowProjectUrl, { cdp: sharedCdp });
        projectOpened = true;
      }

      console.log(`\n>>> [${i + 1}/${shots.length}] Xử lý ${shotId}...`);
      try {
        if (isShotImage) {
          console.log(`    [-] [Nano Banana Pro] Gửi câu lệnh vẽ ảnh: "${promptText.slice(0, 60)}..."`);
          await generateImage({
            prompt: promptText,
            outputPath: outFile,
            seenHashes,
            cdp: sharedCdp
          });
          try { fs.writeFileSync(hashFile, contentHash, 'utf8'); } catch {}
          await sleep(3500);
        } else {
          const maxAttempts = 3;
          let activePrompt = promptText;
          const ingredientsList = Array.isArray(s.ingredients)
            ? s.ingredients
            : (Array.isArray(s.characters) ? s.characters : []);
          const effectiveFlowMode = flowCfg.flowMode || (Array.isArray(s.ingredients) ? 'ingredients' : null);

          for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
              await ensureFlowSettings({
                mode: 'video',
                flowMode: effectiveFlowMode,
                ratio: flowCfg.ratio,
                resolution,
                clipDuration: flowCfg.clipDuration,
                duration: flowCfg.durationLabel,
                model: flowCfg.model,
                cdp: sharedCdp
              });
              await clearCharacters({ cdp: sharedCdp });
              for (const ingName of ingredientsList) {
                console.log(`    [-] Gắn thành phần chính xác: "${ingName}"`);
                await addIngredient(ingName, { cdp: sharedCdp });
              }
              console.log(`    [-] Gửi câu lệnh (lần ${attempt}/${maxAttempts}): "${activePrompt.slice(0, 50)}..."`);
              await submitPrompt(activePrompt, { cdp: sharedCdp });
              await waitForRender(240, { cdp: sharedCdp });
              await downloadLatest(outFile, { resolution, cdp: sharedCdp });

              if (fs.existsSync(outFile) && fs.statSync(outFile).size > 1000) {
                const vHash = crypto.createHash('md5').update(fs.readFileSync(outFile)).digest('hex');
                if (seenVideoHashes.has(vHash) && attempt < maxAttempts) {
                  console.warn(`    [!] Phát hiện video trùng MD5 (${vHash.slice(0, 8)}), tự động render lại ${shotId}...`);
                  try { fs.unlinkSync(outFile); } catch {}
                  await sleep(3000);
                  continue;
                }
                seenVideoHashes.add(vHash);
              }

              try { fs.writeFileSync(hashFile, contentHash, 'utf8'); } catch {}
              await pruneFlowDomMemory(sharedCdp);
              break;
            } catch (shotErr) {
              console.warn(`    [!] Lỗi ở lần thử ${attempt}/${maxAttempts} cho ${shotId}: ${shotErr.message}`);
              await clearCharacters({ cdp: sharedCdp }).catch(() => {});

              const errKind = classifyFlowShotError(shotErr.message);
              if (errKind === 'insufficient_credits') {
                throw shotErr;
              }

              const isUnusual = errKind === 'unusual_activity';
              const isTimeout = errKind === 'timeout';

              if (isUnusual || isTimeout) {
                console.log(`    [-] Phát hiện lỗi Flow (${isUnusual ? 'hoạt động bất thường' : 'Timeout'}). Đang dọn dẹp thẻ lỗi và tải lại trang để làm mới phiên làm việc...`);
                try {
                  await sharedCdp.evaluate(`(() => {
                    const tiles = Array.from(document.querySelectorAll('flow-video-tile'));
                    for (const t of tiles) {
                      if ((t.innerText || '').includes('hoạt động bất thường') || (t.innerText || '').includes('Không thành công')) {
                        const delBtn = Array.from(t.querySelectorAll('button')).find(b => (b.innerText || '').includes('delete_forever') || b.getAttribute('aria-label') === 'Xóa' || b.getAttribute('aria-label') === 'Delete');
                        if (delBtn) delBtn.click();
                      }
                    }
                  })()`);
                  await sleep(1000);
                  await sharedCdp.evaluate(`(() => {
                    const confirmBtn = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="dialog"] button, [role="alertdialog"] button')).find(b => (b.innerText || '').includes('Xóa') || (b.innerText || '').includes('Delete'));
                    if (confirmBtn) confirmBtn.click();
                  })()`).catch(() => {});
                } catch {}

                console.log('    [-] Đang reload lại tab Google Flow (Page.reload) và chờ 18s...');
                try {
                  await sharedCdp.send('Page.reload');
                } catch {}
                await sleep(18000);
              }

              if (attempt < maxAttempts) {
                activePrompt = activePrompt
                  .replace(/\bcollapsed\b/gi, 'abandoned')
                  .replace(/\btilted in the mud trailing thick black smoke\b/gi, 'parked in the muddy field')
                  .replace(/\bthick black smoke\b/gi, 'morning mist')
                  .replace(/\bbarbed-wire\b/gi, 'wooden perimeter')
                  .replace(/\bbombardment\b/gi, 'storm');
                await sleep(4000);
              } else {
                throw shotErr;
              }
            }
          }
        }
      } catch (err) {
        console.error(`    [!] Lỗi khi xử lý ${shotId}: ${err.message}`);
      }
    }
  } finally {
    if (sharedCdp) {
      sharedCdp.close(true);
    }
  }
  console.log('\n✓ Hoàn tất lượt render Google Flow!');
}

// Pure helper: decide whether Flow UI signals (warning button aria-label / credit banner text) mean out of credits
function detectInsufficientCredits(state = {}) {
  const warnLabel = String((state && state.warnLabel) || '');
  const bannerText = String((state && state.bannerText) || '');
  const warnLower = warnLabel.toLowerCase();
  const bannerLower = bannerText.toLowerCase();
  const warnHit = warnLower.includes('tín dụng') || warnLower.includes('credit');
  const bannerHit = bannerLower.includes('hết tín dụng') || bannerLower.includes('out of credits') ||
    bannerLower.includes('not enough credits') || bannerLower.includes('insufficient credits');
  if (warnHit || bannerHit) {
    return { outOfCredits: true, msg: (warnHit ? warnLabel : bannerText).replace(/[\r\n]+/g, ' ').trim() };
  }
  return { outOfCredits: false, msg: '' };
}

// Pure helper: classify a shot render error to decide between abort, session recovery, or plain retry
function classifyFlowShotError(message) {
  const msg = String(message || '');
  const lower = msg.toLowerCase();
  if (lower.includes('insufficient credits') || lower.includes('tín dụng')) return 'insufficient_credits';
  if (lower.includes('hoạt động bất thường') || lower.includes('unusual activity') || lower.includes('tiện ích trình duyệt')) {
    return 'unusual_activity';
  }
  if (lower.includes('timeout')) return 'timeout';
  return 'other';
}

module.exports = {
  detectInsufficientCredits,
  classifyFlowShotError,
  normalizeIngredientLabel,
  matchExactIngredientOption,
  verifyVideoFileWithFfprobe,
  getCandidateDownloadDirs,
  findLatestMp4InDirs,
  resolveFlowVideoConfig,
  buildCharacterRouteUrl,
  openFlowProject,
  listExistingProjectCharacters,
  createCharacterAssets,
  getFlowClient,
  pruneFlowDomMemory,
  getStatus,
  clearCharacters,
  addIngredient,
  addCharacter,
  submitPrompt,
  waitForRender,
  downloadLatest,
  downloadCloud1080p,
  downloadLatestDirect,
  generateImage,
  ensureFlowSettings,
  ensureVideoSettings,
  renderStoryboard
};
