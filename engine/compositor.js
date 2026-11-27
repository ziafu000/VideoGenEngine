const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const config = require('./config');

const durationCache = new Map();

function getDuration(filePath) {
  if (!filePath) return 0.0;
  const key = String(filePath);
  if (durationCache.has(key)) return durationCache.get(key);
  try {
    const winPath = config.toWinPath(filePath);
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      winPath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10000 }).trim();
    const val = parseFloat(out);
    const res = isNaN(val) ? 0.0 : val;
    if (res > 0) durationCache.set(key, res);
    return res;
  } catch {
    return 0.0;
  }
}

function hasAudioStream(filePath) {
  try {
    const winPath = config.toWinPath(filePath);
    const out = execFileSync('ffprobe', [
      '-v', 'error',
      '-select_streams', 'a',
      '-show_entries', 'stream=index',
      '-of', 'csv=p=0',
      winPath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out.length > 0;
  } catch {
    return false;
  }
}

function probeVideoStream(filePath, execFn = execFileSync) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { valid: false, reason: 'file_not_found' };
  }
  const size = fs.statSync(filePath).size;
  if (size < 1024) {
    return { valid: false, reason: 'file_too_small', size };
  }
  try {
    const winPath = config.toWinPath(filePath);
    const raw = execFn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-show_entries', 'format=duration',
      '-of', 'json',
      winPath
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 });
    const parsed = JSON.parse(raw || '{}');
    const vStream = (parsed.streams || []).find(s => s.codec_type === 'video');
    const duration = parseFloat(parsed.format && parsed.format.duration);
    if (!vStream || !Number.isFinite(duration) || duration <= 0) {
      return { valid: false, reason: 'missing_video_stream_or_duration' };
    }
    return {
      valid: true,
      codec: vStream.codec_name || 'unknown',
      width: Number(vStream.width) || 0,
      height: Number(vStream.height) || 0,
      duration,
      size
    };
  } catch (err) {
    return { valid: false, reason: err.message || 'ffprobe_failed' };
  }
}

/**
 * Detect whether a storyboard uses Silent-Cinema / Music-Driven mode (no TTS voiceover).
 */
function isSilentCinemaStoryboard(sb) {
  if (!sb || typeof sb !== 'object') return false;
  if (sb.mode === 'cinema_silent') return true;
  if (sb.tts === false) return true;
  if (sb.project && (sb.project.mode === 'cinema_silent' || sb.project.tts === false)) return true;
  return false;
}

/**
 * Locate a verified Unicode-capable TTF font (supports full Vietnamese UTF-8 diacritics).
 */
function resolveUnicodeFont(options = {}) {
  const style = options.style || 'regular';
  const preferredPath = options.preferredPath || null;
  const existsFn = typeof options.existsFn === 'function' ? options.existsFn : (p) => fs.existsSync(p);

  const byStyle = {
    bold: [
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf',
      '/mnt/c/Windows/Fonts/timesbd.ttf',
      '/mnt/c/Windows/Fonts/georgiab.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
      '/mnt/c/Windows/Fonts/segoeuib.ttf',
      'C:\\Windows\\Fonts\\timesbd.ttf',
      '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf'
    ],
    italic: [
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Italic.ttf',
      '/mnt/c/Windows/Fonts/timesi.ttf',
      '/mnt/c/Windows/Fonts/georgiai.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Italic.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      'C:\\Windows\\Fonts\\timesi.ttf',
      '/System/Library/Fonts/Supplemental/Times New Roman Italic.ttf'
    ],
    regular: [
      '/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
      '/mnt/c/Windows/Fonts/times.ttf',
      '/mnt/c/Windows/Fonts/georgia.ttf',
      '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
      '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
      '/mnt/c/Windows/Fonts/segoeui.ttf',
      'C:\\Windows\\Fonts\\times.ttf',
      '/System/Library/Fonts/Supplemental/Times New Roman.ttf'
    ]
  };

  const candidates = [];
  if (preferredPath) candidates.push(preferredPath);
  candidates.push(...(byStyle[style] || byStyle.regular));
  if (style !== 'regular') candidates.push(...byStyle.regular);

  for (const c of candidates) {
    try {
      if (c && existsFn(c)) return c;
    } catch {}
  }
  return null;
}

/**
 * Word-wrap card text cleanly so long quotes fit within frame safe margins.
 */
function wrapCardText(text, maxCharsPerLine = 48) {
  if (!text) return '';
  const paragraphs = String(text).split(/\r?\n/);
  const wrapped = [];
  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push('');
      continue;
    }
    let current = words[0];
    for (let i = 1; i < words.length; i++) {
      if (current.length + 1 + words[i].length <= maxCharsPerLine) {
        current += ' ' + words[i];
      } else {
        wrapped.push(current);
        current = words[i];
      }
    }
    wrapped.push(current);
  }
  return wrapped.join('\n');
}

