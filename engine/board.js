const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawnSync, spawn } = require('child_process');
const config = require('./config');

/**
 * Safely convert a file path to a valid file:// URL
 * @param {string} filePath
 * @returns {string}
 */
function toFileUrl(filePath) {
  if (typeof filePath === 'string' && filePath.startsWith('file://')) {
    return filePath;
  }
  return pathToFileURL(path.resolve(filePath)).href;
}

/**
 * Check if lavish-axi CLI is installed and accessible
 * @returns {boolean}
 */
function isLavishInstalled() {
  try {
    const res = spawnSync('lavish-axi', ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000
    });
    return res.status === 0;
  } catch {
    return false;
  }
}

/**
 * Open a local file or file URL in the default system browser
 * @param {string} filePath - Local file path or file:// URL
 * @returns {boolean} - True if an opener process was spawned successfully
 */
function openInSystemBrowser(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;

  const resolvedPath = path.resolve(filePath);
  const fileUrl = toFileUrl(resolvedPath);

  const platform = process.platform;
  const openers = [];

  if (platform === 'darwin') {
    openers.push({ cmd: 'open', args: [fileUrl] });
  } else if (platform === 'win32') {
    openers.push({ cmd: 'explorer.exe', args: [resolvedPath] });
    openers.push({ cmd: 'cmd.exe', args: ['/c', 'start', '""', fileUrl] });
  } else {
    openers.push({ cmd: 'xdg-open', args: [fileUrl] });
    openers.push({ cmd: 'google-chrome', args: [fileUrl] });
    openers.push({ cmd: 'google-chrome-stable', args: [fileUrl] });
    if (config.WIN_HOST || process.env.WSL_DISTRO_NAME) {
      const winTarget = config.toWinPath ? config.toWinPath(resolvedPath) : resolvedPath;
      openers.push({ cmd: 'explorer.exe', args: [winTarget] });
    }
  }

  for (const opener of openers) {
    try {
      const check = spawnSync('which', [opener.cmd], { stdio: 'ignore' });
      if (check.status === 0) {
        const child = spawn(opener.cmd, opener.args, {
          stdio: 'ignore',
          detached: true
        });
        child.unref();
        return true;
      }
    } catch {}
  }
  return false;
}

/**
 * Format seconds into MM:SS (or MM:SS.s with tenths)
 */
function formatTime(seconds, includeTenths = false) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (!includeTenths) {
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const tenths = Math.floor((seconds % 1) * 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
}

/**
 * Determine strategy badge color class for DaisyUI tests
 */
function getStrategyBadgeClass(strategy) {
  const s = String(strategy || '').toUpperCase();
  if (s.includes('LITERAL')) return 'badge-info';
  if (s.includes('METAPHOR')) return 'badge-secondary';
  if (s.includes('TITLE') || s.includes('CARD')) return 'badge-warning';
  if (s.includes('SPLIT')) return 'badge-accent';
  if (s.includes('CHURN') || s.includes('POSE')) return 'badge-primary';
  if (s.includes('HOOK') || s.includes('CLIMAX')) return 'badge-error';
  return 'badge-neutral';
}

/**
 * Rich studio semantic color palette for visual strategies
 */
function getStrategyStyle(strategy) {
  const s = String(strategy || '').toUpperCase();
  if (s.includes('HOOK') || s.includes('CLIMAX')) {
    return {
      badge: 'border border-rose-500/50 bg-rose-500/20 text-rose-300',
      dot: 'bg-rose-400',
      text: 'text-rose-400'
    };
  }
  if (s.includes('METAPHOR')) {
    return {
      badge: 'border border-purple-500/50 bg-purple-500/20 text-purple-300',
      dot: 'bg-purple-400',
      text: 'text-purple-400'
    };
  }
  if (s.includes('POSE') || s.includes('CHURN')) {
    return {
      badge: 'border border-amber-500/50 bg-amber-500/20 text-amber-300',
      dot: 'bg-amber-400',
      text: 'text-amber-400'
    };
  }
  if (s.includes('SPLIT')) {
    return {
      badge: 'border border-emerald-500/50 bg-emerald-500/20 text-emerald-300',
      dot: 'bg-emerald-400',
      text: 'text-emerald-400'
    };
  }
  if (s.includes('TITLE') || s.includes('CARD')) {
    return {
      badge: 'border border-yellow-500/50 bg-yellow-500/20 text-yellow-300',
      dot: 'bg-yellow-400',
      text: 'text-yellow-400'
    };
  }
  // LITERAL / DEFAULT
  return {
    badge: 'border border-amber-500/40 bg-amber-500/15 text-amber-200',
    dot: 'bg-amber-400',
    text: 'text-amber-300'
  };
}

/**
 * Escape HTML special characters
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function serializeForScript(obj) {
  return JSON.stringify(obj)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Ensure .lavish directory and symlinks for assets
 */
function ensureLavishWorkspace() {
  const lavishDir = path.join(config.PROJECT_DIR, '.lavish');
  if (!fs.existsSync(lavishDir)) {
    fs.mkdirSync(lavishDir, { recursive: true });
  }

  const lavishRenders = path.join(lavishDir, 'renders');
  if (!fs.existsSync(lavishRenders)) {
    try {
      fs.symlinkSync('../renders', lavishRenders, 'junction');
    } catch {
      try {
        fs.symlinkSync(config.RENDERS_DIR, lavishRenders);
      } catch {}
    }
  }

  const lavishAudio = path.join(lavishDir, 'audio');
  if (!fs.existsSync(lavishAudio)) {
    try {
      fs.symlinkSync('../audio', lavishAudio, 'junction');
    } catch {
      try {
        fs.symlinkSync(config.AUDIO_DIR, lavishAudio);
      } catch {}
    }
  }

  return lavishDir;
}

/**
 * Locate audio voiceover file for a given shot
 */
function findAudioFile(projectName, baseName, shotId, s) {
  if (s && s.audio && s.audio.file && fs.existsSync(s.audio.file)) {
    const relPath = path.isAbsolute(s.audio.file)
      ? path.relative(config.PROJECT_DIR, s.audio.file).replace(/\\/g, '/')
      : s.audio.file.replace(/\\/g, '/');
    return {
      fullPath: s.audio.file,
      relPath: relPath,
      size: fs.statSync(s.audio.file).size
    };
  }

  const candidates = [
    path.join(config.AUDIO_DIR, projectName, `voice_${shotId}.mp3`),
    path.join(config.AUDIO_DIR, baseName, `voice_${shotId}.mp3`),
    path.join(config.AUDIO_DIR, projectName, `${shotId}.mp3`),
    path.join(config.AUDIO_DIR, baseName, `${shotId}.mp3`)
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).size > 100) {
      const relPath = path.relative(config.PROJECT_DIR, c).replace(/\\/g, '/');
      return {
        fullPath: c,
        relPath: relPath,
        size: fs.statSync(c).size
      };
    }
  }

  return null;
}

/**
 * Locate render file for a given shot across potential naming conventions
 */
function findRenderFile(projectName, baseName, shotId) {
  const candidates = [
    path.join(config.RENDERS_DIR, projectName, `${shotId}.png`),
    path.join(config.RENDERS_DIR, projectName, `${shotId}.jpg`),
    path.join(config.RENDERS_DIR, projectName, `${shotId}.webp`),
    path.join(config.RENDERS_DIR, projectName, `${shotId}.mp4`),
    path.join(config.RENDERS_DIR, baseName, `${shotId}.png`),
    path.join(config.RENDERS_DIR, baseName, `${shotId}.jpg`),
    path.join(config.RENDERS_DIR, baseName, `${shotId}.mp4`),
    path.join(config.RENDERS_DIR, `${shotId}.png`),
    path.join(config.RENDERS_DIR, `${shotId}.jpg`),
    path.join(config.RENDERS_DIR, `${shotId}.mp4`)
  ];

  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).size > 100) {
      const relPath = path.relative(config.RENDERS_DIR, c).replace(/\\/g, '/');
      const isVideo = c.endsWith('.mp4');
      return {
        fullPath: c,
        relPath: `renders/${relPath}`,
        type: isVideo ? 'video' : 'image',
        size: fs.statSync(c).size
      };
    }
  }

  return null;
}

