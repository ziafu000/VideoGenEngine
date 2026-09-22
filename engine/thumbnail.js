const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { getClientForPage, sleep } = require('./cdp');
const config = require('./config');

/**
 * engine/thumbnail.js: Automated 16:9 YouTube Thumbnail Generator via Google Flow (Nano Banana Pro).
 *
 * Supports generating a batch of 4 high-CTR cinematic 16:9 thumbnails, downloading signed CDN URLs,
 * upscaling to standard 1920x1080 Full HD, and syncing to Windows storage and Downloads.
 */

function craftThumbnailPrompt(sb) {
  const p = sb.project || {};
  const series = p.series || 'Anime Series';
  const ep = p.episode || 1;
  const title = p.title || `Episode ${ep}`;

  // If storyboard defines a custom thumbnail_prompt in project metadata, prioritize it!
  if (p.thumbnail_prompt) {
    return p.thumbnail_prompt;
  }

  return `Widescreen 16:9 anime key visual thumbnail for dark fantasy sci-fi anime "${series}" Episode ${ep}: "${title}". Young cyber swordsman hero with silver-white hair and glowing cyan eye in battle-damaged silver and black armor. Intense sharp gaze directly at the camera. In the background, a massive dark dimensional portal vortex tearing the sky with purple and dark blue energy storm. Glowing cyan holographic tech HUD glyphs floating in the air. High contrast, dramatic rim lighting, embers and glowing data particles, Ufotable anime style, 8k resolution, ultra detailed, cinematic YouTube anime thumbnail.`;
}