function escapeFilterFilePath(filePath) {
  return config.toWinPath(filePath)
    .replace(/\\/g, '/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "'\\''");
}

function buildFadeAlphaExpr(start, end, fade) {
  const s = Number(start);
  const e = Number(end);
  const f = Math.max(0.05, Math.min(Number(fade) || 0.8, Math.max(0.1, (e - s) / 2)));
  const fadeInEnd = (s + f).toFixed(3);
  const fadeOutStart = (e - f).toFixed(3);
  const sStr = s.toFixed(3);
  const eStr = e.toFixed(3);
  const fStr = f.toFixed(3);
  return `if(lt(t\\,${sStr})\\,0\\,if(lt(t\\,${fadeInEnd})\\,(t-${sStr})/${fStr}\\,if(lt(t\\,${fadeOutStart})\\,1\\,if(lt(t\\,${eStr})\\,(${eStr}-t)/${fStr}\\,0))))`;
}

/**
 * Pure builder for the Silent-Cinema FFmpeg filter_complex graph:
 * - Normalizes every clip to uniform resolution/fps/yuv420p
 * - Joins clips via configurable xfade cross-dissolve (default 0.35s) + acrossfade, or clean concat when xfadeDuration === 0
 * - Mixes diegetic Flow SFX with continuous BGM + smooth fade-in/out matched to exact total video duration
 * - Optionally overlays Unicode-safe title_card and closing_card with smooth fade-in/out
 */
function buildSilentCinemaFilterGraph({
  clips,
  width = 1920,
  height = 1080,
  fps = 30,
  xfadeDuration = 0.35,
  sfxVolume = 0.35,
  hasBgm = false,
  bgmVolume = 0.85,
  bgmFadeIn = 1.5,
  bgmFadeOut = 3.0,
  titleCard = null,
  closingCard = null
}) {
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new Error('buildSilentCinemaFilterGraph: clips array must be non-empty');
  }

  const filterParts = [];
  const safeDurations = clips.map(c => Math.max(0.1, Number(c.duration) || 10.0));
  const minClipDur = Math.min(...safeDurations);
  const effectiveXfade = (clips.length > 1 && Number(xfadeDuration) > 0)
    ? Math.min(Number(xfadeDuration), Math.max(0.05, minClipDur / 2 - 0.05))
    : 0;

  // 1. Normalize video & audio streams for every clip
  for (let i = 0; i < clips.length; i++) {
    const dur = safeDurations[i];
    filterParts.push(
      `[${i}:v]scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos,` +
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=${fps},format=yuv420p,setsar=1,setpts=PTS-STARTPTS[v${i}]`
    );
    if (clips[i].hasAudio) {
      filterParts.push(
        `[${i}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}]`
      );
    } else {
      filterParts.push(
        `anullsrc=r=48000:cl=stereo:d=${dur.toFixed(3)},aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[a${i}]`
      );
    }
  }

  // 2. Join clips with xfade/acrossfade or clean concat
  const xfadeOffsets = [];
  let totalDuration = safeDurations[0];
  let currentVideoLabel = '[v0]';
  let currentAudioLabel = '[a0]';

  if (clips.length > 1) {
    if (effectiveXfade > 0) {
      let runningDur = safeDurations[0];
      for (let i = 1; i < clips.length; i++) {
        const offset = Math.max(0.05, runningDur - effectiveXfade);
        xfadeOffsets.push(Number(offset.toFixed(3)));
        const nextV = i === clips.length - 1 ? '[v_joined]' : `[vx${i}]`;
        const nextA = i === clips.length - 1 ? '[a_sfx_raw]' : `[ax${i}]`;
        filterParts.push(
          `${currentVideoLabel}[v${i}]xfade=transition=fade:duration=${effectiveXfade.toFixed(3)}:offset=${offset.toFixed(3)}${nextV}`
        );
        filterParts.push(
          `${currentAudioLabel}[a${i}]acrossfade=d=${effectiveXfade.toFixed(3)}:c1=tri:c2=tri${nextA}`
        );
        currentVideoLabel = nextV;
        currentAudioLabel = nextA;
        runningDur = offset + safeDurations[i];
      }
      totalDuration = runningDur;
    } else {
      const concatPairs = [];
      for (let i = 0; i < clips.length; i++) {
        concatPairs.push(`[v${i}][a${i}]`);
      }
      filterParts.push(`${concatPairs.join('')}concat=n=${clips.length}:v=1:a=1[v_joined][a_sfx_raw]`);
      currentVideoLabel = '[v_joined]';
      currentAudioLabel = '[a_sfx_raw]';
      totalDuration = safeDurations.reduce((sum, d) => sum + d, 0);
    }
  }

  // 3. Optional Opening Title Card & Closing Quote Card (UTF-8 safe via textfile + verified Unicode font)
  let overlayStep = 0;
  const pushDrawtext = ({ textFile, fontPath, fontSize, yExpr, start, end, fade, box = false, lineSpacing = 14 }) => {
    const outLabel = `[vo${++overlayStep}]`;
    const escapedTextFile = escapeFilterFilePath(textFile);
    const fontOpt = fontPath ? `fontfile='${escapeFilterFilePath(fontPath)}':` : '';
    const alphaExpr = buildFadeAlphaExpr(start, end, fade);
    const boxOpt = box ? `:box=1:boxcolor=black@0.42:boxborderw=26` : '';
    filterParts.push(
      `${currentVideoLabel}drawtext=${fontOpt}textfile='${escapedTextFile}':` +
      `fontcolor=0xFFFDF5:fontsize=${fontSize}:line_spacing=${lineSpacing}:` +
      `x=(w-text_w)/2:y=${yExpr}:` +
      `shadowcolor=black@0.85:shadowx=2:shadowy=2${boxOpt}:` +
      `alpha='${alphaExpr}'${outLabel}`
    );
    currentVideoLabel = outLabel;
  };

  if (titleCard && titleCard.titleTextFile) {
    const tStart = typeof titleCard.start === 'number' ? titleCard.start : 1.0;
    const tEnd = typeof titleCard.end === 'number' ? titleCard.end : Math.min(totalDuration, tStart + 4.0);
    const tFade = typeof titleCard.fade === 'number' ? titleCard.fade : 0.8;
    const hasSub = Boolean(titleCard.subtitleTextFile);
    const titleSize = Number(titleCard.font_size || titleCard.fontSize) || Math.round(height * 0.068);
    const subSize = Number(titleCard.subtitle_font_size || titleCard.subtitleFontSize) || Math.round(height * 0.032);

    pushDrawtext({
      textFile: titleCard.titleTextFile,
      fontPath: titleCard.fontPath,
      fontSize: titleSize,
      yExpr: hasSub ? '(h*0.41-text_h/2)' : '(h*0.48-text_h/2)',
      start: tStart,
      end: tEnd,
      fade: tFade,
      box: false
    });

    if (hasSub) {
      pushDrawtext({
        textFile: titleCard.subtitleTextFile,
        fontPath: titleCard.italicFontPath || titleCard.fontPath,
        fontSize: subSize,
        yExpr: '(h*0.52-text_h/2)',
        start: tStart + 0.2,
        end: tEnd,
        fade: tFade,
        box: false
      });
    }
  }

  if (closingCard && closingCard.textFile) {
    const defaultDur = typeof closingCard.duration === 'number' ? closingCard.duration : 6.0;
    const cEnd = typeof closingCard.end === 'number'
      ? Math.min(totalDuration, closingCard.end)
      : Math.max(0.5, totalDuration - 0.3);
    const cStart = typeof closingCard.start === 'number'
      ? Math.max(0, closingCard.start)
      : Math.max(0, cEnd - defaultDur);
    const cFade = typeof closingCard.fade === 'number' ? closingCard.fade : 1.0;
    const closeSize = Number(closingCard.font_size || closingCard.fontSize) || Math.round(height * 0.034);
    const yExpr = closingCard.position === 'center' ? '(h*0.48-text_h/2)' : '(h*0.77-text_h/2)';

    pushDrawtext({
      textFile: closingCard.textFile,
      fontPath: closingCard.italicFontPath || closingCard.fontPath,
      fontSize: closeSize,
      yExpr,
      start: cStart,
      end: cEnd,
      fade: cFade,
      box: closingCard.box !== false,
      lineSpacing: 16
    });
  }

  const finalVideoLabel = '[v_out]';
  filterParts.push(`${currentVideoLabel}format=yuv420p${finalVideoLabel}`);

  // 4. Audio mixing: Flow diegetic SFX + continuous BGM with smooth fade-in/out
  const bgmInputIdx = clips.length;
  const effectiveSfxVol = Number.isFinite(Number(sfxVolume)) ? Number(sfxVolume) : 0.35;
  const effectiveBgmVol = Number.isFinite(Number(bgmVolume)) ? Number(bgmVolume) : 0.85;
  const finalAudioLabel = '[a_out]';

  if (hasBgm && effectiveBgmVol > 0) {
    const fadeInDur = Math.max(0.1, Math.min(Number(bgmFadeIn) || 1.5, totalDuration / 3));
    const fadeOutDur = Math.max(0.1, Math.min(Number(bgmFadeOut) || 3.0, totalDuration / 3));
    const fadeOutStart = Math.max(0, totalDuration - fadeOutDur);
    filterParts.push(`${currentAudioLabel}volume=${effectiveSfxVol}[a_sfx]`);
    filterParts.push(
      `[${bgmInputIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `atrim=0:${totalDuration.toFixed(3)},asetpts=PTS-STARTPTS,` +
      `volume=${effectiveBgmVol},afade=t=in:st=0:d=${fadeInDur.toFixed(3)},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeOutDur.toFixed(3)}[a_bgm]`
    );
    filterParts.push(
      `[a_sfx][a_bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0,alimiter=limit=0.95${finalAudioLabel}`
    );
  } else {
    filterParts.push(`${currentAudioLabel}volume=${effectiveSfxVol}${finalAudioLabel}`);
  }

  return {
    filterComplex: filterParts.join(';'),
    videoOutputLabel: finalVideoLabel,
    audioOutputLabel: finalAudioLabel,
    totalDuration: Number(totalDuration.toFixed(3)),
    effectiveXfade,
    xfadeOffsets
  };
}

/**
 * Assemble Silent-Cinema / Music-Driven master video in a single high-quality H.264 pass.
 */
async function compositeSilentCinema({
  videoFiles,
  outputVideoPath,
  width = 1920,
  height = 1080,
  fps = 30,
  xfadeDuration = 0.35,
  sfxVolume = 0.35,
  bgmPath = null,
  bgmVolume = 0.85,
  bgmStartSec = 0,
  bgmFadeIn = 1.5,
  bgmFadeOut = 3.0,
  titleCard = null,
  closingCard = null
}) {
  if (!Array.isArray(videoFiles) || videoFiles.length === 0) {
    throw new Error('compositeSilentCinema: Không có video clips để ghép!');
  }

  const assembleBase = path.join(config.PROJECT_DIR, 'renders', 'temp_assemble');
  if (!fs.existsSync(assembleBase)) fs.mkdirSync(assembleBase, { recursive: true });
  const tempDir = fs.mkdtempSync(path.join(assembleBase, 'cinema_'));

  try {
    // MD5 duplicate video guard
    const seenVideoHashes = new Map();
    const clips = [];
    for (let i = 0; i < videoFiles.length; i++) {
      const vf = videoFiles[i];
      if (!vf || !fs.existsSync(vf)) {
        throw new Error(`Không tìm thấy clip thứ ${i + 1}: ${vf}`);
      }
      const probe = probeVideoStream(vf);
      if (!probe.valid) {
        throw new Error(`Clip thứ ${i + 1} (${path.basename(vf)}) không hợp lệ qua ffprobe: ${probe.reason}`);
      }
      const vHash = crypto.createHash('md5').update(fs.readFileSync(vf)).digest('hex');
      if (seenVideoHashes.has(vHash)) {
        const prevIdx = seenVideoHashes.get(vHash);
        throw new Error(`PHÁT HIỆN LỖI LẶP VIDEO (Video Doubling): Phân cảnh ${i + 1} (${path.basename(vf)}) trùng md5 100% với Phân cảnh ${prevIdx + 1}! MD5: ${vHash}.`);
      }
      seenVideoHashes.set(vHash, i);
      clips.push({
        videoFile: vf,
        duration: probe.duration,
        hasAudio: hasAudioStream(vf)
      });
    }

    const boldFont = resolveUnicodeFont({ style: 'bold' });
    const italicFont = resolveUnicodeFont({ style: 'italic' });
    const regularFont = resolveUnicodeFont({ style: 'regular' });

    let resolvedTitleCard = null;
    if (titleCard && titleCard.title) {
      const titleTextFile = path.join(tempDir, 'title_main.txt');
      fs.writeFileSync(titleTextFile, String(titleCard.title).trim(), 'utf8');
      let subtitleTextFile = null;
      if (titleCard.subtitle) {
        subtitleTextFile = path.join(tempDir, 'title_sub.txt');
        fs.writeFileSync(subtitleTextFile, String(titleCard.subtitle).trim(), 'utf8');
      }
      resolvedTitleCard = {
        ...titleCard,
        titleTextFile,
        subtitleTextFile,
        fontPath: titleCard.font_path || boldFont || regularFont,
        italicFontPath: titleCard.subtitle_font_path || italicFont || regularFont
      };
    }

    let resolvedClosingCard = null;
    if (closingCard && closingCard.text) {
      const closeTextFile = path.join(tempDir, 'closing_quote.txt');
      const wrapped = wrapCardText(closingCard.text, closingCard.max_chars_per_line || 48);
      fs.writeFileSync(closeTextFile, wrapped, 'utf8');
      resolvedClosingCard = {
        ...closingCard,
        textFile: closeTextFile,
        fontPath: closingCard.font_path || regularFont,
        italicFontPath: closingCard.font_path || italicFont || regularFont
      };
    }

    const effectiveBgm = (bgmPath && bgmPath !== 'none' && bgmVolume > 0 && fs.existsSync(bgmPath)) ? bgmPath : null;

    const graph = buildSilentCinemaFilterGraph({
      clips,
      width,
      height,
      fps,
      xfadeDuration,
      sfxVolume,
      hasBgm: Boolean(effectiveBgm),
      bgmVolume,
      bgmFadeIn,
      bgmFadeOut,
      titleCard: resolvedTitleCard,
      closingCard: resolvedClosingCard
    });

    const outDir = path.dirname(outputVideoPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
    const winOutputVideoPath = config.toWinPath(outputVideoPath);

    console.log(`\n=== CHẾ ĐỘ DỰNG ĐIỆN ẢNH KHÔNG LỜI THOẠI (SILENT CINEMA / MUSIC-DRIVEN) ===`);
    console.log(`Số clips: ${clips.length} | Chuẩn hóa: ${width}x${height} @ ${fps}fps | Xfade: ${graph.effectiveXfade}s`);
    console.log(`Hòa âm: Flow SFX (${(sfxVolume * 100).toFixed(0)}%) + BGM (${effectiveBgm ? `${(bgmVolume * 100).toFixed(0)}% — ${path.basename(effectiveBgm)}` : 'TẮT'})`);
    console.log(`Dự kiến tổng thời lượng: ${graph.totalDuration.toFixed(2)}s`);

    const ffmpegArgs = ['-nostdin', '-y'];
    for (const vf of videoFiles) {
      ffmpegArgs.push('-i', config.toWinPath(vf));
    }
    if (effectiveBgm) {
      if (Number(bgmStartSec) > 0) {
        ffmpegArgs.push('-ss', String(bgmStartSec));
      }
      ffmpegArgs.push('-stream_loop', '-1', '-i', config.toWinPath(effectiveBgm));
    }

    ffmpegArgs.push(
      '-filter_complex', graph.filterComplex,
      '-map', graph.videoOutputLabel,
      '-map', graph.audioOutputLabel,
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '17',
      '-pix_fmt', 'yuv420p',
      '-r', String(fps),
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      winOutputVideoPath
    );

    try {
      execFileSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      console.error(`[!] Lỗi ffmpeg xuất silent-cinema master:`, err.stderr ? err.stderr.toString() : err.message);
      throw err;
    }

    const verification = probeVideoStream(outputVideoPath);
    if (!verification.valid) {
      throw new Error(`Master video xuất ra không vượt qua kiểm định ffprobe: ${verification.reason}`);
    }

    const finalSize = (fs.statSync(outputVideoPath).size / 1024 / 1024).toFixed(2);
    console.log(`\n============================================================`);
    console.log(`✓ XUẤT THÀNH PHẨM SILENT-CINEMA MASTER THÀNH CÔNG:`);
    console.log(`  File: ${outputVideoPath}`);
    console.log(`  Độ phân giải: ${verification.width}x${verification.height} | Thời lượng: ${verification.duration.toFixed(2)}s | Dung lượng: ${finalSize} MB`);
    console.log(`============================================================`);

    return {
      outputVideoPath,
      duration: verification.duration,
      width: verification.width,
      height: verification.height,
      sizeMB: finalSize,
      timelines: clips,
      xfadeOffsets: graph.xfadeOffsets
    };
  } finally {
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(assembleBase) && fs.readdirSync(assembleBase).length === 0) {
        fs.rmdirSync(assembleBase);
      }
    } catch {}
  }
}