/**
 * Generate interactive HTML Director's Review Board
 *
 * @param {Object} storyboardData - Parsed JSON object of storyboard
 * @param {Object} [options] - Configuration options
 * @param {string} [options.storyboardPath] - Path to storyboard file
 * @param {string} [options.out] - Explicit output path for HTML
 * @param {boolean} [options.open] - Launch lavish-axi automatically
 * @returns {string} - Absolute path to generated HTML artifact
 */
function generateBoard(storyboardData, options = {}) {
  const lavishDir = ensureLavishWorkspace();

  const sb = storyboardData || {};
  const sbPath = options.storyboardPath || '';
  const baseName = sbPath ? path.basename(sbPath, '.json') : 'storyboard';
  const projectName = sb.project_name
    || (sb.project && sb.project.id ? sb.project.id : null)
    || sb.series_id
    || baseName;

  const title = (sb.project && sb.project.title)
    || sb.title
    || sb.project_name
    || baseName.replace(/_/g, ' ').toUpperCase();

  const format = (sb.project && sb.project.format)
    || sb.format
    || (sb.geometry?.aspect_ratio === '9:16' || sb.aspect_ratio === '9:16' ? 'Vertical Shorts (9:16)' : 'Universal Explainer (16:9)');

  const aspectRatio = sb.geometry?.aspect_ratio
    || sb.aspect_ratio
    || (sb.project && sb.project.aspect_ratio)
    || '16:9';

  const resolution = sb.geometry?.resolution
    || (sb.project && sb.project.resolution)
    || '1080p';

  const voiceProvider = sb.voice?.provider
    || sb.tts_provider
    || 'f5-tts';

  const voiceSpeed = sb.voice?.settings?.speed
    || sb.voice?.speed
    || '0.90x';

  const rawShots = sb.shots || [];
  let cumulativeTime = 0;
  let renderedCount = 0;
  let audioReadyCount = 0;

  const shots = rawShots.map((s, index) => {
    const shotNum = index + 1;
    const shotId = s.id || `shot_${String(shotNum).padStart(3, '0')}`;
    let duration = parseFloat(s.duration || s.duration_sec);
    if (isNaN(duration) || duration <= 0) {
      duration = 2.5;
    }
    const startSec = cumulativeTime;
    const endSec = cumulativeTime + duration;
    cumulativeTime = endSec;

    const narration = (s.voice && s.voice.text)
      || s.clause
      || (s.audio && s.audio.voiceover)
      || (s.audio && s.audio.sub_text)
      || s.vietnamese_subtitles
      || s.subtitles
      || '';

    const prompt = s.image_prompt
      || s.prompt
      || s.flow_prompt
      || '';

    const subClause = s.sub_clause
      || s.subClause
      || '';

    const strategy = s.strategy
      || s.hook_type
      || (format.includes('Shorts') ? (shotNum === 1 ? 'HOOK' : 'DOCUMENTARY') : 'LITERAL');

    const palette = s.palette
      || s.environment
      || '';

    const wordCount = narration.trim().length > 0 ? narration.trim().split(/\s+/).length : 0;
    const wps = duration > 0 ? (wordCount / duration).toFixed(1) : '0.0';

    const render = findRenderFile(projectName, baseName, shotId);
    if (render) renderedCount++;

    const audio = findAudioFile(projectName, baseName, shotId, s);
    if (audio) audioReadyCount++;

    const audioStart = (s.audio && typeof s.audio.audio_start === 'number')
      ? s.audio.audio_start
      : (typeof s.audio_start === 'number' ? s.audio_start : 0);

    return {
      shotNum,
      shotId,
      duration,
      startSec,
      endSec,
      timeRange: `${formatTime(startSec, true)} - ${formatTime(endSec, true)}`,
      narration,
      subClause,
      prompt,
      strategy,
      strategyStyle: getStrategyStyle(strategy),
      palette,
      wordCount,
      wps,
      render,
      audio,
      audioSrc: audio ? audio.relPath : '',
      audioStart
    };
  });

  // Pass 2: Detect multi-cut clusters and resolve segmented spoken phrases
  let cIdx = 0;
  while (cIdx < shots.length) {
    const clause = (shots[cIdx].narration || '').trim();
    if (!clause) {
      shots[cIdx].spokenPhrase = '';
      shots[cIdx].isMultiCut = false;
      shots[cIdx].multiCutIndex = 1;
      shots[cIdx].multiCutTotal = 1;
      shots[cIdx].cutWordCount = 0;
      cIdx++;
      continue;
    }

    let endCluster = cIdx + 1;
    while (endCluster < shots.length && (shots[endCluster].narration || '').trim() === clause) {
      endCluster++;
    }

    const clusterSize = endCluster - cIdx;
    if (clusterSize > 1) {
      const words = clause.split(/\s+/);
      for (let k = 0; k < clusterSize; k++) {
        const idx = cIdx + k;
        shots[idx].isMultiCut = true;
        shots[idx].multiCutIndex = k + 1;
        shots[idx].multiCutTotal = clusterSize;

        const startWord = Math.floor((k * words.length) / clusterSize);
        const endWord = (k === clusterSize - 1) ? words.length : Math.floor(((k + 1) * words.length) / clusterSize);
        const slice = words.slice(startWord, endWord);

        let phrase = slice.join(' ');
        if (k > 0) phrase = '...' + phrase;
        if (k < clusterSize - 1) phrase = phrase + '...';

        shots[idx].spokenPhrase = phrase;
        shots[idx].cutWordCount = slice.length;
        shots[idx].wps = shots[idx].duration > 0 ? (slice.length / shots[idx].duration).toFixed(1) : '0.0';
      }
    } else {
      shots[cIdx].isMultiCut = false;
      shots[cIdx].multiCutIndex = 1;
      shots[cIdx].multiCutTotal = 1;
      shots[cIdx].spokenPhrase = clause;
      const wc = clause.split(/\s+/).length;
      shots[cIdx].cutWordCount = wc;
      shots[cIdx].wps = shots[cIdx].duration > 0 ? (wc / shots[cIdx].duration).toFixed(1) : '0.0';
    }
    cIdx = endCluster;
  }

  const totalShots = shots.length;
  const totalDurationSec = Math.round(cumulativeTime);
  const totalDurationFormatted = formatTime(totalDurationSec, false);
  const progressPercent = totalShots > 0 ? Math.round((renderedCount / totalShots) * 100) : 0;
  const pendingCount = Math.max(0, totalShots - renderedCount);

  // Build metadata map for instant client-side lightbox and live polling
  const shotsMap = {};
  for (const s of shots) {
    shotsMap[s.shotId] = {
      shotNum: s.shotNum,
      shotId: s.shotId,
      timeRange: s.timeRange,
      duration: s.duration,
      narration: s.narration,
      spokenPhrase: s.spokenPhrase,
      isMultiCut: s.isMultiCut,
      multiCutIndex: s.multiCutIndex,
      multiCutTotal: s.multiCutTotal,
      subClause: s.subClause,
      cutWordCount: s.cutWordCount,
      wps: s.wps,
      prompt: s.prompt,
      strategy: s.strategy,
      strategyStyle: s.strategyStyle,
      palette: s.palette,
      relPath: s.render ? s.render.relPath : `renders/${projectName}/${s.shotId}.png`,
      audioSrc: s.audioSrc || '',
      audioStart: s.audioStart || 0
    };
  }

  // Extract unique strategies for filters
  const uniqueStrategies = Array.from(new Set(shots.map(s => s.strategy).filter(Boolean)));

  // Output file resolution
  const outPath = options.out
    ? path.resolve(options.out)
    : path.join(lavishDir, `board_${baseName}.html`);

  const html = `<!DOCTYPE html>
<html lang="en" data-theme="luxury">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[${renderedCount}/${totalShots} · ${progressPercent}%] Director's Board — ${escapeHtml(title)}</title>

  <!-- DaisyUI 5 & Tailwind CSS Browser Runtime v4 CDN (Lavish Standard) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>

  <style>
    *, *::before, *::after { box-sizing: border-box; }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background-color: #1c1917;
      color: #fffbeb;
    }
    .font-mono {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    .shot-card.hidden-by-filter {
      display: none !important;
    }
    .filter-btn-active {
      background-color: #44362a !important;
      color: #fef3c7 !important;
      border-color: #f59e0b !important;
    }
  </style>

  <script>
    // Universal Media Path Resolver for both .lavish/ and Windows Desktop
    window.addEventListener('error', function(e) {
      if (e.target && e.target.tagName === 'IMG' && !e.target.dataset.triedFallback) {
        e.target.dataset.triedFallback = 'true';
        var src = e.target.src || '';
        if (src.indexOf('/.lavish/renders/') !== -1) {
          e.target.src = src.replace('/.lavish/renders/', '/renders/');
        }
      }
    }, true);
  </script>
</head>
<body class="min-h-screen pb-16 selection:bg-amber-600 selection:text-white">

  <!-- Top Studio Navigation Bar -->
  <header class="border-b border-[#44403c] bg-[#292524] sticky top-0 z-40 px-4 lg:px-8 py-3.5 shadow-xl">
    <div class="max-w-7xl mx-auto flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      
      <!-- Studio Brand & Project Identity -->
      <div class="flex items-center gap-3.5">
        <div class="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-600 to-orange-700 border border-amber-400/40 flex items-center justify-center text-white shadow-lg shrink-0">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
          </svg>
        </div>
        <div>
          <div class="text-xs uppercase font-mono tracking-widest text-amber-400 font-bold">VIDEOGEN // VISUAL CUTTING ROOM</div>
          <h1 class="text-base md:text-xl font-bold text-[#fffbeb] font-mono tracking-tight truncate max-w-md lg:max-w-xl">
            ${escapeHtml(title)}
          </h1>
          <div class="text-xs text-amber-200/80 font-mono flex items-center gap-2 mt-0.5">
            <span class="text-amber-300 font-semibold">${escapeHtml(format)}</span>
            <span>•</span>
            <span class="text-amber-200/60">${escapeHtml(aspectRatio)}</span>
            <span>•</span>
            <span class="text-[#fffbeb] font-bold">${totalShots} cuts (${totalDurationFormatted})</span>
            <span>•</span>
            <span class="text-emerald-300 font-semibold">${escapeHtml(voiceProvider)} @ ${voiceSpeed}</span>
            ${audioReadyCount > 0 ? `<span>•</span><span class="text-cyan-300 font-semibold font-mono">🔊 Voice: ${audioReadyCount}/${totalShots} ready</span>` : ''}
          </div>
        </div>
      </div>

      <!-- Studio Progress & Render Tally -->
      <div class="flex items-center gap-4 self-stretch md:self-auto justify-between md:justify-end">
        <div class="text-right">
          <div class="text-xs font-mono text-amber-200/90">
            Rendered: <span id="readiness_ready_label" class="font-bold text-emerald-400 text-sm md:text-base">${renderedCount} of ${totalShots}</span>
            <span class="text-amber-400/50">•</span>
            <span id="readiness_percent_label" class="font-extrabold text-amber-300 text-sm md:text-base">${progressPercent}%</span>
          </div>
          <div class="w-52 lg:w-72 h-3 bg-[#1c1917] border border-[#44403c] rounded-full overflow-hidden p-0.5 mt-1.5 shadow-inner">
            <div id="readiness_progress_bar" class="h-full bg-gradient-to-r from-amber-400 via-orange-400 to-emerald-400 rounded-full transition-all duration-300 shadow" style="width: ${progressPercent}%;"></div>
          </div>
          <div id="readiness_pending_label" class="text-xs font-mono text-amber-200/70 mt-1">
            ${pendingCount === 0 ? '✓ Complete footage ready' : pendingCount + ' pending render'}
          </div>
        </div>

        <!-- Quick Production Actions -->
        <div class="flex items-center gap-2">
          <button type="button" onclick="copyCommandBtn(this)" data-cmd="./videogen render ${escapeHtml(sbPath || baseName + '.json')}" class="px-3.5 py-1.5 bg-[#3a312a] hover:bg-[#4a3e35] text-amber-200 border border-[#57483d] rounded-lg font-mono text-xs font-semibold cursor-pointer shadow transition-all" title="Copy Render Command">
            Render
          </button>
          <button type="button" onclick="copyCommandBtn(this)" data-cmd="./videogen assemble ${escapeHtml(sbPath || baseName + '.json')}" class="px-3.5 py-1.5 bg-[#3a312a] hover:bg-[#4a3e35] text-emerald-300 border border-emerald-500/40 rounded-lg font-mono text-xs font-semibold cursor-pointer shadow transition-all" title="Copy Assemble Command">
            Assemble
          </button>
        </div>
      </div>
    </div>
  </header>

  <!-- Main Cutting Desk Workspace -->
  <main class="max-w-7xl mx-auto px-4 lg:px-8 pt-6">

    <!-- Controls & Filtering Strip -->
    <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#292524] p-3 rounded-xl border border-[#44403c] mb-6 shadow-md">
      
      <!-- Filter Segmented Tabs -->
      <div class="flex items-center gap-2.5 flex-wrap">
        <div class="flex items-center border border-[#44403c] rounded-lg overflow-hidden bg-[#1c1917] p-0.5">
          <button id="filter_btn_all" class="px-3.5 py-1.5 text-xs font-mono font-semibold filter-btn filter-btn-active rounded-md transition-all cursor-pointer" data-filter="all" onclick="setFilter('all', this)">All (${totalShots})</button>
          <button id="filter_btn_rendered" class="px-3.5 py-1.5 text-xs font-mono font-semibold filter-btn text-emerald-400 hover:text-emerald-300 rounded-md transition-all cursor-pointer" data-filter="rendered" onclick="setFilter('rendered', this)">Rendered (${renderedCount})</button>
          <button id="filter_btn_pending" class="px-3.5 py-1.5 text-xs font-mono font-semibold filter-btn text-amber-400 hover:text-amber-300 rounded-md transition-all cursor-pointer" data-filter="pending" onclick="setFilter('pending', this)">Pending (${pendingCount})</button>
        </div>

        ${uniqueStrategies.length > 0 ? `
        <select id="strategy_select" class="bg-[#1c1917] border border-[#44403c] text-amber-100 font-mono text-xs rounded-lg px-2.5 py-1.5 focus:border-amber-500 outline-none" onchange="applyFilters()">
          <option value="all">All Strategies</option>
          ${uniqueStrategies.map(st => `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`).join('')}
        </select>` : ''}
      </div>

      <!-- Search & View Mode -->
      <div class="flex items-center gap-2.5 justify-end">
        <div class="relative w-56 lg:w-72">
          <input
            type="text"
            id="search_input"
            placeholder="Search prompt or spoken clause..."
            class="w-full bg-[#1c1917] border border-[#44403c] text-amber-50 font-mono text-xs rounded-lg px-3 py-1.5 pl-8 pr-8 placeholder:text-amber-200/40 focus:outline-none focus:border-amber-500"
            oninput="applyFilters()"
          >
          <svg class="w-4 h-4 text-amber-400/50 absolute left-2.5 top-2 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <button id="clear_search" class="absolute right-2.5 top-1.5 text-amber-300/60 hover:text-white hidden text-xs font-mono cursor-pointer" onclick="clearSearch()">
            <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <!-- View Mode: Grid / Table -->
        <div class="flex items-center border border-[#44403c] rounded-lg overflow-hidden bg-[#1c1917] p-0.5">
          <button id="view_grid_btn" class="px-2.5 py-1.5 text-xs font-mono bg-[#44362a] text-amber-300 rounded-md cursor-pointer" title="Card Grid View" onclick="setViewMode('grid')">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
            </svg>
          </button>
          <button id="view_table_btn" class="px-2.5 py-1.5 text-xs font-mono bg-transparent text-amber-200/50 hover:text-white rounded-md cursor-pointer" title="Table View" onclick="setViewMode('table')">
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Active Filter Status & Keyboard Shortcuts Helper -->
    <div class="flex items-center justify-between px-1 mb-3.5 text-xs font-mono text-amber-200/80">
      <span id="filtered_count_label" class="font-bold text-amber-300">Showing all ${totalShots} cuts</span>
      <div class="hidden sm:flex items-center gap-3 text-amber-200/60 text-[11px]">
        <span><kbd class="px-1.5 py-0.5 bg-[#292524] border border-[#44403c] rounded text-amber-200 font-bold">Space</kbd> Zoom</span>
        <span><kbd class="px-1.5 py-0.5 bg-[#292524] border border-[#44403c] rounded text-amber-200 font-bold">←</kbd> <kbd class="px-1.5 py-0.5 bg-[#292524] border border-[#44403c] rounded text-amber-200 font-bold">→</kbd> Browse</span>
        <span><kbd class="px-1.5 py-0.5 bg-[#292524] border border-[#44403c] rounded text-amber-200 font-bold">C</kbd> Copy prompt</span>
        <span><kbd class="px-1.5 py-0.5 bg-[#292524] border border-[#44403c] rounded text-amber-200 font-bold">Esc</kbd> Close</span>
      </div>
    </div>

    <!-- View Mode: Studio Card Grid (Default) -->
    <div id="grid_view_container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
      ${shots.map(s => {
        const isRendered = !!s.render;
        const mediaSrc = isRendered ? s.render.relPath : '';
        const isVideo = isRendered && s.render.type === 'video';
        const strat = s.strategyStyle || getStrategyStyle(s.strategy);

        return `
        <article
          class="bg-[#292524] border border-[#44403c] hover:border-amber-500/80 shadow-lg hover:shadow-2xl rounded-xl overflow-hidden transition-all duration-150 flex flex-col shot-card"
          data-shot-id="${escapeHtml(s.shotId)}"
          data-strategy="${escapeHtml(s.strategy)}"
          data-rendered="${isRendered ? 'true' : 'false'}"
          data-text="${escapeHtml((s.spokenPhrase + ' ' + s.narration + ' ' + s.prompt + ' ' + s.shotId + ' ' + s.palette).toLowerCase())}"
        >
          <!-- Media Box (16:9) with Studio Tally Bar -->
          <div class="relative bg-[#1c1917] aspect-video overflow-hidden media-preview-box">
            ${isRendered ? (isVideo ? `
              <video src="${escapeHtml(mediaSrc)}" controls preload="metadata" class="w-full h-full object-cover"></video>
            ` : `
              <img
                src="${escapeHtml(mediaSrc)}"
                onerror="if(!this.dataset.triedFallback){this.dataset.triedFallback='true';if(this.src.indexOf('/.lavish/renders/')!==-1)this.src=this.src.replace('/.lavish/renders/','/renders/');}"
                alt="${escapeHtml(s.shotId)}"
                data-shot-id="${escapeHtml(s.shotId)}"
                loading="lazy"
                class="w-full h-full object-cover cursor-pointer"
                onclick="openLightboxFor(this.dataset.shotId)"
              >
            `) : `
              <div class="w-full h-full flex flex-col items-center justify-center p-3 text-center border-2 border-dashed border-[#44403c] bg-[#1c1917]">
                <div class="w-7 h-7 rounded-full border border-amber-500/40 flex items-center justify-center text-amber-400 mb-1.5">
                  <span class="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse"></span>
                </div>
                <div class="text-xs font-mono font-extrabold tracking-wider text-amber-300 uppercase">#${s.shotNum} QUEUED</div>
                <div class="text-xs font-mono text-amber-200/70 mt-0.5">${escapeHtml(s.timeRange)} • ${escapeHtml(s.strategy)}</div>
              </div>
            `}

            <!-- Integrated Studio Tally Strip -->
            <div class="absolute inset-x-0 bottom-0 px-3 py-1.5 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex items-center justify-between text-xs font-mono pointer-events-none">
              <div class="flex items-center gap-1.5 text-amber-100">
                <span class="font-bold text-amber-300 text-sm">#${s.shotNum}</span>
                <span class="text-amber-500/60">·</span>
                <span class="text-amber-200/90 text-xs">${escapeHtml(s.timeRange)}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase ${strat.badge}">${escapeHtml(s.strategy)}</span>
                ${isRendered ? `
                  <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)] inline-block" title="Ready"></span>
                ` : `
                  <span class="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,1)] animate-pulse inline-block" title="Queued"></span>
                `}
              </div>
            </div>
          </div>

          <!-- Card Body: Large Legible Typography & Clean Warm Layout -->
          <div class="p-4 flex flex-col gap-3 flex-grow justify-between">
            <!-- Spoken Clause -->
            <div>
              <div class="text-xs font-mono uppercase text-amber-400 font-bold tracking-wider mb-1.5 flex items-center justify-between">
                <span class="flex items-center gap-1.5 flex-wrap">
                  <span>Spoken Clause</span>
                  ${s.isMultiCut ? `<span class="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-bold font-mono">Part ${s.multiCutIndex}/${s.multiCutTotal}${s.subClause ? ' · ' + escapeHtml(s.subClause.replace(/Hook Cut \d\/\d/, 'Hook')) : ''}</span>` : ''}
                </span>
                <span class="text-amber-200/70 font-semibold flex items-center gap-1.5">
                  ${s.audioSrc ? `
                    <button
                      type="button"
                      class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all cursor-pointer bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 audio-play-btn"
                      data-audio-src="${escapeHtml(s.audioSrc)}"
                      data-audio-start="${s.audioStart || 0}"
                      data-audio-dur="${s.duration}"
                      onclick="toggleShotAudio(this)"
                      title="Play Voiceover (${s.duration}s)"
                    >
                      <svg class="w-3 h-3 play-icon inline" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd" />
                      </svg>
                      <svg class="w-3 h-3 pause-icon hidden animate-pulse text-emerald-400 inline" fill="currentColor" viewBox="0 0 20 20">
                        <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                      </svg>
                      <span>${s.duration}s</span>
                    </button>
                  ` : `<span>${s.duration}s</span>`}
                  <span>(${s.cutWordCount}w • ${s.wps} wps)</span>
                </span>
              </div>
              <p class="text-[16.5px] font-semibold text-[#fffbeb] leading-relaxed line-clamp-2 min-h-[2.8rem]">
                "${escapeHtml(s.spokenPhrase || '[No Spoken Text — SFX / Ambience Only]')}"
              </p>
              ${s.isMultiCut ? `
                <div class="text-[11px] text-amber-200/50 font-normal italic truncate mt-1" title="Full Sentence: ${escapeHtml(s.narration)}">
                  Full: "${escapeHtml(s.narration)}"
                </div>
              ` : ''}
            </div>

            <!-- Prompt Blueprint Box -->
            <div class="bg-[#1c1917] border border-[#44403c] rounded-lg p-2.5 text-xs font-mono">
              <div class="flex items-center justify-between text-[11px] uppercase font-bold text-amber-300 tracking-wider mb-1">
                <span>Prompt Blueprint</span>
                <button
                  type="button"
                  class="text-amber-400 hover:text-amber-300 font-bold uppercase cursor-pointer"
                  data-shot-id="${escapeHtml(s.id)}"
                  onclick="copyShotPrompt(this.dataset.shotId, this)"
                >
                  Copy
                </button>
              </div>
              <p class="line-clamp-3 text-[13px] text-[#e2d6c3] leading-relaxed select-all">
                ${escapeHtml(s.prompt || '[No Prompt Specified]')}
              </p>
            </div>
          </div>
        </article>
        `;
      }).join('\n')}
    </div>

    <!-- View Mode: Compact Table View (Initially Hidden) -->
    <div id="table_view_container" class="hidden overflow-x-auto rounded-xl border border-[#44403c] bg-[#292524] shadow-xl">
      <table class="w-full text-left text-xs font-mono">
        <thead>
          <tr class="bg-[#1c1917] text-amber-300 border-b border-[#44403c] font-bold">
            <th class="p-3">#</th>
            <th class="p-3">Shot ID</th>
            <th class="p-3">Time</th>
            <th class="p-3">Dur</th>
            <th class="p-3">Preview</th>
            <th class="p-3">Strategy</th>
            <th class="p-3">Narration Clause</th>
            <th class="p-3">Prompt</th>
            <th class="p-3">Status</th>
          </tr>
        </thead>
        <tbody>
          ${shots.map(s => {
            const isRendered = !!s.render;
            const mediaSrc = isRendered ? s.render.relPath : '';
            const strat = s.strategyStyle || getStrategyStyle(s.strategy);

            return `
            <tr class="border-b border-[#3a312a] hover:bg-[#342b24] transition-colors shot-card"
                data-shot-id="${escapeHtml(s.shotId)}"
                data-strategy="${escapeHtml(s.strategy)}"
                data-rendered="${isRendered ? 'true' : 'false'}"
                data-text="${escapeHtml(s.narration.toLowerCase() + ' ' + s.prompt.toLowerCase() + ' ' + s.shotId.toLowerCase() + ' ' + s.palette.toLowerCase())}"
            >
              <td class="p-3 font-bold text-[#fffbeb] text-sm">${s.shotNum}</td>
              <td class="p-3 text-amber-200/90">${escapeHtml(s.shotId)}</td>
              <td class="p-3 text-amber-200/90">${escapeHtml(s.timeRange)}</td>
              <td class="p-3 text-amber-200/90">
                ${s.audioSrc ? `
                  <button
                    type="button"
                    class="audio-play-btn inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-mono font-bold bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 cursor-pointer"
                    data-audio-src="${escapeHtml(s.audioSrc)}"
                    data-audio-start="${s.audioStart || 0}"
                    data-audio-dur="${s.duration}"
                    onclick="toggleShotAudio(this)"
                    title="Play voiceover (${s.duration}s)"
                  >
                    <span class="play-icon">▶</span>
                    <span class="pause-icon hidden text-emerald-400 animate-pulse">⏸</span>
                    <span>${s.duration}s</span>
                  </button>
                ` : `${s.duration}s`}
              </td>
              <td class="p-3 table-media-cell">
                ${isRendered ? `
                  <img src="${escapeHtml(mediaSrc)}" onerror="if(!this.dataset.triedFallback){this.dataset.triedFallback='true';if(this.src.indexOf('/.lavish/renders/')!==-1)this.src=this.src.replace('/.lavish/renders/','/renders/');}" alt="${escapeHtml(s.shotId)}" data-shot-id="${escapeHtml(s.shotId)}" class="w-20 h-11 object-cover rounded-md cursor-pointer border border-[#44403c] hover:border-amber-400 transition-colors" onclick="openLightboxFor(this.dataset.shotId)">
                ` : `
                  <div class="w-20 h-11 bg-[#1c1917] border border-dashed border-[#44403c] rounded-md flex items-center justify-center text-[10px] text-amber-400 font-bold font-mono">Queued</div>
                `}
              </td>
              <td class="p-3"><span class="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider ${strat.badge}">${escapeHtml(s.strategy)}</span></td>
              <td class="p-3 max-w-xs text-sm text-[#fffbeb] truncate" title="${escapeHtml(s.spokenPhrase)} (Full: ${escapeHtml(s.narration)})">
                ${s.isMultiCut ? `<span class="px-1 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-[10px] font-mono mr-1.5 font-bold">[Part ${s.multiCutIndex}/${s.multiCutTotal}]</span>` : ''}
                ${escapeHtml(s.spokenPhrase)}
              </td>
              <td class="p-3 max-w-xs text-xs font-mono text-amber-200/80 truncate" title="${escapeHtml(s.prompt)}">${escapeHtml(s.prompt)}</td>
              <td class="p-3 table-status-cell">
                ${isRendered ? '<span class="text-emerald-400 font-extrabold text-xs">Ready</span>' : '<span class="text-amber-400 font-bold text-xs">Queued</span>'}
              </td>
            </tr>
            `;
          }).join('\n')}
        </tbody>
      </table>
    </div>

    <!-- Empty Filter Notice -->
    <div id="no_results_box" class="bg-[#292524] border border-[#44403c] rounded-xl p-12 text-center my-8 hidden">
      <div class="text-base font-mono font-bold text-[#fffbeb]">NO MATCHING SHOTS</div>
      <p class="text-xs text-amber-200/70 mt-1 font-mono">No shots match your search query or filter selection.</p>
      <div class="mt-4">
        <button class="px-4 py-1.5 bg-[#3a312a] hover:bg-[#4a3e35] text-amber-200 border border-[#57483d] rounded-lg font-mono text-xs font-semibold cursor-pointer" onclick="resetAllFilters()">Reset Filters</button>
      </div>
    </div>
  </main>

  <!-- Studio Lightbox Modal (Centered Fixed Overlay) -->
  <div id="lightbox_modal" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs p-4 md:p-8 flex items-center justify-center hidden overflow-y-auto" onclick="if(event.target === this) closeLightbox()">
    <div class="relative w-full max-w-4xl my-auto bg-[#241e1a] border border-[#4a3c30] rounded-2xl shadow-2xl overflow-hidden flex flex-col" onclick="event.stopPropagation()">
      <!-- Image Display Area -->
      <div class="relative bg-black/95 flex items-center justify-center max-h-[60vh] overflow-hidden">
        <img id="lightbox_img" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3C/svg%3E" alt="Preview" class="max-h-[60vh] w-auto object-contain">
        <button class="w-9 h-9 rounded-full bg-black/70 hover:bg-black/95 text-white flex items-center justify-center absolute right-3 top-3 cursor-pointer shadow-lg transition-transform hover:scale-110" onclick="closeLightbox()" title="Close (Esc)">
          <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      
      <!-- Metadata & Inspector Controls -->
      <div class="p-5 md:p-6 bg-[#241e1a] border-t border-[#3d322a]">
        <div class="flex items-center justify-between gap-3 mb-4 font-mono text-sm">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span id="lightbox_shot_id" class="font-extrabold text-amber-300 text-lg md:text-xl"></span>
            <span class="text-amber-500/60">•</span>
            <span id="lightbox_timerange" class="text-amber-200/90 text-sm font-semibold"></span>
            <span class="text-amber-500/60">•</span>
            <span id="lightbox_strategy" class="text-amber-400 font-bold uppercase text-xs px-2.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30"></span>
          </div>
          <div class="flex items-center gap-2">
            <button id="lightbox_audio_btn" class="audio-play-btn px-3 py-1.5 bg-[#2d241e] hover:bg-[#3d3128] text-amber-300 border border-amber-500/40 rounded-lg font-mono text-xs font-semibold cursor-pointer transition-all inline-flex items-center gap-1.5 hidden" onclick="toggleLightboxAudio()">
              <span class="play-icon">▶ Play Voice</span>
              <span class="pause-icon hidden text-emerald-400">⏸ Pause</span>
            </button>
            <button class="px-3.5 py-1.5 bg-[#2d241e] hover:bg-[#3d3128] text-amber-200 border border-[#4a3c30] rounded-lg font-mono text-xs font-semibold cursor-pointer transition-all" onclick="navigateLightbox(-1)">← Prev</button>
            <button class="px-3.5 py-1.5 bg-[#2d241e] hover:bg-[#3d3128] text-amber-200 border border-[#4a3c30] rounded-lg font-mono text-xs font-semibold cursor-pointer transition-all" onclick="navigateLightbox(1)">Next →</button>
            <button class="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg font-mono text-xs font-bold cursor-pointer transition-all shadow" onclick="copyLightboxPrompt()">Copy Prompt</button>
          </div>
        </div>

        <div class="bg-[#1b1613] border border-[#382d24] rounded-xl p-4 mb-3">
          <div class="flex items-center justify-between mb-1.5 flex-wrap gap-2">
            <span class="text-xs uppercase font-mono font-bold tracking-wider text-amber-400">Spoken Clause</span>
            <span id="lightbox_multicut_badge" class="px-2 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded text-xs font-bold hidden font-mono"></span>
          </div>
          <p id="lightbox_phrase" class="text-lg md:text-xl font-bold text-[#fffbeb] leading-relaxed mb-1"></p>
          <p id="lightbox_full_clause" class="text-xs text-amber-200/60 italic font-mono hidden"></p>
        </div>

        <div class="bg-[#1b1613] border border-[#382d24] rounded-xl p-4">
          <div class="text-xs uppercase font-mono font-bold tracking-wider text-amber-400 mb-1.5">Prompt Blueprint</div>
          <p id="lightbox_prompt" class="font-mono text-sm text-[#fef3c7] leading-relaxed whitespace-pre-wrap select-all"></p>
        </div>
      </div>
    </div>
  </div>

  <!-- Toast Notification -->
  <div id="toast" class="fixed bottom-4 right-4 z-50 hidden">
    <div class="bg-[#292524] border border-amber-500/50 text-[#fffbeb] py-2 px-4 rounded-lg text-xs font-mono shadow-2xl">
      <span id="toast_msg">Copied to clipboard</span>
    </div>
  </div>

  <!-- Interactive Filtering & Client Script -->
  <script>
    let currentFilter = 'all';
    let currentView = 'grid';
    let currentLightboxShotId = null;

    function setViewMode(mode) {
      currentView = mode;
      const gridBox = document.getElementById('grid_view_container');
      const tableBox = document.getElementById('table_view_container');
      const gridBtn = document.getElementById('view_grid_btn');
      const tableBtn = document.getElementById('view_table_btn');

      if (mode === 'grid') {
        gridBox.classList.remove('hidden');
        tableBox.classList.add('hidden');
        gridBtn.classList.add('bg-[#44362a]', 'text-amber-300');
        gridBtn.classList.remove('bg-transparent', 'text-amber-200/50');
        tableBtn.classList.add('bg-transparent', 'text-amber-200/50');
        tableBtn.classList.remove('bg-[#44362a]', 'text-amber-300');
      } else {
        gridBox.classList.add('hidden');
        tableBox.classList.remove('hidden');
        tableBtn.classList.add('bg-[#44362a]', 'text-amber-300');
        tableBtn.classList.remove('bg-transparent', 'text-amber-200/50');
        gridBtn.classList.add('bg-transparent', 'text-amber-200/50');
        gridBtn.classList.remove('bg-[#44362a]', 'text-amber-300');
      }
    }

    function setFilter(filter, el) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.remove('filter-btn-active');
        btn.classList.add('bg-transparent');
      });
      if (el) {
        el.classList.add('filter-btn-active');
        el.classList.remove('bg-transparent');
      }
      applyFilters();
    }

    function clearSearch() {
      const input = document.getElementById('search_input');
      input.value = '';
      document.getElementById('clear_search').classList.add('hidden');
      applyFilters();
    }

    function resetAllFilters() {
      document.getElementById('search_input').value = '';
      const stratSelect = document.getElementById('strategy_select');
      if (stratSelect) stratSelect.value = 'all';
      setFilter('all', document.getElementById('filter_btn_all'));
    }

    function applyFilters() {
      const query = (document.getElementById('search_input').value || '').trim().toLowerCase();
      const clearBtn = document.getElementById('clear_search');
      if (query.length > 0) {
        clearBtn.classList.remove('hidden');
      } else {
        clearBtn.classList.add('hidden');
      }

      const strategySelect = document.getElementById('strategy_select');
      const selectedStrategy = strategySelect ? strategySelect.value : 'all';

      const items = document.querySelectorAll('.shot-card');
      let visibleCount = 0;

      items.forEach(item => {
        const isRendered = item.getAttribute('data-rendered') === 'true';
        const itemStrategy = item.getAttribute('data-strategy') || '';
        const itemText = item.getAttribute('data-text') || '';

        let statusMatch = true;
        if (currentFilter === 'rendered') statusMatch = isRendered;
        if (currentFilter === 'pending') statusMatch = !isRendered;

        let strategyMatch = true;
        if (selectedStrategy !== 'all') {
          strategyMatch = (itemStrategy === selectedStrategy);
        }

        let queryMatch = true;
        if (query.length > 0) {
          queryMatch = itemText.includes(query);
        }

        if (statusMatch && strategyMatch && queryMatch) {
          item.classList.remove('hidden-by-filter');
          visibleCount++;
        } else {
          item.classList.add('hidden-by-filter');
        }
      });

      const countLabel = document.getElementById('filtered_count_label');
      if (countLabel) {
        countLabel.innerText = 'Showing ' + visibleCount + ' of ${totalShots} cuts';
      }

      const noResults = document.getElementById('no_results_box');
      if (noResults) {
        if (visibleCount === 0) {
          noResults.classList.remove('hidden');
        } else {
          noResults.classList.add('hidden');
        }
      }
    }

    const SHOTS_MAP = ${serializeForScript(shotsMap)};
    const SHOT_IDS = Object.keys(SHOTS_MAP);

    function openLightboxFor(shotId) {
      const s = SHOTS_MAP[shotId];
      if (!s) return;
      currentLightboxShotId = shotId;

      const item = document.querySelector('.shot-card[data-shot-id="' + shotId + '"]');
      const img = item ? item.querySelector('img') : null;
      const src = img ? img.src : s.relPath;

      document.getElementById('lightbox_img').src = src;
      document.getElementById('lightbox_shot_id').innerText = '#' + s.shotNum + ' · ' + shotId;
      document.getElementById('lightbox_strategy').innerText = s.strategy || '';
      document.getElementById('lightbox_timerange').innerText = s.timeRange || '';
      
      const badge = document.getElementById('lightbox_multicut_badge');
      const phraseEl = document.getElementById('lightbox_phrase');
      const fullEl = document.getElementById('lightbox_full_clause');

      if (s.isMultiCut) {
        badge.innerText = 'Part ' + s.multiCutIndex + '/' + s.multiCutTotal + (s.subClause ? ' · ' + s.subClause : '');
        badge.classList.remove('hidden');
        phraseEl.innerText = '"' + (s.spokenPhrase || '') + '"';
        fullEl.innerText = 'Full Audio Sentence: "' + (s.narration || '') + '"';
        fullEl.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
        phraseEl.innerText = s.narration ? ('"' + s.narration + '"') : '[No spoken text — SFX / Ambience Only]';
        fullEl.classList.add('hidden');
      }

      document.getElementById('lightbox_prompt').innerText = s.prompt || '[No prompt]';

      const audioBtn = document.getElementById('lightbox_audio_btn');
      if (audioBtn) {
        if (s.audioSrc) {
          audioBtn.setAttribute('data-audio-src', s.audioSrc);
          audioBtn.setAttribute('data-audio-start', s.audioStart || 0);
          audioBtn.setAttribute('data-audio-dur', s.duration || 0);
          audioBtn.classList.remove('hidden');
          const player = document.getElementById('global_audio_player');
          setBtnAudioState(audioBtn, currentAudioSrc === s.audioSrc && player && !player.paused);
        } else {
          audioBtn.classList.add('hidden');
        }
      }
      
      const modal = document.getElementById('lightbox_modal');
      modal.classList.remove('hidden');
    }

    function navigateLightbox(delta) {
      if (!currentLightboxShotId) return;
      const idx = SHOT_IDS.indexOf(currentLightboxShotId);
      if (idx === -1) return;
      let nextIdx = idx + delta;
      if (nextIdx < 0) nextIdx = SHOT_IDS.length - 1;
      if (nextIdx >= SHOT_IDS.length) nextIdx = 0;
      openLightboxFor(SHOT_IDS[nextIdx]);
    }

    function closeLightbox() {
      const modal = document.getElementById('lightbox_modal');
      modal.classList.add('hidden');
      currentLightboxShotId = null;
    }

    function copyLightboxPrompt() {
      const text = document.getElementById('lightbox_prompt').innerText;
      copyText(text);
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard');
        if (btn) {
          const original = btn.innerText;
          btn.innerText = 'Copied';
          setTimeout(() => btn.innerText = original, 1200);
        }
      }).catch(() => {
        showToast('Failed to copy');
      });
    }

    function copyCommand(cmd) {
      copyText(cmd);
    }

    function copyCommandBtn(btn) {
      const cmd = btn ? btn.getAttribute('data-cmd') : null;
      if (cmd) copyCommand(cmd);
    }

    function copyShotPrompt(shotId, btn) {
      const s = SHOTS_MAP[shotId];
      if (s && s.prompt) {
        copyText(s.prompt, btn);
      }
    }

    // Audio Preview Player Core
    let currentAudioSrc = null;
    let currentActiveBtn = null;
    let audioSnippetTimeout = null;

    function toggleShotAudio(btn) {
      const rawAudioSrc = btn ? btn.getAttribute('data-audio-src') : null;
      if (!rawAudioSrc) return;
      const player = document.getElementById('global_audio_player');
      if (!player) return;

      const isLavish = window.location.pathname.indexOf('.lavish') !== -1;
      const audioSrc = (isLavish && !rawAudioSrc.startsWith('../')) ? ('../' + rawAudioSrc) : rawAudioSrc;
      const audioStart = parseFloat(btn.getAttribute('data-audio-start') || 0);
      const audioDur = parseFloat(btn.getAttribute('data-audio-dur') || 0);

      if (audioSnippetTimeout) {
        clearTimeout(audioSnippetTimeout);
        audioSnippetTimeout = null;
      }

      if (currentAudioSrc === audioSrc && currentActiveBtn === btn && !player.paused) {
        player.pause();
        setBtnAudioState(btn, false);
        return;
      }

      if (currentActiveBtn && currentActiveBtn !== btn) {
        setBtnAudioState(currentActiveBtn, false);
      }

      currentAudioSrc = audioSrc;
      currentActiveBtn = btn;
      setBtnAudioState(btn, true);

      function applySnippetPlay() {
        if (!isNaN(audioStart) && audioStart >= 0) {
          player.currentTime = audioStart;
        }
        player.play().then(() => {
          if (audioDur > 0) {
            audioSnippetTimeout = setTimeout(() => {
              if (currentActiveBtn === btn && !player.paused) {
                player.pause();
                setBtnAudioState(btn, false);
              }
            }, (audioDur + 0.15) * 1000);
          }
        }).catch(err => {
          console.warn('[!] Audio play failed:', err.message);
          setBtnAudioState(btn, false);
        });
      }

      if (player.src !== audioSrc && !player.src.endsWith(audioSrc)) {
        player.src = audioSrc;
        player.onloadedmetadata = () => {
          applySnippetPlay();
        };
      } else {
        applySnippetPlay();
      }
    }

    function toggleLightboxAudio() {
      const btn = document.getElementById('lightbox_audio_btn');
      if (btn) toggleShotAudio(btn);
    }

    function setBtnAudioState(btn, isPlaying) {
      if (!btn) return;
      const playIcon = btn.querySelector('.play-icon');
      const pauseIcon = btn.querySelector('.pause-icon');
      if (playIcon) playIcon.classList.toggle('hidden', isPlaying);
      if (pauseIcon) pauseIcon.classList.toggle('hidden', !isPlaying);
      btn.classList.toggle('border-emerald-400', isPlaying);
      btn.classList.toggle('bg-emerald-500/25', isPlaying);
      btn.classList.toggle('text-emerald-300', isPlaying);
    }

    document.addEventListener('DOMContentLoaded', () => {
      const player = document.getElementById('global_audio_player');
      if (player) {
        player.onended = () => {
          if (currentActiveBtn) setBtnAudioState(currentActiveBtn, false);
          const lbBtn = document.getElementById('lightbox_audio_btn');
          if (lbBtn) setBtnAudioState(lbBtn, false);
        };
        player.onpause = () => {
          if (currentActiveBtn) setBtnAudioState(currentActiveBtn, false);
          const lbBtn = document.getElementById('lightbox_audio_btn');
          if (lbBtn) setBtnAudioState(lbBtn, false);
        };
      }
    });

    function showToast(msg) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast_msg');
      if (toast && toastMsg) {
        toastMsg.innerText = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 1800);
      }
    }

    // Keyboard Shortcuts Navigation
    document.addEventListener('keydown', (e) => {
      const modal = document.getElementById('lightbox_modal');
      const isModalOpen = modal && !modal.classList.contains('hidden');

      if (e.key === 'Escape' && isModalOpen) {
        closeLightbox();
        return;
      }
      if (isModalOpen) {
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          navigateLightbox(-1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          navigateLightbox(1);
        } else if (e.key === 'c' || e.key === 'C') {
          copyLightboxPrompt();
        }
      }
    });

    // Hot-DOM In-Place Live Polling (Zero page reload, 100% scroll & review state preserved)
    const EPISODE_PROJECT = '${escapeHtml(projectName)}';
    const EPISODE_TITLE = ${JSON.stringify(title)};
    let totalReady = ${renderedCount};
    const totalCount = ${totalShots};
    let isPollingActive = true;
    let isCheckingPending = false;

    function updateTitleAndTabBadges() {
      const pendingTotal = Math.max(0, totalCount - totalReady);
      const pct = totalCount > 0 ? Math.round((totalReady / totalCount) * 100) : 0;

      // 1. Browser tab title bar: [45/315 · 14%] Director's Board
      document.title = (totalReady >= totalCount)
        ? ("[✓ 100%] Director's Board — " + EPISODE_TITLE)
        : ("[" + totalReady + "/" + totalCount + " · " + pct + "%] Director's Board — " + EPISODE_TITLE);

      // 2. Filter tabs: All, Rendered, Pending
      const btnAll = document.getElementById('filter_btn_all');
      if (btnAll) btnAll.innerText = 'All (' + totalCount + ')';
      const btnRendered = document.getElementById('filter_btn_rendered');
      if (btnRendered) btnRendered.innerText = 'Rendered (' + totalReady + ')';
      const btnPending = document.getElementById('filter_btn_pending');
      if (btnPending) btnPending.innerText = 'Pending (' + pendingTotal + ')';

      // 3. Header Progress Bars
      const pBar = document.getElementById('readiness_progress_bar');
      if (pBar) pBar.style.width = pct + '%';
      const rLabel = document.getElementById('readiness_ready_label');
      if (rLabel) rLabel.innerText = totalReady + ' of ' + totalCount;
      const pLabel = document.getElementById('readiness_percent_label');
      if (pLabel) pLabel.innerText = pct + '%';
      const pendLabel = document.getElementById('readiness_pending_label');
      if (pendLabel) pendLabel.innerText = (pendingTotal === 0 ? '✓ Complete footage ready' : (pendingTotal + ' pending render'));
    }

    // Initialize tab title immediately on page load
    updateTitleAndTabBadges();

    // Floating live status pill
    const statusPill = document.createElement('div');
    statusPill.id = 'live_sync_pill';
    statusPill.className = 'fixed bottom-4 right-4 z-50 bg-[#292524] px-3.5 py-2 rounded-lg shadow-2xl border border-amber-500/40 flex items-center gap-2.5 text-xs font-mono select-none';
    statusPill.innerHTML =
      '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)] animate-pulse inline-block"></span>' +
      '<span id="pill_text" class="text-amber-200/90 font-semibold">Live Sync: <span id="pill_ready_count" class="font-extrabold text-[#fffbeb]">' + totalReady + '</span>/' + totalCount + '</span>';
    document.body.appendChild(statusPill);

    // Automatic broken image fallback for WSL / Desktop path resolution
    window.addEventListener('error', (e) => {
      if (e.target && e.target.tagName === 'IMG' && !e.target.dataset.triedFallback) {
        e.target.dataset.triedFallback = 'true';
        const src = e.target.src || '';
        if (src.indexOf('/.lavish/renders/') !== -1) {
          e.target.src = src.replace('/.lavish/renders/', '/renders/');
        }
      }
    }, true);

    async function pollPendingShots() {
      if (!isPollingActive || isCheckingPending) return;
      isCheckingPending = true;

      const pendingItems = Array.from(document.querySelectorAll('.shot-card[data-rendered="false"]'));
      if (pendingItems.length === 0) {
        statusPill.innerHTML = '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)] inline-block"></span> <span class="font-bold text-emerald-400">✓ 100% Ready (' + totalCount + '/' + totalCount + ')</span>';
        isCheckingPending = false;
        return;
      }

      const isLavish = window.location.pathname.indexOf('.lavish') !== -1;
      const prefix = isLavish ? '../' : '';

      // Check next 20 pending shots in parallel
      const batch = pendingItems.slice(0, 20);
      const checks = batch.map(item => {
        return new Promise(async resolve => {
          const shotId = item.getAttribute('data-shot-id');
          const s = SHOTS_MAP[shotId] || {};
          const strat = s.strategyStyle || { badge: 'border border-amber-500/40 text-amber-200' };
          const baseRel = s.relPath || ('renders/' + EPISODE_PROJECT + '/' + shotId + '.png');
          
          const candidates = Array.from(new Set([
            prefix + baseRel,
            baseRel,
            '../' + baseRel
          ]));

          let workingUrl = null;
          for (const cand of candidates) {
            const ok = await new Promise(r => {
              const testImg = new Image();
              testImg.onload = () => r(true);
              testImg.onerror = () => r(false);
              testImg.src = cand;
            });
            if (ok) {
              workingUrl = cand;
              break;
            }
          }

          if (!workingUrl) {
            return resolve(false);
          }

          // 1. Update Card in Grid View
          const mediaBox = item.querySelector('.media-preview-box');
          if (mediaBox) {
            mediaBox.innerHTML =
              '<img src="' + workingUrl + '" alt="' + shotId + '" data-shot-id="' + shotId + '" loading="lazy" class="w-full h-full object-cover cursor-pointer" onclick="openLightboxFor(this.dataset.shotId)">' +
              '<div class="absolute inset-x-0 bottom-0 px-3 py-1.5 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex items-center justify-between text-xs font-mono pointer-events-none">' +
                '<div class="flex items-center gap-1.5 text-amber-100">' +
                  '<span class="font-bold text-amber-300 text-sm">#' + (s.shotNum || '') + '</span>' +
                  '<span class="text-amber-500/60">·</span>' +
                  '<span class="text-amber-200/90 text-xs">' + (s.timeRange || '') + '</span>' +
                '</div>' +
                '<div class="flex items-center gap-2">' +
                  '<span class="px-2 py-0.5 rounded text-[11px] font-bold tracking-wider uppercase ' + (strat.badge || '') + '">' + (s.strategy || '') + '</span>' +
                  '<span class="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,1)] inline-block" title="Ready"></span>' +
                '</div>' +
              '</div>';
          }

          item.setAttribute('data-rendered', 'true');

          // 2. Update Table View row
          const tableRow = document.querySelector('tr[data-shot-id="' + shotId + '"]');
          if (tableRow) {
            tableRow.setAttribute('data-rendered', 'true');
            const tMedia = tableRow.querySelector('.table-media-cell');
            if (tMedia) {
              tMedia.innerHTML = '<img src="' + workingUrl + '" alt="' + shotId + '" data-shot-id="' + shotId + '" class="w-20 h-11 object-cover rounded-md cursor-pointer border border-[#44403c] hover:border-amber-400 transition-colors" onclick="openLightboxFor(this.dataset.shotId)">';
            }
            const tStatus = tableRow.querySelector('.table-status-cell');
            if (tStatus) {
              tStatus.innerHTML = '<span class="text-emerald-400 font-extrabold text-xs">Ready</span>';
            }
          }

          resolve(true);
        });
      });

      const results = await Promise.all(checks);
      const newlyLoaded = results.filter(Boolean).length;
      if (newlyLoaded > 0) {
        totalReady += newlyLoaded;
        updateTitleAndTabBadges();
        const pillCount = document.getElementById('pill_ready_count');
        if (pillCount) pillCount.innerText = totalReady;

        if (currentFilter === 'rendered' || currentFilter === 'pending') {
          applyFilters();
        }
      }

      isCheckingPending = false;
    }

    // Poll every 2.5 seconds
    setInterval(pollPendingShots, 2500);
  </script>
  <!-- Hidden Global Audio Engine (Zero Preload, Ultra-Lightweight) -->
  <audio id="global_audio_player" preload="none" class="hidden"></audio>
</body>
</html>`;

  fs.writeFileSync(outPath, html, 'utf8');

  // Also write/update canonical .lavish/director_board.html
  const canonicalPath = path.join(lavishDir, 'director_board.html');
  try {
    fs.writeFileSync(canonicalPath, html, 'utf8');
  } catch {}

  const hasLavish = isLavishInstalled();
  const relCanonical = path.relative(config.PROJECT_DIR, canonicalPath);
  const fileUrl = toFileUrl(canonicalPath);

  console.log(`\n============================================================`);
  console.log(`  VIDEOGEN DIRECTOR'S VISUAL REVIEW BOARD GENERATED!`);
  console.log(`============================================================`);
  console.log(`  [✓] Board HTML: ${outPath}`);
  console.log(`  [✓] Canonical:  ${canonicalPath}`);
  console.log(`  [✓] Shots:      ${totalShots} cuts (${renderedCount} rendered, ${pendingCount} pending)`);
  console.log(`  [✓] Est. Time:  ${totalDurationFormatted} (${totalDurationSec}s)`);
  console.log(`------------------------------------------------------------`);
  if (hasLavish) {
    console.log(`  👉 Xem trực tiếp bằng Lavish Editor:`);
    console.log(`     lavish-axi ${relCanonical}`);
    console.log(`     (hoặc mở standalone: ${fileUrl})`);
  } else {
    console.log(`  👉 Mở xem preview trực tiếp trên trình duyệt:`);
    console.log(`     ${fileUrl}`);
  }
  console.log(`============================================================\n`);

  if (options.open && !process.env.CI) {
    if (hasLavish) {
      try {
        console.log(`[i] Đang khởi chạy Lavish Editor...`);
        spawn('lavish-axi', [relCanonical], {
          stdio: 'inherit',
          detached: true
        }).unref();
      } catch (err) {
        console.warn(`[!] Không thể mở tự động bằng lavish-axi: ${err.message}`);
        openInSystemBrowser(canonicalPath);
      }
    } else {
      openInSystemBrowser(canonicalPath);
    }
  }

  return outPath;
}

module.exports = {
  generateBoard,
  toFileUrl,
  isLavishInstalled,
  openInSystemBrowser,
  formatTime,
  getStrategyBadgeClass,
  getStrategyStyle,
  escapeHtml
};
