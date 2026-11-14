// Parameter-driven 9:16 clip compositor.
// Cuts a vertical 9:16 clip from a source video and renders up to two variants, driven entirely by a JSON clip spec:
//   - clean:  9:16 crop + selected audio track + burned-in ASS subtitles (FFmpeg only)
//   - motion: 9:16 crop + selected audio track + HyperFrames overlay scenes and subtitles (spec.scenes)
// The engine ships no default scenes, copy, voices or framing presets beyond a neutral centered crop.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const { normalizeScenes, buildScenesHtml, COMPONENT_TYPES } = require('./podcast_hyperframes/components');
const { escapeHtml, safeColor } = require('./podcast_hyperframes/components/util');

const TEMPLATE_DIR = path.join(__dirname, 'podcast_hyperframes');
const OUT_W = 1080;
const OUT_H = 1920;
const DEFAULT_DURATION = 30;
const DEFAULT_HIGHLIGHT = '#F5C518';
const DEFAULT_SUB_Y = 1255;
const DEFAULT_SUB_SIZE = 54;

const STYLE_ALIASES = {
  both: 'both',
  clean: 'clean',
  motion: 'motion',
  hyperframes: 'motion'
};

function isElfBinary(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46;
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function getMediaToolsEnv() {
  const env = { ...process.env };
  if (process.platform === 'win32' || process.platform === 'darwin') {
    return { ffmpegBin: 'ffmpeg', ffprobeBin: 'ffprobe', isLinuxNative: true, env };
  }
  const candidates = [
    process.env.VIDEOGEN_FFMPEG_BIN_DIR,
    path.join(process.env.HOME || '', '.local', 'bin'),
    '/usr/local/bin',
    '/usr/bin'
  ].filter(Boolean);

  for (const dir of candidates) {
    const f = path.join(dir, 'ffmpeg');
    const p = path.join(dir, 'ffprobe');
    if (fs.existsSync(f) && fs.existsSync(p) && isElfBinary(fs.realpathSync(f))) {
      env.PATH = `${dir}${path.delimiter}${env.PATH || ''}`;
      return { ffmpegBin: f, ffprobeBin: p, isLinuxNative: true, env };
    }
  }
  // Fallback: ffmpeg on PATH may be a Windows binary (WSL interop) and needs Windows paths.
  return { ffmpegBin: 'ffmpeg', ffprobeBin: 'ffprobe', isLinuxNative: false, env };
}

function formatMediaPath(filePath, isLinuxNative) {
  const abs = path.resolve(filePath);
  return isLinuxNative ? abs : config.toWinPath(abs);
}

function formatFilterPath(filePath, isLinuxNative) {
  const p = formatMediaPath(filePath, isLinuxNative);
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

function getDuration(spec) {
  const d = Number(spec && spec.duration);
  return Number.isFinite(d) && d > 0 ? d : DEFAULT_DURATION;
}

function getFps(spec) {
  const f = Number(spec && spec.fps);
  return Number.isFinite(f) && f > 0 ? f : 30;
}

function resolveStyle(raw) {
  const key = String(raw || 'both').toLowerCase();
  const style = STYLE_ALIASES[key];
  if (!style) {
    throw new Error(`style/mode không hợp lệ "${raw}". Hỗ trợ: both | clean | motion (alias: hyperframes)`);
  }
  return style;
}

function resolveVoiceMode(raw) {
  const mode = String(raw || 'original').toLowerCase();
  if (mode !== 'original' && mode !== 'dub') {
    throw new Error(`voice_mode không hợp lệ "${raw}". Hỗ trợ: original | dub`);
  }
  return mode;
}

function formatAssTime(sec) {
  const totalCs = Math.max(0, Math.round(Number(sec) * 100));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hexToAssBgr(hex) {
  const clean = String(hex || DEFAULT_HIGHLIGHT).replace('#', '').trim();
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '&H0018C5F5&';
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H00${b}${g}${r}&`.toUpperCase();
}

// Subtitle cue lines: `lines: [..]` (preferred) or `text` (newline separated).
function subtitleLines(sub) {
  if (!sub || typeof sub !== 'object') return [];
  if (Array.isArray(sub.lines)) return sub.lines.map(l => String(l === undefined || l === null ? '' : l)).filter(Boolean);
  if (typeof sub.text === 'string') return sub.text.split(/\r?\n/).filter(Boolean);
  return [];
}

function sanitizeAssText(text) {
  return String(text || '').replace(/[{}\\]/g, '').replace(/\r?\n/g, ' ');
}

function applyAssHighlights(line, highlights = [], defaultColor = DEFAULT_HIGHLIGHT) {
  let out = sanitizeAssText(line);
  for (const h of Array.isArray(highlights) ? highlights : []) {
    if (!h || !h.word) continue;
    const word = sanitizeAssText(h.word);
    if (word && out.includes(word)) {
      out = out.replace(word, `{\\c${hexToAssBgr(h.color || defaultColor)}\\b1}${word}{\\c&H00FFFFFF&}`);
    }
  }
  return out;
}

function subtitleStyle(spec) {
  const st = (spec && spec.subtitle_style) || {};
  const y = Number(st.y);
  const size = Number(st.font_size);
  return {
    font: typeof st.font === 'string' && st.font.trim() ? st.font.trim().replace(/,/g, ' ') : null,
    y: Number.isFinite(y) && y > 0 && y < OUT_H ? Math.round(y) : DEFAULT_SUB_Y,
    fontSize: Number.isFinite(size) && size > 8 && size < 200 ? Math.round(size) : DEFAULT_SUB_SIZE,
    highlightColor: safeColor(st.highlight_color, DEFAULT_HIGHLIGHT)
  };
}

/**
 * Generate the ASS subtitle file for the clean variant (centered at subtitle_style.y).
 */
function generateSubtitleAss(spec, outAssPath) {
  const st = subtitleStyle(spec);
  const fontName = st.font || (fs.existsSync('/mnt/c/Windows/Fonts/segoeuib.ttf') ? 'Segoe UI' : 'DejaVu Sans');
  const events = [];

  for (const sub of spec.subtitles || []) {
    const lines = subtitleLines(sub).map(l => applyAssHighlights(l, sub.highlights, st.highlightColor));
    if (lines.length === 0) continue;
    events.push(
      `Dialogue: 3,${formatAssTime(sub.start)},${formatAssTime(sub.end)},Sub,,0,0,0,,{\\pos(${OUT_W / 2},${st.y})\\fad(80,60)\\b1}${lines.join('\\N')}{\\b0}`
    );
  }

  const ass = `[Script Info]
Title: VideoGen 9x16 Clip Subtitles
ScriptType: v4.00+
PlayResX: ${OUT_W}
PlayResY: ${OUT_H}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Sub,${fontName},${st.fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0.2,0,1,4.8,2.8,5,48,48,20,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;

  fs.mkdirSync(path.dirname(outAssPath), { recursive: true });
  fs.writeFileSync(outAssPath, ass, 'utf8');
  return outAssPath;
}

function cropExpr(c) {
  const vals = ['w', 'h', 'x', 'y'].map(k => Number(c && c[k]));
  if (vals.some(v => !Number.isFinite(v) || v < 0) || vals[0] <= 0 || vals[1] <= 0) {
    throw new Error(`framing crop không hợp lệ: ${JSON.stringify(c)} (cần số w, h, x, y)`);
  }
  return `crop=${vals.map(Math.round).join(':')}`;
}

/**
 * Build the FFmpeg filter graph that turns the source into a 1080x1920 portrait stream.
 * - framing.segments: [{ start, end, crop: { w, h, x, y } }] switches crops over time
 * - framing.crop: { w, h, x, y } single static crop
 * - default: centered full-height 9:16 crop
 */
function buildPortraitFilter(framing = {}) {
  const f = framing || {};
  const scale = `scale=${OUT_W}:${OUT_H}:flags=lanczos`;
  const tail = 'format=yuv420p[vout]';
  const segs = Array.isArray(f.segments) ? f.segments.filter(s => s && s.crop) : [];

  if (segs.length > 1) {
    const n = segs.length;
    const parts = [`[0:v]split=${n}${segs.map((_, i) => `[v${i}]`).join('')}`];
    segs.forEach((s, i) => parts.push(`[v${i}]${cropExpr(s.crop)},${scale}[c${i}]`));
    let prev = '[c0]';
    for (let i = 1; i < n; i++) {
      const s = segs[i];
      const st = Number(s.start);
      const en = Number(s.end);
      if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st) {
        throw new Error(`framing segment #${i} cần start < end: ${JSON.stringify({ start: s.start, end: s.end })}`);
      }
      const next = i === n - 1 ? '[vstack]' : `[t${i}]`;
      parts.push(`${prev}[c${i}]overlay=x=0:y=0:enable='between(t,${st.toFixed(2)},${en.toFixed(2)})'${next}`);
      prev = next;
    }
    parts.push(`[vstack]${tail}`);
    return parts.join(';');
  }

  const single = segs.length === 1 ? segs[0].crop : f.crop;
  if (single) return `[0:v]${cropExpr(single)},${scale},${tail}`;
  return `[0:v]crop=w='trunc(ih*9/16/2)*2':h=ih,${scale},${tail}`;
}

function requireSource(spec) {
  if (!spec.source_video) throw new Error('Clip spec thiếu "source_video".');
  if (!fs.existsSync(spec.source_video)) throw new Error(`Không tìm thấy source_video: ${spec.source_video}`);
}

/**
 * Ensure the 1080x1920 portrait video exists (uses spec.portrait_video when provided).
 */
function ensurePortraitVideo(spec, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (spec.portrait_video && fs.existsSync(spec.portrait_video)) {
    if (path.resolve(spec.portrait_video) !== path.resolve(outPath)) {
      fs.copyFileSync(spec.portrait_video, outPath);
    }
    return outPath;
  }
  requireSource(spec);

  const { ffmpegBin, isLinuxNative, env } = getMediaToolsEnv();
  const args = ['-y'];
  if (Number(spec.source_start) > 0) args.push('-ss', String(spec.source_start));
  args.push(
    '-t', String(getDuration(spec)),
    '-i', formatMediaPath(spec.source_video, isLinuxNative),
    '-filter_complex', buildPortraitFilter(spec.framing),
    '-map', '[vout]',
    '-an',
    '-r', String(getFps(spec)),
    '-g', '15',
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '17',
    formatMediaPath(outPath, isLinuxNative)
  );
  execFileSync(ffmpegBin, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return outPath;
}

function audioMix(spec) {
  const mix = (spec && spec.audio_mix) || {};
  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    voiceVolume: Math.max(0, num(mix.voice_volume, 1.0)),
    originalVolume: Math.max(0, num(mix.original_volume, 0)),
    loudness: num(mix.loudness_lufs, -14)
  };
}

/**
 * Resolve or build the master audio track:
 * - 'original': source audio normalized (or spec.master_original_audio when provided)
 * - 'dub': spec.master_dub_audio, optionally mixed with the source audio at audio_mix.original_volume
 */
function ensureMasterAudio(spec, outWavPath, voiceModeOverride = null) {
  const voiceMode = resolveVoiceMode(voiceModeOverride || spec.voice_mode);
  fs.mkdirSync(path.dirname(outWavPath), { recursive: true });
  const { ffmpegBin, isLinuxNative, env } = getMediaToolsEnv();
  const dur = getDuration(spec);
  const fadeStart = Math.max(0, dur - 0.35).toFixed(2);
  const mix = audioMix(spec);
  const sourceInput = () => {
    const a = [];
    if (Number(spec.source_start) > 0) a.push('-ss', String(spec.source_start));
    a.push('-t', String(dur), '-i', formatMediaPath(spec.source_video, isLinuxNative));
    return a;
  };
  const outArgs = ['-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', formatMediaPath(outWavPath, isLinuxNative)];

  if (voiceMode === 'dub') {
    if (!spec.master_dub_audio || !fs.existsSync(spec.master_dub_audio)) {
      throw new Error('voice_mode "dub" cần "master_dub_audio" trỏ tới file voiceover đã render sẵn.');
    }
    if (mix.originalVolume <= 0 && mix.voiceVolume === 1) {
      if (path.resolve(spec.master_dub_audio) !== path.resolve(outWavPath)) {
        fs.copyFileSync(spec.master_dub_audio, outWavPath);
      }
      return outWavPath;
    }
    const args = ['-y', '-t', String(dur), '-i', formatMediaPath(spec.master_dub_audio, isLinuxNative)];
    if (mix.originalVolume > 0) {
      requireSource(spec);
      args.push(...sourceInput(),
        '-filter_complex',
        `[0:a]volume=${mix.voiceVolume}[a0];[1:a]volume=${mix.originalVolume}[a1];[a0][a1]amix=inputs=2:duration=first:normalize=0,afade=t=out:st=${fadeStart}:d=0.35[aout]`,
        '-map', '[aout]');
    } else {
      args.push('-af', `volume=${mix.voiceVolume}`);
    }
    execFileSync(ffmpegBin, [...args, ...outArgs], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    return outWavPath;
  }

  if (spec.master_original_audio && fs.existsSync(spec.master_original_audio)) {
    if (path.resolve(spec.master_original_audio) !== path.resolve(outWavPath)) {
      fs.copyFileSync(spec.master_original_audio, outWavPath);
    }
    return outWavPath;
  }

  requireSource(spec);
  execFileSync(ffmpegBin, [
    '-y',
    ...sourceInput(),
    '-vn',
    '-af', `highpass=f=70,loudnorm=I=${mix.loudness}:TP=-1.0:LRA=9,volume=${mix.voiceVolume},afade=t=in:st=0:d=0.12,afade=t=out:st=${fadeStart}:d=0.35`,
    ...outArgs
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return outWavPath;
}

/**
 * Render the clean variant: 9:16 crop + master audio + burned-in ASS subtitles.
 */
function renderCleanClip(spec, { outputVideoPath, workDir, voiceMode = null }) {
  const { ffmpegBin, isLinuxNative, env } = getMediaToolsEnv();
  fs.mkdirSync(workDir, { recursive: true });
  fs.mkdirSync(path.dirname(outputVideoPath), { recursive: true });

  const portraitPath = path.join(workDir, 'portrait_9x16.mp4');
  ensurePortraitVideo(spec, portraitPath);

  const audioPath = path.join(workDir, 'master_audio.wav');
  ensureMasterAudio(spec, audioPath, voiceMode);

  const vf = [];
  if (Array.isArray(spec.subtitles) && spec.subtitles.length > 0) {
    const assPath = path.join(workDir, 'subtitles.ass');
    generateSubtitleAss(spec, assPath);
    const fontsDir = fs.existsSync('/mnt/c/Windows/Fonts')
      ? `:fontsdir='${formatFilterPath('/mnt/c/Windows/Fonts', isLinuxNative)}'`
      : '';
    vf.push('-vf', `subtitles='${formatFilterPath(assPath, isLinuxNative)}'${fontsDir}`);
  }

  console.log(`[-] Đang render bản clean 9:16 (voice_mode=${resolveVoiceMode(voiceMode || spec.voice_mode)}): ${outputVideoPath}`);
  execFileSync(ffmpegBin, [
    '-y',
    '-i', formatMediaPath(portraitPath, isLinuxNative),
    '-i', formatMediaPath(audioPath, isLinuxNative),
    ...vf,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-t', String(getDuration(spec)),
    '-r', String(getFps(spec)),
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-movflags', '+faststart',
    formatMediaPath(outputVideoPath, isLinuxNative)
  ], { env, stdio: ['ignore', 'pipe', 'pipe'] });

  return outputVideoPath;
}

function renderSubtitlePhraseHtml(line, highlights = []) {
  let out = escapeHtml(line);
  for (const h of Array.isArray(highlights) ? highlights : []) {
    if (!h || !h.word) continue;
    const wEsc = escapeHtml(h.word);
    if (out.includes(wEsc)) {
      const color = h.color ? ` style="color:${safeColor(h.color, DEFAULT_HIGHLIGHT)}"` : '';
      out = out.replace(wEsc, `<span class="hl"${color}>${wEsc}</span>`);
    }
  }
  return out;
}

function buildCaptionsHtml(spec) {
  return (spec.subtitles || []).map((sub, idx) => {
    const lines = subtitleLines(sub)
      .map(l => `<div class="sub-line">${renderSubtitlePhraseHtml(l, sub.highlights)}</div>`)
      .join('');
    return `<div id="sub-${idx}" class="sub-group">${lines}</div>`;
  }).join('\n');
}

// JSON embedded in a <script> block must not be able to close the tag.
function scriptSafeJson(obj) {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Build the HyperFrames index.html for a clip spec (pure string transform, no media I/O).
 */
function buildHyperFramesHtml(spec, template = fs.readFileSync(path.join(TEMPLATE_DIR, 'index.html'), 'utf8')) {
  const resolved = { ...spec, scenes: normalizeScenes(spec), duration: getDuration(spec) };
  const st = subtitleStyle(spec);
  const subTop = Math.max(0, st.y - 110);
  const lang = typeof spec.language === 'string' && /^[a-zA-Z-]{2,15}$/.test(spec.language) ? spec.language : 'en';
  return template
    .replace(/\/\*BEGIN_LANG\*\/[\s\S]*?\/\*END_LANG\*\//, lang)
    .replace(/\/\*BEGIN_DURATION\*\/[\s\S]*?\/\*END_DURATION\*\//g, String(resolved.duration))
    .replace(/\/\*BEGIN_SUB_TOP\*\/[\s\S]*?\/\*END_SUB_TOP\*\//, String(subTop))
    .replace(/\/\*BEGIN_SUB_SIZE\*\/[\s\S]*?\/\*END_SUB_SIZE\*\//, String(Math.round(st.fontSize * 0.93)))
    .replace(/\.hl \{\s*color: #F5C518;\s*\}/, `.hl {\n      color: ${st.highlightColor};\n    }`)
    .replace(/<!--BEGIN_WIDGETS-->[\s\S]*?<!--END_WIDGETS-->/, () => `<!--BEGIN_WIDGETS-->${buildScenesHtml(resolved, escapeHtml)}<!--END_WIDGETS-->`)
    .replace(/<!--BEGIN_CAPTIONS-->[\s\S]*?<!--END_CAPTIONS-->/, () => `<!--BEGIN_CAPTIONS-->${buildCaptionsHtml(resolved)}<!--END_CAPTIONS-->`)
    .replace(/\/\*BEGIN_SPEC\*\/[\s\S]*?\/\*END_SPEC\*\//, () => scriptSafeJson(resolved));
}

/**
 * Prepare a HyperFrames project workspace (portrait video + master audio + generated index.html).
 */
function prepareHyperFramesWorkspace(spec, workspaceDir, voiceModeOverride = null) {
  const assetsDir = path.join(workspaceDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });
  fs.copyFileSync(path.join(TEMPLATE_DIR, 'hyperframes.json'), path.join(workspaceDir, 'hyperframes.json'));

  const stageVideoPath = path.join(assetsDir, 'source_9x16.mp4');
  console.log(`[-] Đang chuẩn bị video 9:16 CFR cho HyperFrames: ${stageVideoPath}`);
  ensurePortraitVideo(spec, stageVideoPath);

  const masterAudioPath = path.join(assetsDir, 'master_audio.wav');
  console.log(`[-] Đang nạp master audio (voice_mode=${resolveVoiceMode(voiceModeOverride || spec.voice_mode)}): ${masterAudioPath}`);
  ensureMasterAudio(spec, masterAudioPath, voiceModeOverride);

  fs.writeFileSync(path.join(workspaceDir, 'index.html'), buildHyperFramesHtml(spec), 'utf8');
  return workspaceDir;
}

function defaultSnapshotTimes(spec) {
  if (Array.isArray(spec.snapshot_times) && spec.snapshot_times.length > 0) {
    return spec.snapshot_times.map(Number).filter(t => Number.isFinite(t) && t >= 0);
  }
  const scenes = normalizeScenes(spec, { warn: null });
  if (scenes.length > 0) return scenes.map(sc => Number(((sc.start + sc.end) / 2).toFixed(2)));
  const dur = getDuration(spec);
  return [0.25, 0.5, 0.75].map(r => Number((dur * r).toFixed(2)));
}

// HyperFrames writes snapshots either flat or into one sub-directory per run; return the newest image folder.
function latestSnapshotDir(root) {
  if (!fs.existsSync(root)) return null;
  const hasImages = dir => fs.readdirSync(dir).some(f => /\.(png|jpe?g)$/i.test(f));
  const subdirs = fs.readdirSync(root)
    .map(f => path.join(root, f))
    .filter(p => fs.statSync(p).isDirectory() && hasImages(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (subdirs.length > 0) return subdirs[0];
  return hasImages(root) ? root : null;
}

/**
 * Render the motion variant with HyperFrames (npx hyperframes check / snapshot / render).
 */
function renderMotionClip(spec, { workspaceDir, outputVideoPath, voiceMode = null, snapshotTimes = null, snapshotCopyDir = null }) {
  const { env } = getMediaToolsEnv();
  prepareHyperFramesWorkspace(spec, workspaceDir, voiceMode);
  fs.mkdirSync(path.dirname(outputVideoPath), { recursive: true });

  console.log('[-] Kiểm định dự án HyperFrames (npx hyperframes check --json)...');
  let checkRaw = '';
  try {
    checkRaw = execFileSync('npx', ['hyperframes', 'check', '--json'], {
      cwd: workspaceDir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (err) {
    checkRaw = (err && err.stdout) ? String(err.stdout) : '';
    console.warn(`[!] hyperframes check báo lỗi: ${(err && err.message) || err}`);
  }
  let checkReport = null;
  try { checkReport = JSON.parse(checkRaw); } catch {}

  const times = (snapshotTimes && snapshotTimes.length ? snapshotTimes : defaultSnapshotTimes(spec));
  if (times.length > 0) {
    console.log(`[-] Chụp ảnh kiểm định overlay tại ${times.join(', ')}s (npx hyperframes snapshot)...`);
    execFileSync('npx', ['hyperframes', 'snapshot', '--at', times.join(',')], {
      cwd: workspaceDir, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  const snapSrcDir = latestSnapshotDir(path.join(workspaceDir, '.hyperframes', 'artifacts', 'snapshots'));
  if (snapshotCopyDir && snapSrcDir) {
    fs.mkdirSync(snapshotCopyDir, { recursive: true });
    for (const f of fs.readdirSync(snapSrcDir)) {
      if (/\.(png|jpe?g)$/i.test(f)) fs.copyFileSync(path.join(snapSrcDir, f), path.join(snapshotCopyDir, f));
    }
  }

  console.log('[-] Đang render bản motion bằng HyperFrames (npx hyperframes render)...');
  execFileSync('npx', ['hyperframes', 'render', '--quality', 'looks', '--output', path.resolve(outputVideoPath)], {
    cwd: workspaceDir, env, stdio: 'inherit'
  });

  return { outputVideoPath, checkReport, snapshotsDir: snapshotCopyDir || snapSrcDir };
}

function loadSpec(specPathOrObj) {
  if (typeof specPathOrObj !== 'string') return { ...specPathOrObj };
  return JSON.parse(fs.readFileSync(path.resolve(specPathOrObj), 'utf8'));
}

/**
 * Entry point for `./videogen podcast-short <clip_spec.json>`.
 * options: { style|mode: both|clean|motion, voice: original|dub, out, outDir, workDir, snapshotDir }
 */
async function buildPodcastShorts(specPathOrObj, options = {}) {
  const spec = loadSpec(specPathOrObj);
  const style = resolveStyle(options.style || options.mode || spec.style);
  const voiceMode = resolveVoiceMode(options.voice || spec.voice_mode);
  const outDir = path.resolve(options.outDir || path.join(config.OUTPUT_DIR, 'clips_9x16'));
  const workDir = path.resolve(options.workDir || path.join(outDir, 'workspace'));
  fs.mkdirSync(outDir, { recursive: true });

  const base = String(spec.project_id || 'clip').replace(/[^a-zA-Z0-9._-]+/g, '_');
  const cleanName = spec.clean_output_filename || `${base}_clean_9x16.mp4`;
  const motionName = spec.motion_output_filename || `${base}_motion_9x16.mp4`;
  const cleanOut = options.cleanOut || (style === 'clean' && options.out ? path.resolve(options.out) : path.join(outDir, cleanName));
  const motionOut = options.motionOut || (style === 'motion' && options.out ? path.resolve(options.out) : path.join(outDir, motionName));

  if (style !== 'clean' && normalizeScenes(spec, { warn: null }).length === 0) {
    console.log(`[i] spec.scenes trống: bản motion sẽ chỉ gồm video 9:16 + phụ đề. Component hỗ trợ: ${COMPONENT_TYPES.join(', ')}`);
  }

  const result = { style, voiceMode };
  if (style === 'both' || style === 'clean') {
    result.clean = renderCleanClip(spec, { outputVideoPath: cleanOut, workDir: path.join(workDir, 'clean'), voiceMode });
  }
  if (style === 'both' || style === 'motion') {
    const hfRes = renderMotionClip(spec, {
      workspaceDir: path.join(workDir, 'hf_project'),
      outputVideoPath: motionOut,
      voiceMode,
      snapshotCopyDir: options.snapshotDir || path.join(outDir, 'snapshots')
    });
    result.motion = hfRes.outputVideoPath;
    result.checkReport = hfRes.checkReport;
    result.snapshotsDir = hfRes.snapshotsDir;
  }
  return result;
}

module.exports = {
  getMediaToolsEnv,
  resolveStyle,
  resolveVoiceMode,
  subtitleLines,
  generateSubtitleAss,
  buildPortraitFilter,
  ensurePortraitVideo,
  ensureMasterAudio,
  renderCleanClip,
  buildCaptionsHtml,
  buildHyperFramesHtml,
  prepareHyperFramesWorkspace,
  defaultSnapshotTimes,
  renderMotionClip,
  buildPodcastShorts
};