// Helper: Classify thumbnail prompt refusal or error using TypeSafe Jev
function classifyThumbnailRefusal(text) {
  if (!text || text.trim().length === 0) return { choice: 'neutral', confidence: 1.0 };
  try {
    const states = JSON.stringify({
      refusal: "prompt was refused, blocked or violates safety policy or terms",
      error: "system error, capacity limit or generation failure occurred",
      neutral: "normal generation or progress status"
    });
    const out = execSync(`browser-jev classify --states ${JSON.stringify(states)} --text ${JSON.stringify(text)}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000
    });
    return JSON.parse(out);
  } catch {
    const lower = text.toLowerCase();
    if (lower.includes('không thành công') || lower.includes('vi phạm') || lower.includes('policy') || lower.includes('violate') || lower.includes('blocked') || lower.includes('failed')) {
      return { choice: 'refusal', confidence: 0.9 };
    }
    return { choice: 'neutral', confidence: 0.8 };
  }
}

async function generateThumbnails({ prompt, storyboard, projectId }) {
  let finalPrompt = prompt;

  if (!finalPrompt && storyboard) {
    finalPrompt = craftThumbnailPrompt(storyboard);
  }

  if (!finalPrompt || typeof finalPrompt !== 'string') {
    throw new Error('Cần cung cấp câu lệnh prompt hoặc file storyboard chứa thông tin thumbnail!');
  }

  const pid = projectId || (storyboard && storyboard.project && storyboard.project.series
    ? `${storyboard.project.series}_ep${String(storyboard.project.episode || 1).padStart(2, '0')}`.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    : 'custom');

  // Pre-flight screening with TypeSafe Jev if available
  try {
    const jevOut = execSync(`browser-jev screen-prompt ${JSON.stringify(finalPrompt)}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const parsed = JSON.parse(jevOut);
    if (parsed.safe === false && parsed.risk_score > 0.70) {
      console.warn(`[!] CẢNH BÁO JEV: Prompt thumbnail có rủi ro chính sách (${parsed.risk_score}): ${parsed.reason}`);
    }
  } catch {}

  console.log(`[-] Dự án: ${pid}`);
  console.log(`[-] Prompt: "${finalPrompt.slice(0, 80)}..."`);
  console.log('[-] Kết nối Google Flow tab qua Chrome CDP...');
  const cdp = await getClientForPage('flow.google.com');

  try {
    // 1. Snapshot existing images
    const initialImages = await cdp.evaluate(`
      (() => {
        return Array.from(document.querySelectorAll('flow-image-tile, flow-media-tile'))
          .map(el => {
            const img = el.querySelector('img');
            return img && img.src ? img.src : (el.src || null);
          })
          .filter(Boolean);
      })()
    `);
    const initialSet = new Set(initialImages || []);
    console.log(`[-] Đã ghi nhận ${initialSet.size} ảnh sẵn có trong thư viện Flow.`);

    // 2. Clear input and enter prompt via native CDP
    console.log('[-] Nhập prompt Thumbnail vào ô lệnh Flow...');
    await cdp.evaluate(`
      (() => {
        const pm = document.querySelector('.ProseMirror');
        if (pm) {
          pm.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        }
      })()
    `);
    await sleep(200);
    await cdp.send('Input.insertText', { text: finalPrompt });
    await sleep(400);

    // 3. Dispatch Enter key and click generate button
    const btnRect = await cdp.evaluate(`
      (() => {
        const btn = document.querySelector('button[aria-label="Bắt đầu tạo"], button.generate-icon-button');
        if (!btn || btn.disabled) return null;
        const r = btn.getBoundingClientRect();
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
      })()
    `);

    if (!btnRect) {
      throw new Error('Nút "Bắt đầu tạo" bị vô hiệu hóa hoặc không tìm thấy!');
    }

    // Press Enter and click
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, unmodifiedText: '\r', text: '\r' });
    await cdp.clickMouse(btnRect.x, btnRect.y);
    console.log('[✓] Đã kích hoạt Nano Banana Pro tạo 4 ảnh (crop_16_9 x4)...');

    // 4. Poll for generation completion (up to 3 mins)
    const startTime = Date.now();
    let newUrls = [];

    while (Date.now() - startTime < 180000) {
      await sleep(2500);

      const status = await cdp.evaluate(`
        (() => {
          const pending = document.querySelectorAll('flow-pending-tile, [class*="pending"], [class*="generating"], .shimmer');
          const tiles = Array.from(document.querySelectorAll('flow-image-tile, flow-media-tile'));
          const images = tiles.map(t => {
            const img = t.querySelector('img');
            return img && img.src && !img.src.startsWith('data:') ? img.src : (t.src || null);
          }).filter(Boolean);

          const errorEl = Array.from(document.querySelectorAll('*'))
            .map(e => e.innerText || '')
            .find(t => t.includes('Không thành công') || t.includes('vi phạm') || t.includes('failed') || t.includes('policy'));

          return {
            pendingCount: pending.length,
            images,
            error: errorEl || null
          };
        })()
      `);

      if (status.error) {
        const jRef = classifyThumbnailRefusal(status.error);
        if (jRef.choice === 'refusal' || jRef.choice === 'error') {
          throw new Error(`Google Flow từ chối prompt Thumbnail [TypeSafe Jev: ${jRef.choice}]: ${status.error}`);
        }
      }

      const freshImages = status.images.filter(src => !initialSet.has(src));
      const uniqueFresh = Array.from(new Set(freshImages));
      console.log(`    ... Tiến độ: ${uniqueFresh.length}/4 ảnh mới hoàn thành (Pending: ${status.pendingCount})`);

      if (uniqueFresh.length >= 4 && status.pendingCount === 0) {
        newUrls = uniqueFresh.slice(0, 4);
        break;
      }
    }

    if (newUrls.length === 0) {
      throw new Error('Hết thời gian chờ (timeout) tạo thumbnail!');
    }

    // 5. Download and upscale
    const outDirLocal = path.join(config.PROJECT_DIR, 'assets', 'thumbnails', pid);
    const outDirWin = path.join('/mnt/d/Billy/Work/Editing/File video after edit/thumbnails', pid);
    const outDirDownloads = path.join('/mnt/c/Users/ASUS/Downloads', `thumbnails_${pid}`);

    for (const d of [outDirLocal, outDirWin, outDirDownloads]) {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    }

    const savedFiles = [];

    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      const optNum = i + 1;
      const rawJpg = path.join('/tmp', `raw_thumb_${pid}_${optNum}.jpg`);
      execSync(`curl -s ${JSON.stringify(url)} -o ${JSON.stringify(rawJpg)}`);

      const fileNameFhd = `${pid}_thumb_opt${optNum}_1080p.jpg`;
      const localFhd = path.join(outDirLocal, fileNameFhd);
      const winFhd = path.join(outDirWin, fileNameFhd);
      const dlFhd = path.join(outDirDownloads, fileNameFhd);

      // Scale to 1920x1080 Full HD
      execSync(`ffmpeg -y -i ${JSON.stringify(rawJpg)} -vf "scale=1920:1080:flags=lanczos" -q:v 1 ${JSON.stringify(localFhd)} 2>/dev/null`);
      fs.copyFileSync(localFhd, winFhd);
      fs.copyFileSync(localFhd, dlFhd);

      savedFiles.push({
        option: optNum,
        local: localFhd,
        win: winFhd,
        downloads: dlFhd
      });

      console.log(`[✓] Thumbnail ${optNum} (1920x1080): ${localFhd}`);
    }

    return savedFiles;
  } finally {
    cdp.close();
  }
}

module.exports = {
  generateThumbnails,
  craftThumbnailPrompt
};
