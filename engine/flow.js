const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');

async function getFlowClient() {
  return await getClientForPage('flow.google.com');
}

// 1. Get status of Google Flow UI
async function getStatus() {
  const cdp = await getFlowClient();
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

// 2. Clear attached characters and prompt text
async function clearCharacters() {
  const cdp = await getFlowClient();
  try {
    return await cdp.evaluate(`(() => {
      const cancelButtons = Array.from(document.querySelectorAll('flow-ingredient-bar button, .ingredient-bar button, flow-ingredient-chip button, flow-ingredient-chip mat-icon')).filter(b => 
        b.innerText && (b.innerText.includes('cancel') || b.innerText.includes('close'))
      );
      cancelButtons.forEach(b => b.click());

      const clearBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText && b.innerText.includes('Xoá câu lệnh'));
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

// 3. Add character ingredient chip (@Character)
async function addCharacter(charName) {
  const cdp = await getFlowClient();
  try {
    const res = await cdp.evaluate(`(async () => {
      const pm = document.querySelector('.ProseMirror');
      if (!pm) return { error: 'Không tìm thấy ô nhập prompt .ProseMirror' };

      pm.focus();
      document.execCommand('insertText', false, '@');
      await new Promise(r => setTimeout(r, 400));

      const options = Array.from(document.querySelectorAll('.cdk-overlay-pane button, [role="option"]'));
      const target = options.find(o => (o.innerText || '').toLowerCase().includes(${JSON.stringify(charName.toLowerCase())}));
      if (!target) return { error: 'Không tìm thấy nhân vật ' + ${JSON.stringify(charName)} + ' trong menu' };
      target.click();

      await new Promise(r => setTimeout(r, 400));
      const insertBtn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Thêm vào câu lệnh'));
      if (insertBtn) insertBtn.click();

      await new Promise(r => setTimeout(r, 400));
      const chips = Array.from(pm.querySelectorAll('.mention-chip')).map(c => c.innerText.trim());
      return { ok: true, character: ${JSON.stringify(charName)}, chipsInPrompt: chips };
    })()`);
    return res;
  } finally {
    cdp.close();
  }
}

// 4. Submit prompt with Zero Physical Descriptors check & chip preservation
async function submitPrompt(promptText) {
  // Pre-flight prompt screening with TypeSafe Jev if available
  try {
    const jevOut = execSync(`browser-jev screen-prompt ${JSON.stringify(promptText)}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = JSON.parse(jevOut);
    if (parsed.safe === false && parsed.risk_score > 0.70) {
      console.warn(`[!] CẢNH BÁO TYPESAFE JEV: Prompt có rủi ro chính sách cao (${parsed.risk_score}): ${parsed.reason}`);
    }
  } catch {}

  const cdp = await getFlowClient();
  try {
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

      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      return {
        ok: true,
        textEntered: pm.innerText.trim().slice(0, 60) + '...',
        chipsCount: pm.querySelectorAll('.mention-chip').length,
        readyToSubmit: genBtn ? !genBtn.disabled : false
      };
    })()`);

    await sleep(1000);

    const clickRes = await cdp.evaluate(`(() => {
      const genBtn = document.querySelector('button.generate-icon-button, button[aria-label="Start generation"], button[aria-label="Bắt đầu tạo"]');
      if (genBtn && !genBtn.disabled) {
        genBtn.click();
        return { submitted: true };
      }
      return { submitted: false, reason: 'Generate button not ready or disabled' };
    })()`);

    return { ...inputRes, ...clickRes };
  } finally {
    cdp.close();
  }
}

// 5. Wait for render to complete (pending tile appears then disappears)
async function waitForRender(timeoutSec = 240) {
  const cdp = await getFlowClient();
  try {
    let hasSeenPending = false;
    const start = Date.now();
    process.stdout.write('[-] Đang render trên Google Flow: ');

    while ((Date.now() - start) < timeoutSec * 1000) {
      await sleep(3000);
      const state = await cdp.evaluate(`(() => {
        const pending = document.querySelector('flow-pending-tile');
        const err = document.querySelector('.error-message, [role="alert"]');
        const refusal = Array.from(document.querySelectorAll('*')).find(el => el.innerText && el.innerText.includes('Không thành công'));
        const tiles = document.querySelectorAll('flow-video-tile');

        return {
          hasPending: !!pending,
          pendingText: pending ? pending.innerText.trim().replace(/[\\r\\n]+/g, ' ') : '',
          error: err ? err.innerText.trim() : null,
          refusal: refusal ? refusal.innerText.trim() : null,
          totalTiles: tiles.length
        };
      })()`);

      if (state.refusal) {
        process.stdout.write('\n');
        throw new Error(`Google Flow từ chối câu lệnh chính sách: ${state.refusal}`);
      }

      if (state.hasPending) {
        hasSeenPending = true;
        process.stdout.write('*');
      } else if (hasSeenPending) {
        process.stdout.write(' ✓ XONG!\n');
        return true;
      } else {
        process.stdout.write('.');
      }
    }

    process.stdout.write('\n');
    throw new Error(`Timeout ${timeoutSec}s khi chờ Google Flow render!`);
  } finally {
    cdp.close();
  }
}

// 6. Download latest rendered video via signed CDN URL
async function downloadLatest(targetFile) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const cdp = await getFlowClient();
  try {
    let videoSrc = null;
    for (let i = 0; i < 8; i++) {
      videoSrc = await cdp.evaluate(`(() => {
        const tile = document.querySelector('flow-video-tile');
        if (!tile) return null;
        tile.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        tile.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const container = tile.querySelector('.container');
        if (container) container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        const v = tile.querySelector('video');
        return v && v.src && v.src.startsWith('http') ? v.src : null;
      })()`);

      if (videoSrc) break;
      await sleep(600);
    }

    if (!videoSrc) {
      throw new Error('Không lấy được Direct Signed CDN URL từ thẻ video Flow!');
    }

    console.log(`    [-] Tải nhanh qua Direct CDN: ${videoSrc.slice(0, 60)}...`);
    execSync(`curl -s -f -L ${JSON.stringify(videoSrc)} -o ${JSON.stringify(targetFile)}`);

    if (!fs.existsSync(targetFile) || fs.statSync(targetFile).size < 1000) {
      throw new Error(`File tải về không hợp lệ hoặc rỗng: ${targetFile}`);
    }
    console.log(`    [✓] Đã lưu video thành công: ${targetFile} (${(fs.statSync(targetFile).size / 1024 / 1024).toFixed(2)} MB)`);
    return targetFile;
  } finally {
    cdp.close();
  }
}

module.exports = {
  getStatus,
  clearCharacters,
  addCharacter,
  submitPrompt,
  waitForRender,
  downloadLatest
};
