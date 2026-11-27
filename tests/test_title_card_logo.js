const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');
const compositor = require('../engine/compositor');

/**
 * Pure-Node RGBA PNG writer for deterministic synthetic test fixtures (zero external deps).
 */
function writeSyntheticRgbaPng(filePath, width, height, pixelFn) {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const makeChunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 4 + 1);
    rawRows[rowStart] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelFn(x, y, width, height);
      const px = rowStart + 1 + x * 4;
      rawRows[px] = r;
      rawRows[px + 1] = g;
      rawRows[px + 2] = b;
      rawRows[px + 3] = a;
    }
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const png = Buffer.concat([
    signature,
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', zlib.deflateSync(rawRows)),
    makeChunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(filePath, png);
}

function sampleFrameRgb(videoPath, timestampSec, width, height) {
  return execFileSync('ffmpeg', [
    '-nostdin', '-v', 'error',
    '-ss', String(timestampSec),
    '-i', videoPath,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    '-'
  ], { maxBuffer: width * height * 3 + 65536 });
}

function getPixel(rgbBuf, width, x, y) {
  const idx = (y * width + x) * 3;
  return [rgbBuf[idx], rgbBuf[idx + 1], rgbBuf[idx + 2]];
}

console.log('=== RUNNING TITLE CARD LOGO OVERLAY & SCRIM TEST SUITE ===\n');

(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vg-title-logo-test-'));
  try {
    // 1. Create synthetic RGBA PNG with transparent outer border and opaque red emblem center
    console.log('Test 1: Synthetic RGBA PNG fixture probe (dimensions & non-zero alpha channel)...');
    const logoPng = path.join(tmpDir, 'synthetic_emblem.png');
    writeSyntheticRgbaPng(logoPng, 160, 160, (x, y, w, h) => {
      const dx = x - w / 2;
      const dy = y - h / 2;
      const insideCircle = (dx * dx + dy * dy) <= (48 * 48);
      if (insideCircle) {
        return [230, 30, 30, 255]; // opaque red emblem core
      }
      return [0, 0, 0, 0]; // fully transparent outer background
    });

    const probe = compositor.probeImageStream(logoPng);
    assert.strictEqual(probe.valid, true, `Synthetic logo PNG must be valid: ${probe.reason}`);
    assert.strictEqual(probe.width, 160);
    assert.strictEqual(probe.height, 160);
    assert.strictEqual(probe.hasAlpha, true, `Expected alpha pix_fmt, got ${probe.pixFmt}`);

    const missingProbe = compositor.probeImageStream(path.join(tmpDir, 'does_not_exist.png'));
    assert.strictEqual(missingProbe.valid, false);
    assert.strictEqual(missingProbe.reason, 'file_not_found');
    console.log(`  [PASS] Probed synthetic PNG: ${probe.width}x${probe.height} (${probe.pixFmt}, hasAlpha=${probe.hasAlpha}).\n`);

    // 2. Filter graph unit checks with & without logo_path
    console.log('Test 2: buildSilentCinemaFilterGraph with and without logo_path + defaults...');
    const titleTxt = path.join(tmpDir, 'title.txt');
    const subTxt = path.join(tmpDir, 'sub.txt');
    fs.writeFileSync(titleTxt, 'SAMPLE CINEMA TITLE', 'utf8');
    fs.writeFileSync(subTxt, 'Sample Director', 'utf8');

    const gNoLogo = compositor.buildSilentCinemaFilterGraph({
      clips: [{ duration: 6.0, hasAudio: true }],
      width: 1920,
      height: 1080,
      fps: 30,
      hasBgm: false,
      titleCard: { titleTextFile: titleTxt, subtitleTextFile: subTxt, start: 1.0, end: 5.0, fade: 0.8 }
    });
    assert.ok(!gNoLogo.filterComplex.includes('[title_logo]'), 'Must NOT emit [title_logo] when logo_path is omitted');
    assert.ok(gNoLogo.filterComplex.includes('[title_scrim]'), 'Must emit soft translucent [title_scrim] behind title text');
    assert.ok(gNoLogo.filterComplex.includes('y=(h*0.41-text_h/2)'), 'Must keep backward-compatible title Y expression without logo');

    const gWithLogoAndBgm = compositor.buildSilentCinemaFilterGraph({
      clips: [{ duration: 6.0, hasAudio: true }],
      width: 1920,
      height: 1080,
      fps: 30,
      hasBgm: true,
      bgmVolume: 0.8,
      titleCard: {
        titleTextFile: titleTxt,
        subtitleTextFile: subTxt,
        logo_path: logoPng,
        start: 1.0,
        end: 5.5,
        fade: 0.8
      }
    });
    assert.ok(gWithLogoAndBgm.filterComplex.includes('[2:v]format=rgba,scale=1536:130:force_original_aspect_ratio=decrease:flags=lanczos'), 'Default logo_height=130 and input index after BGM expected');
    assert.ok(gWithLogoAndBgm.filterComplex.includes('fade=t=in:st=1.000:d=0.800:alpha=1,fade=t=out:st=4.700:d=0.800:alpha=1[title_logo]'), 'Logo must match title fade-in/out with alpha=1');
    assert.ok(gWithLogoAndBgm.filterComplex.includes("[title_logo]overlay=x=(W-w)/2:y="), 'Logo must be horizontally centered above title text');
    assert.ok(gWithLogoAndBgm.filterComplex.includes('[title_scrim]'), 'Must include translucent scrim behind title text');

    const gCustomLogoGap = compositor.buildSilentCinemaFilterGraph({
      clips: [{ duration: 6.0, hasAudio: true }],
      width: 1920,
      height: 1080,
      fps: 30,
      hasBgm: false,
      titleCard: {
        titleTextFile: titleTxt,
        logo_path: logoPng,
        logo_height: 100,
        logo_gap: 40,
        start: 0.5,
        end: 4.5,
        fade: 0.5
      }
    });
    assert.ok(gCustomLogoGap.filterComplex.includes('[1:v]format=rgba,scale=1536:100:'), 'Custom logo_height=100 and input index 1 without BGM expected');
    console.log('  [PASS] Filter graph generation verified for logo_path, logo_height, logo_gap, scrim, and fallback.\n');

    // 3. End-to-end compositeSilentCinema with logo_path, without logo_path, and with missing logo_path
    console.log('Test 3: End-to-end compositeSilentCinema with synthetic RGBA logo, scrim, and clean fallbacks...');
    const brightClip = path.join(tmpDir, 'bright_canopy.mp4');
    const outWithLogo = path.join(tmpDir, 'out_with_logo.mp4');
    const outNoLogo = path.join(tmpDir, 'out_no_logo.mp4');
    const outMissingLogo = path.join(tmpDir, 'out_missing_logo.mp4');

    execFileSync('ffmpeg', [
      '-nostdin', '-y',
      '-f', 'lavfi', '-i', 'color=c=#90d878:s=1280x720:r=24:d=2.4',
      '-f', 'lavfi', '-i', 'sine=f=440:d=2.4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac',
      brightClip
    ], { stdio: 'ignore' });

    const resWithLogo = await compositor.compositeSilentCinema({
      videoFiles: [brightClip],
      outputVideoPath: outWithLogo,
      width: 1280,
      height: 720,
      fps: 24,
      xfadeDuration: 0,
      sfxVolume: 0.3,
      bgmPath: null,
      titleCard: {
        title: 'TIÊU ĐỀ THỬ NGHIỆM',
        subtitle: 'Phụ đề tiếng Việt có dấu',
        logo_path: logoPng,
        logo_height: 120,
        logo_gap: 22,
        start: 0.4,
        end: 2.0,
        fade: 0.25
      }
    });
    assert.strictEqual(resWithLogo.width, 1280);
    assert.strictEqual(resWithLogo.height, 720);
    assert.ok(resWithLogo.duration >= 2.2 && resWithLogo.duration <= 2.6);

    // Pixel-level verification:
    // At t=0.05 (before start=0.4), frame should be bright green (~144,216,120).
    // At t=1.20 (peak visibility), center of logo should be strong red (>180, <80, <80),
    // while transparent top-left corner of logo box should stay green (not opaque black/white),
    // and title scrim zone should be visibly darkened relative to un-scrimmed background.
    const preFrame = sampleFrameRgb(outWithLogo, 0.05, 1280, 720);
    const midFrame = sampleFrameRgb(outWithLogo, 1.20, 1280, 720);

    // Compute exact expected logo Y matching buildSilentCinemaFilterGraph at 1280x720:
    // titleSize = round(720 * 0.068) = 49, subSize = round(720 * 0.032) = 23, subGap = round(23*0.85) = 20
    // textBlockH = 49 + 20 + 23 = 92; totalBlockH = 120 + 22 + 92 = 234; blockCenterY = round(720*0.48) = 346
    // logoY = round(346 - 117) = 229 -> logo center is (640, 229 + 60 = 289)
    const logoCenterBefore = getPixel(preFrame, 1280, 640, 289);
    const logoCenterDuring = getPixel(midFrame, 1280, 640, 289);
    const logoCornerDuring = getPixel(midFrame, 1280, 640 - 54, 229 + 6); // transparent corner inside 120x120 logo box

    assert.ok(logoCenterBefore[1] > logoCenterBefore[0] + 30, `Pre-title pixel should be green, got ${logoCenterBefore}`);
    assert.ok(logoCenterDuring[0] > 170 && logoCenterDuring[1] < 90, `Logo center must show red emblem during title card, got ${logoCenterDuring}`);
    assert.ok(logoCornerDuring[1] > logoCornerDuring[0] + 20, `Transparent logo corner must preserve green background (alpha compositing), got ${logoCornerDuring}`);

    // Scrim region check (left of centered title text at y=400, x=360 — clear of text glyphs, inside scrim band)
    const scrimBefore = getPixel(preFrame, 1280, 360, 400);
    const scrimDuring = getPixel(midFrame, 1280, 360, 400);
    const lumaBefore = 0.299 * scrimBefore[0] + 0.587 * scrimBefore[1] + 0.114 * scrimBefore[2];
    const lumaDuring = 0.299 * scrimDuring[0] + 0.587 * scrimDuring[1] + 0.114 * scrimDuring[2];
    assert.ok(lumaDuring < lumaBefore - 20, `Translucent scrim must darken bright background behind title text (before=${lumaBefore.toFixed(1)}, during=${lumaDuring.toFixed(1)})`);

    // Case B: Omitted logo_path (clean fallback)
    const resNoLogo = await compositor.compositeSilentCinema({
      videoFiles: [brightClip],
      outputVideoPath: outNoLogo,
      width: 1280,
      height: 720,
      fps: 24,
      xfadeDuration: 0,
      sfxVolume: 0.3,
      bgmPath: null,
      titleCard: {
        title: 'TIÊU ĐỀ KHÔNG LOGO',
        subtitle: 'Kiểm tra fallback sạch',
        start: 0.4,
        end: 2.0,
        fade: 0.25
      }
    });
    assert.strictEqual(resNoLogo.width, 1280);
    assert.strictEqual(resNoLogo.height, 720);
    const noLogoMid = sampleFrameRgb(outNoLogo, 1.20, 1280, 720);
    const noLogoTop = getPixel(noLogoMid, 1280, 640, 200);
    assert.ok(noLogoTop[1] > noLogoTop[0] + 20, `Without logo, upper region stays green, got ${noLogoTop}`);

    // Case C: Non-existent logo_path (graceful fallback without throwing)
    const resMissingLogo = await compositor.compositeSilentCinema({
      videoFiles: [brightClip],
      outputVideoPath: outMissingLogo,
      width: 1280,
      height: 720,
      fps: 24,
      xfadeDuration: 0,
      sfxVolume: 0.3,
      bgmPath: null,
      titleCard: {
        title: 'TIÊU ĐỀ FALLBACK',
        logo_path: path.join(tmpDir, 'nonexistent_logo.png'),
        start: 0.4,
        end: 2.0,
        fade: 0.25
      }
    });
    assert.strictEqual(resMissingLogo.width, 1280);
    assert.strictEqual(resMissingLogo.height, 720);
    console.log('  [PASS] End-to-end alpha logo overlay, translucent scrim, and clean fallbacks verified.\n');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  console.log('=== ALL TITLE CARD LOGO OVERLAY TESTS PASSED ===');
})().catch((err) => {
  console.error('\n[FAIL] Title card logo test suite failed:', err);
  process.exit(1);
});