/**
 * Composite entire project in a single H.264 encoding pass:
 * Video clips concat + Voiceover padding/concat + Ambient mixing + Subtitle burn + Deterministic scratch cleanup
 */
async function compositeVideo({
  videoFiles,
  audioFiles = [],
  assSubtitlePath,
  subtitles_path,
  outputVideoPath,
  voiceVolume = 1.0,
  ambientVolume = 0.25,
  sfxLowpassHz = 300,
  bgmPath = null,
  bgmVolume = 0.15,
  delays = [],
  aspectRatio = '16:9',
  burnSubtitles = true
}) {
  const assembleBase = path.join(config.PROJECT_DIR, 'renders', 'temp_assemble');
  if (!fs.existsSync(assembleBase)) fs.mkdirSync(assembleBase, { recursive: true });
  // Per-invocation isolated scratch directory (A09)
  const tempDir = fs.mkdtempSync(path.join(assembleBase, 'job_'));

  try {
    // 0. MD5 duplicate check across audio files (Voice Doubling Prevention)
    const seenAudioHashes = new Map();
    for (let i = 0; i < audioFiles.length; i++) {
      const aFile = audioFiles[i];
      if (aFile && fs.existsSync(aFile)) {
        const hash = crypto.createHash('md5').update(fs.readFileSync(aFile)).digest('hex');
        if (seenAudioHashes.has(hash)) {
          const prevIdx = seenAudioHashes.get(hash);
          throw new Error(`PHÁT HIỆN LỖI LẶP VOICE (Voice Doubling): Phân cảnh ${i + 1} (${path.basename(aFile)}) trùng md5 100% với Phân cảnh ${prevIdx + 1}! MD5: ${hash}. Dừng quy trình xuất master.`);
        }
        seenAudioHashes.set(hash, i);
      }
    }

    // 0b. MD5 duplicate check across video files (Video Doubling Prevention)
    const seenVideoHashes = new Map();
    for (let i = 0; i < videoFiles.length; i++) {
      const vFile = videoFiles[i];
      if (vFile && fs.existsSync(vFile)) {
        const vHash = crypto.createHash('md5').update(fs.readFileSync(vFile)).digest('hex');
        if (seenVideoHashes.has(vHash)) {
          const prevIdx = seenVideoHashes.get(vHash);
          throw new Error(`PHÁT HIỆN LỖI LẶP VIDEO (Video Doubling): Phân cảnh ${i + 1} (${path.basename(vFile)}) trùng md5 100% với Phân cảnh ${prevIdx + 1}! MD5: ${vHash}. Dừng quy trình xuất master.`);
        }
        seenVideoHashes.set(vHash, i);
      }
    }

    const activeSubPath = subtitles_path !== undefined ? subtitles_path : assSubtitlePath;
    const effectiveBurnSubtitles = Boolean(burnSubtitles && activeSubPath && fs.existsSync(activeSubPath));
    const hasVoiceTrack = Boolean(audioFiles && audioFiles.some(f => f && fs.existsSync(f)));

    console.log(`=== BẮT ĐẦU QUÁ TRÌNH GHÉP NỐI & HẬU KỲ (COMPOSITOR) ===`);
    console.log(`Số phân cảnh video: ${videoFiles.length}`);
    console.log(`Số file voiceover: ${audioFiles.length}`);
    console.log(`Tỷ lệ khung hình: ${aspectRatio} | Hardsub: ${effectiveBurnSubtitles ? 'BẬT' : 'TẮT (Clean Footage)'}`);

    // 1. Measure video durations & prepare audio padding if voice track is present
    const paddedAudioList = path.join(tempDir, 'audio_concat.txt');
    let audioConcatContent = '';
    const timelines = [];

    for (let i = 0; i < videoFiles.length; i++) {
      const vFile = videoFiles[i];
      const vDur = getDuration(vFile);
      const aFile = audioFiles[i];
      const paddedAudio = path.join(tempDir, `padded_${String(i + 1).padStart(2, '0')}.wav`);

      let aDur = 0;
      const delaySec = (delays && delays[i] !== undefined) ? delays[i] : 0.3;
      const delayMs = Math.round(delaySec * 1000);

      if (hasVoiceTrack) {
        if (aFile && fs.existsSync(aFile)) {
          aDur = getDuration(aFile);
          const winAFile = config.toWinPath(aFile);
          const winPaddedAudio = config.toWinPath(paddedAudio);
          execFileSync('ffmpeg', [
            '-nostdin',
            '-y',
            '-i', winAFile,
            '-af', `adelay=${delayMs}|${delayMs},apad=whole_dur=${vDur}`,
            '-ar', '44100',
            '-ac', '2',
            '-t', String(vDur),
            winPaddedAudio
          ], { stdio: 'ignore' });
        } else {
          const winPaddedAudio = config.toWinPath(paddedAudio);
          execFileSync('ffmpeg', [
            '-nostdin',
            '-y',
            '-f', 'lavfi',
            '-i', 'anullsrc=r=44100:cl=stereo',
            '-t', String(vDur),
            winPaddedAudio
          ], { stdio: 'ignore' });
        }
        const winPadded = config.toWinPath(paddedAudio).replace(/\\/g, '/').replace(/'/g, "'\\''");
        audioConcatContent += `file '${winPadded}'\n`;
      }

      timelines.push({
        shotIndex: i + 1,
        videoFile: vFile,
        duration: vDur,
        audioDuration: aDur,
        hasAudio: hasAudioStream(vFile)
      });
    }

    // 2. Concatenate padded voiceover into master_voice.wav (only when voice track exists)
    const masterVoice = path.join(tempDir, 'master_voice.wav');
    const winMasterVoice = config.toWinPath(masterVoice);
    if (hasVoiceTrack) {
      fs.writeFileSync(paddedAudioList, audioConcatContent, 'utf8');
      const winPaddedAudioList = config.toWinPath(paddedAudioList);
      execFileSync('ffmpeg', [
        '-nostdin',
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', winPaddedAudioList,
        '-c:a', 'pcm_s16le',
        winMasterVoice
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      console.log(`[✓] Đã tạo master voice track: ${getDuration(masterVoice).toFixed(2)}s`);
    }

    // 3. Single-Pass Final Compositing: Video concat + 1080p Lanczos upscale + Optional Subtitle burn + Multi-bus Audio Mix
    // Eliminates redundant two-pass H.264 re-encoding bottleneck during clip assembly
    console.log(`[-] Đang nối clip, hòa âm đa tầng, upscale 1080p Full HD${effectiveBurnSubtitles ? ' và burn phụ đề ASS' : ''} (1-Pass H.264)...`);
    const outDir = path.dirname(outputVideoPath);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    const shouldBurnSubtitles = effectiveBurnSubtitles;
    const winAssSubtitlePath = shouldBurnSubtitles ? config.toWinPath(activeSubPath).replace(/\\/g, '/').replace(/:/g, '\\\\:') : '';
    const winOutputVideoPath = config.toWinPath(outputVideoPath);

    const isVertical = aspectRatio === '9:16';
    const scaleFilter = isVertical ? 'scale=1080:1920:flags=lanczos' : 'scale=1920:1080:flags=lanczos';
    const subFilter = shouldBurnSubtitles ? `,subtitles='${winAssSubtitlePath}'` : '';

    // Resolve BGM (Background Music)
    const defaultBgm = path.join(config.PROJECT_DIR, 'assets', 'bgm.mp3');
    const isBgmDisabled = bgmPath === 'none' || bgmVolume <= 0;
    const effectiveBgm = isBgmDisabled ? null : ((bgmPath && fs.existsSync(bgmPath)) ? bgmPath : (fs.existsSync(defaultBgm) ? defaultBgm : null));
    const winBgm = effectiveBgm ? config.toWinPath(effectiveBgm) : null;
    const rawDur = timelines.reduce((sum, item) => sum + (item.duration || 0), 0);
    const fadeOutStart = Math.max(0, rawDur - 2.0).toFixed(2);

    const ffmpegArgs = ['-nostdin', '-y'];
    for (const vf of videoFiles) {
      ffmpegArgs.push('-i', config.toWinPath(vf));
    }

    let nextInputIdx = videoFiles.length;
    let voiceInputIdx = -1;
    if (hasVoiceTrack) {
      voiceInputIdx = nextInputIdx++;
      ffmpegArgs.push('-i', winMasterVoice);
    }

    let bgmInputIdx = -1;
    if (effectiveBgm) {
      bgmInputIdx = nextInputIdx++;
      ffmpegArgs.push('-ss', '8.5', '-stream_loop', '-1', '-i', winBgm);
    }

    // Build video & ambient SFX chain in 1 pass
    const filterParts = [];
    let sfxSourceLabel = '';

    if (videoFiles.length === 1) {
      filterParts.push(`[0:v]${scaleFilter},setsar=1${subFilter}[v]`);
      if (timelines[0].hasAudio) {
        sfxSourceLabel = '[0:a]';
      } else {
        const dur0 = Math.max(0.1, timelines[0].duration || 1.0);
        filterParts.push(`anullsrc=r=44100:cl=stereo:d=${dur0}[a_null_0]`);
        sfxSourceLabel = '[a_null_0]';
      }
    } else {
      const concatPairs = [];
      for (let idx = 0; idx < videoFiles.length; idx++) {
        filterParts.push(`[${idx}:v]${scaleFilter},setsar=1[v${idx}]`);
        if (timelines[idx].hasAudio) {
          concatPairs.push(`[v${idx}][${idx}:a]`);
        } else {
          const durIdx = Math.max(0.1, timelines[idx].duration || 1.0);
          filterParts.push(`anullsrc=r=44100:cl=stereo:d=${durIdx}[a_null_${idx}]`);
          concatPairs.push(`[v${idx}][a_null_${idx}]`);
        }
      }
      if (shouldBurnSubtitles) {
        filterParts.push(`${concatPairs.join('')}concat=n=${videoFiles.length}:v=1:a=1[v_cat][a_cat]`);
        filterParts.push(`[v_cat]subtitles='${winAssSubtitlePath}'[v]`);
      } else {
        filterParts.push(`${concatPairs.join('')}concat=n=${videoFiles.length}:v=1:a=1[v][a_cat]`);
      }
      sfxSourceLabel = '[a_cat]';
    }

    const sfxLowpassFilter = (hasVoiceTrack && Number(sfxLowpassHz) > 0) ? `lowpass=f=${Number(sfxLowpassHz)},` : '';

    if (hasVoiceTrack && effectiveBgm) {
      console.log(`    [-] Hòa âm đa tầng 3 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX${sfxLowpassFilter ? ` lowpass=${Number(sfxLowpassHz)}Hz` : ''}) + Voiceover (${(voiceVolume * 100).toFixed(0)}% Lời thoại) + BGM (${(bgmVolume * 100).toFixed(0)}% Nhạc nền)...`);
      filterParts.push(
        `${sfxSourceLabel}${sfxLowpassFilter}volume=${ambientVolume}[a_sfx]`,
        `[${voiceInputIdx}:a]volume=${voiceVolume}[a_voice]`,
        `[${bgmInputIdx}:a]volume=${bgmVolume},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=2[a_bgm]`,
        `[a_sfx][a_voice][a_bgm]amix=inputs=3:duration=first:dropout_transition=2:normalize=0[a]`
      );
    } else if (hasVoiceTrack && !effectiveBgm) {
      console.log(`    [-] Hòa âm đa tầng 2 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX${sfxLowpassFilter ? ` lowpass=${Number(sfxLowpassHz)}Hz` : ''}) + Voiceover (${(voiceVolume * 100).toFixed(0)}% Lời thoại)...`);
      filterParts.push(
        `${sfxSourceLabel}${sfxLowpassFilter}volume=${ambientVolume}[a_sfx]`,
        `[${voiceInputIdx}:a]volume=${voiceVolume}[a_voice]`,
        `[a_sfx][a_voice]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]`
      );
    } else if (!hasVoiceTrack && effectiveBgm) {
      console.log(`    [-] Hòa âm 2 nguồn: Dải âm gốc Flow (${(ambientVolume * 100).toFixed(0)}% SFX) + BGM (${(bgmVolume * 100).toFixed(0)}% Nhạc nền)...`);
      filterParts.push(
        `${sfxSourceLabel}volume=${ambientVolume}[a_sfx]`,
        `[${bgmInputIdx}:a]volume=${bgmVolume},afade=t=in:st=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=2[a_bgm]`,
        `[a_sfx][a_bgm]amix=inputs=2:duration=first:dropout_transition=2:normalize=0[a]`
      );
    } else {
      console.log(`    [-] Sử dụng toàn bộ dải âm thanh SFX gốc từ Google Flow (Phim thuần SFX, không có thoại)...`);
      filterParts.push(`${sfxSourceLabel}volume=1.0[a]`);
    }

    const filterStr = filterParts.join(';');
    ffmpegArgs.push(
      '-filter_complex', filterStr,
      '-map', '[v]',
      '-map', '[a]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '17',
      '-c:a', 'aac',
      '-b:a', '192k',
      winOutputVideoPath
    );

    try {
      execFileSync('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      console.error(`[!] Lỗi ffmpeg xuất master:`, err.stderr ? err.stderr.toString() : err.message);
      throw err;
    }

    const finalDur = getDuration(outputVideoPath);
    const finalSize = (fs.statSync(outputVideoPath).size / 1024 / 1024).toFixed(2);
    console.log(`\n============================================================`);
    console.log(`✓ XUẤT THÀNH PHẨM MASTER THÀNH CÔNG:`);
    console.log(`  File: ${outputVideoPath}`);
    console.log(`  Thời lượng: ${finalDur.toFixed(2)}s | Dung lượng: ${finalSize} MB`);
    console.log(`============================================================`);

    return {
      outputVideoPath,
      duration: finalDur,
      sizeMB: finalSize,
      timelines
    };
  } finally {
    // Deterministic cleanup of THIS invocation's scratch files only (A09)
    try {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      if (fs.existsSync(assembleBase) && fs.readdirSync(assembleBase).length === 0) {
        fs.rmdirSync(assembleBase);
      }
    } catch {}
  }
}

/**
 * Extract verification keyframes at specific timestamps
 */
function extractVerificationFrames(videoPath, timestamps, outputDir) {
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const frames = [];
  const winVideoPath = config.toWinPath(videoPath);

  for (const t of timestamps) {
    const cleanT = String(t).replace(/:/g, '_');
    const outFile = path.join(outputDir, `frame_${cleanT}.jpg`);
    const winOutFile = config.toWinPath(outFile);
    try {
      execFileSync('ffmpeg', [
        '-nostdin',
        '-y',
        '-ss', String(t),
        '-i', winVideoPath,
        '-update', '1',
        '-frames:v', '1',
        winOutFile
      ], { stdio: ['ignore', 'pipe', 'ignore'] });
      if (fs.existsSync(outFile)) {
        frames.push({ timestamp: t, path: outFile });
      }
    } catch (e) {
      console.warn(`[!] Không thể trích xuất frame tại ${t}:`, e.message);
    }
  }

  return frames;
}

/**
 * Verify integrity and extract QA snapshots for all rendered scene clips
 */
function verifyRenderedShots(rendersDir = config.RENDERS_DIR, qaDir = null) {
  const targetQa = qaDir || path.join(rendersDir, 'qa_inspect');
  if (!fs.existsSync(targetQa)) fs.mkdirSync(targetQa, { recursive: true });

  const files = fs.readdirSync(rendersDir).filter(f => f.startsWith('shot_') && f.endsWith('.mp4')).sort();
  const results = [];

  for (const f of files) {
    const sid = f.replace('.mp4', '');
    const mp4Path = path.join(rendersDir, f);
    const snapPath = path.join(targetQa, `${sid}_mid.jpg`);
    const size = fs.statSync(mp4Path).size;

    if (size > 50000) {
      if (!fs.existsSync(snapPath)) {
        try {
          execFileSync('ffmpeg', [
            '-nostdin',
            '-y',
            '-ss', '00:00:04',
            '-i', config.toWinPath(mp4Path),
            '-frames:v', '1',
            '-q:v', '2',
            config.toWinPath(snapPath)
          ], { stdio: ['ignore', 'pipe', 'ignore'] });
        } catch {}
      }
      const ok = fs.existsSync(snapPath) && fs.statSync(snapPath).size > 10000;
      results.push({ shotId: sid, sizeMb: (size / 1024 / 1024).toFixed(2), verified: ok, snapshot: snapPath });
    } else {
      results.push({ shotId: sid, sizeMb: (size / 1024 / 1024).toFixed(2), verified: false, error: 'File corrupt or too small' });
    }
  }

  return results;
}

/**
 * Render a 2D still image into a Ken Burns animated MP4 clip matching shot duration.
 */
function renderMotionStill({
  imagePath,
  duration,
  outputPath,
  effect = 'zoom_in',
  fps = 30,
  width = 1920,
  height = 1080
}) {
  const winImagePath = config.toWinPath(imagePath);
  const winOutputPath = config.toWinPath(outputPath);
  const frames = Math.max(1, Math.ceil(duration * fps));

  let filter = '';
  switch (effect) {
    case 'zoom_out':
      filter = `zoompan=z='max(1.25-0.0015*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_left':
      filter = `zoompan=z=1.15:x='max(0,(iw-iw/zoom)*(1-on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'pan_right':
      filter = `zoompan=z=1.15:x='min(iw-iw/zoom,(iw-iw/zoom)*(on/${frames}))':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
    case 'zoom_in':
    default:
      filter = `zoompan=z='min(zoom+0.0015,1.25)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${width}x${height}:fps=${fps}`;
      break;
  }

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  execFileSync('ffmpeg', [
    '-nostdin',
    '-y',
    '-loop', '1',
    '-i', winImagePath,
    '-vf', `${filter},format=yuv420p`,
    '-t', duration.toFixed(3),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    winOutputPath
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  return outputPath;
}

/**
 * Assemble Minimalist Explainer Master Video via FFmpeg Concat Demuxer (Static Hard Cuts, 0 Ken Burns)
 * Rapid 1-pass assembly in ~0.5s - 1.0s directly synchronized to master audio.
 */
function assembleStaticCuts({
  shots, // Array of { imagePath, duration }
  audioMasterPath,
  outputPath,
  aspectRatio = '16:9'
}) {
  if (!shots || shots.length === 0) {
    throw new Error('assembleStaticCuts: Mảng shots rỗng!');
  }
  if (!fs.existsSync(audioMasterPath)) {
    throw new Error(`assembleStaticCuts: Không tìm thấy file audio master tại: ${audioMasterPath}`);
  }

  // 0. MD5 Image Doubling Prevention
  const seenImageHashes = new Map();
  for (let i = 0; i < shots.length; i++) {
    const imgPath = shots[i].imagePath;
    if (!fs.existsSync(imgPath)) {
      throw new Error(`[!] Không tìm thấy ảnh cho shot ${i + 1}: ${imgPath}`);
    }
    const buf = fs.readFileSync(imgPath);
    const hash = crypto.createHash('md5').update(buf).digest('hex');
    if (seenImageHashes.has(hash)) {
      const prevIdx = seenImageHashes.get(hash);
      throw new Error(`PHÁT HIỆN LỖI TRÙNG ẢNH (Image Doubling): Shot ${i + 1} (${path.basename(imgPath)}) trùng md5 100% với Shot ${prevIdx + 1}! MD5: ${hash}. Dừng quy trình xuất master.`);
    }
    seenImageHashes.set(hash, i);
  }

  // 1. Build ffconcat version 1.0 with escaped file paths (A14)
  const concatLines = ['ffconcat version 1.0'];
  for (const s of shots) {
    const winImg = config.toWinPath(s.imagePath).replace(/\\/g, '/').replace(/'/g, "'\\''");
    concatLines.push(`file '${winImg}'`);
    concatLines.push(`duration ${Number(s.duration).toFixed(3)}`);
  }
  const lastImg = shots[shots.length - 1].imagePath;
  const winLast = config.toWinPath(lastImg).replace(/\\/g, '/').replace(/'/g, "'\\''");
  concatLines.push(`file '${winLast}'`);

  const outDir = path.dirname(outputPath);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  // Per-invocation unique concat plan to prevent cross-process collisions (A09)
  const concatFile = path.join(outDir, `concat_plan_${process.pid}_${Date.now()}.txt`);
  fs.writeFileSync(concatFile, concatLines.join('\n'), 'utf8');

  const isShorts = aspectRatio === '9:16';
  const scaleFilter = isShorts
    ? 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,format=yuv420p'
    : 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p';

  console.log(`[-] Running 1-pass FFmpeg Concat Demuxer for ${shots.length} static cuts...`);
  try {
    execFileSync('ffmpeg', [
      '-nostdin',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', config.toWinPath(concatFile),
      '-i', config.toWinPath(audioMasterPath),
      '-vf', scaleFilter,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '18',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-shortest',
      config.toWinPath(outputPath)
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
  } finally {
    try {
      if (fs.existsSync(concatFile)) fs.unlinkSync(concatFile);
    } catch {}
  }

  console.log(`[✓] Master video created: ${outputPath} (${(fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2)} MB)`);
  return outputPath;
}

/**
 * High-level orchestration to assemble an entire storyboard (Static cuts demuxer or Video clip concat).
 */
async function assembleStoryboard(sb, options = {}) {
  const {
    noSubs = false,
    sbPath = ''
  } = options;

  const shots = sb.shots || [];
  const baseName = sbPath ? path.basename(sbPath, '.json') : 'storyboard';
  const rawEpisodeName = sb.series_id || (sb.project && sb.project.id ? sb.project.id : '') || sb.project_name || baseName;
  const episodeName = config.sanitizeIdentifier(rawEpisodeName, 'storyboard');
  let epRenderDir = path.join(config.RENDERS_DIR, episodeName);
  let audioDir = path.join(config.AUDIO_DIR, episodeName);
  if (!fs.existsSync(audioDir) && fs.existsSync(path.join(config.AUDIO_DIR, baseName))) {
    audioDir = path.join(config.AUDIO_DIR, baseName);
  }

  const isShorts = (sb.aspect_ratio === '9:16') ||
                   (sb.geometry && sb.geometry.aspect_ratio === '9:16') ||
                   (sb.format === 'shorts_40s') ||
                   (sb.project && (sb.project.mode === 'shorts' || sb.project.aspect_ratio === '9:16'));
  const noHardsub = noSubs || sb.hardsub === false || (sb.subtitles && sb.subtitles.hardsub === false) || (sb.project && sb.project.hardsub === false);

  // 1. Static Cuts Demuxer mode (Minimalist Explainer / Static Hard Cuts)
  const isStaticCuts = (sb.pacing === 'static_cuts' || sb.pacing === 'hard_cuts' || sb.format === 'minimalist_explainer' || sb.motion === 'none');
  if (isStaticCuts) {
    console.log(`\n=== CHẾ ĐỘ DỰNG TĨNH SIÊU TỐC (STATIC HARD CUTS / 1-PASS DEMUXER) ===`);
    const staticShots = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      const possibleImgs = [
        path.join(epRenderDir, `${shotId}.png`),
        path.join(epRenderDir, `${shotId}.jpg`),
        path.join(config.RENDERS_DIR, `${shotId}.png`),
        path.join(config.RENDERS_DIR, `${shotId}.jpg`),
        (s.image ? path.resolve(config.PROJECT_DIR, s.image) : null)
      ].filter(Boolean);
      const foundImg = possibleImgs.find(p => fs.existsSync(p));
      if (!foundImg) {
        throw new Error(`[!] Không tìm thấy ảnh cho shot ${shotId} trong ${epRenderDir}`);
      }
      const aFile = path.join(audioDir, `voice_${shotId}.mp3`);
      const audioDur = fs.existsSync(aFile) ? getDuration(aFile) : 0;
      const shotDur = s.duration || s.duration_seconds || (audioDur > 0 ? audioDur : 2.5);
      staticShots.push({ imagePath: foundImg, duration: shotDur });
    }

    let masterAudio = (sb.audio_master && fs.existsSync(sb.audio_master))
      ? sb.audio_master
      : path.join(audioDir, 'master_voice_tight.wav');
    if (!fs.existsSync(masterAudio)) {
      masterAudio = path.join(audioDir, 'master_voice.wav');
    }
    if (!fs.existsSync(masterAudio)) {
      masterAudio = path.join(audioDir, 'master_voice_clauses.wav');
    }
    if (!fs.existsSync(masterAudio)) {
      try {
        const ttsModule = require('./tts');
        const builtMaster = ttsModule.buildMasterClauseAudio(sb, audioDir, sbPath);
        if (builtMaster && fs.existsSync(builtMaster)) {
          masterAudio = builtMaster;
        }
      } catch {}
    }

    const outVideoName = (sb.project && sb.project.id ? `${sb.project.id}_Master_1080p.mp4` : `${episodeName}_Master_1080p.mp4`);
    const masterOutPath = path.join(config.OUTPUT_DIR, outVideoName);
    return assembleStaticCuts({
      shots: staticShots,
      audioMasterPath: masterAudio,
      outputPath: masterOutPath,
      aspectRatio: sb.aspect_ratio || (sb.project && sb.project.aspect_ratio) || '16:9'
    });
  }

  // 1b. Silent-Cinema / Music-Driven Assembly mode (mode === "cinema_silent" or tts === false)
  if (isSilentCinemaStoryboard(sb)) {
    const cinemaVideoFiles = [];
    for (let i = 0; i < shots.length; i++) {
      const s = shots[i];
      const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
      let vFile = path.join(epRenderDir, `${shotId}.mp4`);
      if (!fs.existsSync(vFile)) {
        vFile = path.join(config.RENDERS_DIR, `${shotId}.mp4`);
      }
      if (!fs.existsSync(vFile)) {
        throw new Error(`Thiếu video clip cho ${shotId} tại ${epRenderDir}. Vui lòng chạy ./videogen render trước.`);
      }
      cinemaVideoFiles.push(vFile);
    }

    const audioMix = sb.audio_mix || {};
    const sfxVol = typeof audioMix.sfx_volume === 'number'
      ? audioMix.sfx_volume
      : (typeof sb.sfx_volume === 'number' ? sb.sfx_volume : 0.35);
    const bgmVol = typeof audioMix.bgm_volume === 'number'
      ? audioMix.bgm_volume
      : (typeof sb.bgm_volume === 'number' ? sb.bgm_volume : 0.85);
    const rawBgmPath = audioMix.bgm_path || sb.bgm_path || sb.bgm || null;
    const resolvedBgmPath = rawBgmPath && rawBgmPath !== 'none'
      ? (path.isAbsolute(rawBgmPath) ? rawBgmPath : path.resolve(config.PROJECT_DIR, rawBgmPath))
      : null;

    const outputRes = sb.output_resolution || (sb.geometry && sb.geometry.output_resolution) || null;
    const isVert = isShorts || sb.ratio === '9:16';
    const targetW = (outputRes && Number(outputRes.width)) || (isVert ? 1080 : 1920);
    const targetH = (outputRes && Number(outputRes.height)) || (isVert ? 1920 : 1080);
    const targetFps = Number(sb.fps || (sb.geometry && sb.geometry.fps)) || 30;
    const xfadeDuration = typeof sb.xfade_duration === 'number' ? sb.xfade_duration : 0.35;

    const rawTitle = (sb.project && sb.project.id) || sb.project_name || sb.series_id || episodeName || 'master';
    const safeTitle = config.sanitizeIdentifier(rawTitle, 'master');
    const masterOutput = path.join(config.OUTPUT_DIR, `${safeTitle}_Master.mp4`);

    return await compositeSilentCinema({
      videoFiles: cinemaVideoFiles,
      outputVideoPath: masterOutput,
      width: targetW,
      height: targetH,
      fps: targetFps,
      xfadeDuration,
      sfxVolume: sfxVol,
      bgmPath: resolvedBgmPath,
      bgmVolume: bgmVol,
      bgmStartSec: typeof audioMix.bgm_start_sec === 'number' ? audioMix.bgm_start_sec : (typeof sb.bgm_start_sec === 'number' ? sb.bgm_start_sec : 0),
      bgmFadeIn: typeof audioMix.bgm_fade_in === 'number' ? audioMix.bgm_fade_in : 1.5,
      bgmFadeOut: typeof audioMix.bgm_fade_out === 'number' ? audioMix.bgm_fade_out : 3.0,
      titleCard: sb.title_card || null,
      closingCard: sb.closing_card || null
    });
  }

  // 2. Video Clips Concat mode
  const videoFiles = [];
  const audioFiles = [];
  const timelines = [];
  const delays = [];
  let count11LabsVoice = 0;
  let countMissingVoice = 0;

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const shotId = s.id || `shot_${String(i + 1).padStart(2, '0')}`;
    let vFile = path.join(epRenderDir, `${shotId}.mp4`);
    if (!fs.existsSync(vFile)) {
      vFile = path.join(config.RENDERS_DIR, `${shotId}.mp4`);
    }
    const aFile = path.join(audioDir, `voice_${shotId}.mp3`);

    if (!fs.existsSync(vFile)) {
      const possibleImgs = [
        path.join(epRenderDir, `${shotId}.png`),
        path.join(epRenderDir, `${shotId}.jpg`),
        path.join(config.RENDERS_DIR, `${shotId}.png`),
        path.join(config.RENDERS_DIR, `${shotId}.jpg`),
        (s.image ? path.resolve(config.PROJECT_DIR, s.image) : null)
      ].filter(Boolean);
      const foundImg = possibleImgs.find(p => fs.existsSync(p));
      if (foundImg) {
        const audioDur = fs.existsSync(aFile) ? getDuration(aFile) : 0;
        const shotDur = audioDur > 0 ? (audioDur + 0.3) : (s.duration || 2.5);
        const motionEffects = ['zoom_in', 'pan_left', 'zoom_out', 'pan_right'];
        const effect = s.motion_effect || motionEffects[i % motionEffects.length];
        console.log(`    [-] [Motion Stills] Chuyển đổi ảnh tĩnh ${path.basename(foundImg)} sang clip Ken Burns ${shotDur.toFixed(2)}s (${effect})...`);
        renderMotionStill({
          imagePath: foundImg,
          duration: shotDur,
          outputPath: vFile,
          effect,
          width: isShorts ? 1080 : 1920,
          height: isShorts ? 1920 : 1080
        });
      }
    }

    if (fs.existsSync(vFile)) {
      videoFiles.push(vFile);

      const hasSubOrVo = !!(s.vietnamese_subtitles || s.japanese_voiceover || s.voice || s.text || (s.audio && (s.audio.voiceover || s.audio.japanese_voiceover)));
      const hasAudioFile = hasSubOrVo && fs.existsSync(aFile);

      if (hasAudioFile) {
        count11LabsVoice++;
        audioFiles.push(aFile);
      } else {
        if (hasSubOrVo) {
          countMissingVoice++;
          console.warn(`    [!] CẢNH BÁO: ${shotId} có phụ đề/lời thoại nhưng chưa có file voice tại ${aFile}!`);
        }
        audioFiles.push(null);
      }

      const delaySec = (s.voice && typeof s.voice.voice_delay_sec === 'number') 
        ? s.voice.voice_delay_sec 
        : ((s.audio && typeof s.audio.voice_delay_sec === 'number') ? s.audio.voice_delay_sec : 0.0);
      delays.push(delaySec);

      timelines.push({
        shotId,
        duration: getDuration(vFile),
        audioDuration: hasAudioFile ? getDuration(aFile) : 0,
        voiceDelaySec: delaySec
      });
    }
  }

  if (videoFiles.length === 0) {
    throw new Error(`Không tìm thấy file video/clip nào trong ${epRenderDir} hoặc renders/! Vui lòng chạy ./videogen render trước.`);
  }

  console.log(`[-] Tìm thấy ${videoFiles.length} video clips (${count11LabsVoice} shots có file voiceover).`);
  let assPath = path.join(epRenderDir, 'subtitles.ass');
  if (!fs.existsSync(epRenderDir)) assPath = path.join(config.RENDERS_DIR, 'subtitles.ass');

  if (!noHardsub) {
    const subtitlesModule = require('./subtitles');
    subtitlesModule.generateSubtitles(sb, timelines, assPath);
  }

  const rawTitle = (sb.project && sb.project.id) || sb.project_name || sb.series_id || episodeName || ((sb.project && sb.project.title) || sb.title || 'master');
  const safeTitle = config.sanitizeIdentifier(rawTitle, 'master');
  const masterOutput = path.join(config.OUTPUT_DIR, `${safeTitle}_master_1080p.mp4`);

  const audioMix = sb.audio_mix || {};
  const ambientVol = typeof audioMix.sfx_volume === 'number'
    ? audioMix.sfx_volume
    : (typeof audioMix.ambient_volume === 'number' ? audioMix.ambient_volume : 0.15);
  const sfxLowpassHz = typeof audioMix.sfx_lowpass_hz === 'number' ? audioMix.sfx_lowpass_hz : 300;
  const voiceVol = typeof audioMix.voice_volume === 'number' ? audioMix.voice_volume : 1.0;
  const bgmVol = typeof audioMix.bgm_volume === 'number' ? audioMix.bgm_volume : (typeof sb.bgm_volume === 'number' ? sb.bgm_volume : 0.15);
  const bgmPath = audioMix.bgm_path || sb.bgm || null;

  const res = await compositeVideo({
    videoFiles,
    audioFiles,
    assSubtitlePath: noHardsub ? null : assPath,
    subtitles_path: noHardsub ? null : assPath,
    outputVideoPath: masterOutput,
    ambientVolume: ambientVol,
    sfxLowpassHz,
    voiceVolume: voiceVol,
    bgmVolume: bgmVol,
    bgmPath: bgmPath,
    delays,
    aspectRatio: isShorts ? '9:16' : '16:9',
    burnSubtitles: !noHardsub
  });

  // Also keep a canonical alias ${safeTitle}_master.mp4 for backward compatibility
  const legacyAlias = path.join(config.OUTPUT_DIR, `${safeTitle}_master.mp4`);
  try {
    if (fs.existsSync(masterOutput) && masterOutput !== legacyAlias) {
      fs.copyFileSync(masterOutput, legacyAlias);
    }
  } catch {}
  return res;
}

module.exports = {
  getDuration,
  hasAudioStream,
  probeVideoStream,
  isSilentCinemaStoryboard,
  resolveUnicodeFont,
  wrapCardText,
  buildSilentCinemaFilterGraph,
  compositeSilentCinema,
  compositeVideo,
  assembleStaticCuts,
  assembleStoryboard,
  renderMotionStill,
  extractVerificationFrames,
  verifyRenderedShots
};
