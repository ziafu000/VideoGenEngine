const fs = require('fs');
const path = require('path');
const { spawnSync, spawn } = require('child_process');
const config = require('./config');

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
  const fileUrl = filePath.startsWith('file://') ? filePath : `file://${path.resolve(filePath)}`;
  const openers = [
    { cmd: 'google-chrome', args: [fileUrl] },
    { cmd: 'google-chrome-stable', args: [fileUrl] },
    { cmd: 'xdg-open', args: [fileUrl] },
    { cmd: 'explorer.exe', args: [config.toWinPath ? config.toWinPath(path.resolve(filePath)) : fileUrl] }
  ];

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
 * Format seconds into MM:SS.ms or MM:SS
 */
function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Determine strategy badge color class for DaisyUI
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

/**
 * Ensure .lavish directory and symlinks for assets
 */
function ensureLavishWorkspace() {
  const lavishDir = path.join(config.PROJECT_DIR, '.lavish');
  if (!fs.existsSync(lavishDir)) {
    fs.mkdirSync(lavishDir, { recursive: true });
  }

  // Ensure symlink .lavish/renders -> ../renders so express server and local file open works
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

  return lavishDir;
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
    || (sb.geometry?.aspect_ratio === '9:16' || sb.aspect_ratio === '9:16' ? 'Vertical Shorts (9:16)' : 'Minimalist Explainer (16:9)');

  const aspectRatio = sb.geometry?.aspect_ratio
    || sb.aspect_ratio
    || (sb.project && sb.project.aspect_ratio)
    || '16:9';

  const resolution = sb.geometry?.resolution
    || (sb.project && sb.project.resolution)
    || '1080p';

  const channel = sb.youtube?.channel
    || (sb.distribution?.targets ? sb.distribution.targets.join(', ') : 'Default / Multi-Channel');

  const voiceProvider = sb.voice?.provider
    || sb.tts_provider
    || 'vieneu';

  const voiceProfile = sb.voice?.profile
    || sb.voice_profile
    || 'default';

  const voiceSpeed = sb.voice?.settings?.speed
    || sb.voice?.speed
    || '1.0x';

  const bgmVolume = sb.audio_mix?.bgm_volume !== undefined
    ? sb.audio_mix.bgm_volume
    : (sb.bgm_volume !== undefined ? sb.bgm_volume : 0.15);

  const rawShots = sb.shots || [];
  let cumulativeTime = 0;
  let renderedCount = 0;

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

    const strategy = s.strategy
      || s.hook_type
      || (format.includes('Shorts') ? (shotNum === 1 ? 'HOOK' : 'DOCUMENTARY') : 'LITERAL');

    const palette = s.palette
      || s.environment
      || '';

    const rawChars = s.characters || (s.character ? [s.character] : (s.chip ? [s.chip] : []));
    const characters = Array.isArray(rawChars) ? rawChars : [rawChars];

    const wordCount = narration.trim().length > 0 ? narration.trim().split(/\s+/).length : 0;
    const wps = duration > 0 ? (wordCount / duration).toFixed(1) : '0.0';

    const render = findRenderFile(projectName, baseName, shotId);
    if (render) renderedCount++;

    return {
      shotNum,
      shotId,
      duration,
      startSec,
      endSec,
      timeRange: `${formatTime(startSec)} - ${formatTime(endSec)}`,
      narration,
      prompt,
      strategy,
      palette,
      characters,
      wordCount,
      wps,
      render
    };
  });

  const totalShots = shots.length;
  const totalDurationSec = Math.round(cumulativeTime);
  const totalDurationFormatted = formatTime(totalDurationSec);
  const progressPercent = totalShots > 0 ? Math.round((renderedCount / totalShots) * 100) : 0;
  const pendingCount = totalShots - renderedCount;

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
  <title>Director's Board — ${escapeHtml(title)}</title>

  <!-- DaisyUI 5 & Tailwind CSS Browser Runtime v4 CDN (Lavish Standard) -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/daisyui.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5.5.19/themes.css">
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.2.4/dist/index.global.js"></script>

  <!-- Lavish Layout Safety Snippet -->
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    :where(.grid, .flex, .layout-grid, .layout-flex) > *,
    :where([style*="display: grid"], [style*="display:grid"], [style*="display: flex"], [style*="display:flex"]) > * {
      min-width: 0;
    }
    :where(p, h1, h2, h3, h4, h5, h6, li, dd, blockquote, figcaption, td, th, .badge, .label) {
      overflow-wrap: anywhere;
    }
    :where(img, svg, video, canvas, iframe) {
      max-width: 100%;
      height: auto;
    }
    .shot-card.hidden-by-filter {
      display: none !important;
    }
    .aspect-16-9 {
      aspect-ratio: 16 / 9;
    }
    .aspect-9-16 {
      aspect-ratio: 9 / 16;
    }
  </style>
</head>
<body class="bg-base-300 text-base-content min-h-screen pb-20">

  <!-- Top Navbar -->
  <header class="navbar bg-base-100 border-b border-base-content/10 sticky top-0 z-40 px-4 lg:px-8 shadow-sm backdrop-blur">
    <div class="navbar-start gap-3">
      <div class="avatar placeholder">
        <div class="bg-primary text-primary-content rounded-lg w-10 h-10 shadow flex items-center justify-center font-black">
          🎬
        </div>
      </div>
      <div>
        <div class="text-xs uppercase tracking-wider text-base-content/60 font-mono">VideoGen Director's Board</div>
        <h1 class="text-lg font-bold leading-tight truncate max-w-xs md:max-w-md">${escapeHtml(title)}</h1>
      </div>
    </div>

    <div class="navbar-end gap-2">
      <!-- Theme Controller -->
      <label class="btn btn-ghost btn-sm btn-circle swap swap-rotate" title="Toggle Theme">
        <input type="checkbox" class="theme-controller" value="light" id="theme_toggle">
        <span class="swap-off text-base">🌙</span>
        <span class="swap-on text-base">☀️</span>
      </label>

      <!-- Action Buttons -->
      <div class="dropdown dropdown-end">
        <div tabindex="0" role="button" class="btn btn-primary btn-sm gap-1">
          <span>⚡ CLI Commands</span>
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" /></svg>
        </div>
        <ul tabindex="0" class="dropdown-content menu bg-base-100 rounded-box z-50 w-72 p-2 shadow-xl border border-base-content/10 mt-1">
          <li class="menu-title text-xs font-mono">Run in Terminal:</li>
          <li><button onclick="copyCommand('./videogen render ${escapeHtml(sbPath || baseName + '.json')}')" class="text-xs font-mono">📽️ ./videogen render</button></li>
          <li><button onclick="copyCommand('./videogen voice ${escapeHtml(sbPath || baseName + '.json')}')" class="text-xs font-mono">🎙️ ./videogen voice</button></li>
          <li><button onclick="copyCommand('./videogen assemble ${escapeHtml(sbPath || baseName + '.json')}')" class="text-xs font-mono">🎞️ ./videogen assemble</button></li>
          <li><button onclick="copyCommand('lavish-axi ${escapeHtml(path.relative(config.PROJECT_DIR, outPath))}')" class="text-xs font-mono">🎨 lavish-axi review</button></li>
        </ul>
      </div>
    </div>
  </header>

  <main class="max-w-7xl mx-auto px-4 lg:px-8 pt-6">

    <!-- Project Hero / Stats Banner -->
    <section class="card bg-base-100 card-border shadow-md mb-6 overflow-hidden">
      <div class="card-body p-5 lg:p-6 gap-4">
        <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-base-content/10 pb-4">
          <div>
            <div class="flex items-center gap-2 flex-wrap mb-1">
              <span class="badge badge-primary font-semibold">${escapeHtml(format)}</span>
              <span class="badge badge-neutral font-mono">${escapeHtml(aspectRatio)}</span>
              <span class="badge badge-neutral font-mono">${escapeHtml(resolution)}</span>
              ${bgmVolume === 0 ? '<span class="badge badge-outline">Strictly No BGM</span>' : '<span class="badge badge-outline">BGM: ' + bgmVolume + '</span>'}
            </div>
            <h2 class="text-2xl lg:text-3xl font-extrabold tracking-tight">${escapeHtml(title)}</h2>
            <p class="text-xs text-base-content/60 font-mono mt-0.5">Project ID: ${escapeHtml(projectName)} • Source: ${escapeHtml(baseName)}.json</p>
          </div>

          <div class="flex items-center gap-3">
            <div class="radial-progress text-primary font-bold text-sm" style="--value:${progressPercent}; --size:4.2rem; --thickness: 4px;" role="progressbar">
              ${progressPercent}%
            </div>
            <div>
              <div class="text-xs text-base-content/60 uppercase font-bold tracking-wider">Render Readiness</div>
              <div class="text-sm font-semibold">${renderedCount} of ${totalShots} cuts ready</div>
              <div class="text-xs text-base-content/50">${pendingCount === 0 ? '✓ Complete episode footage' : pendingCount + ' pending render'}</div>
            </div>
          </div>
        </div>

        <!-- Metrics Grid -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 pt-1">
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Total Micro-Shots</div>
            <div class="text-xl font-black text-primary">${totalShots}</div>
            <div class="text-xs text-base-content/40 font-mono">clauses</div>
          </div>
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Est. Duration</div>
            <div class="text-xl font-black">${totalDurationFormatted}</div>
            <div class="text-xs text-base-content/40 font-mono">${totalDurationSec}s total</div>
          </div>
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Voice Engine</div>
            <div class="text-base font-bold truncate">${escapeHtml(voiceProvider.toUpperCase())}</div>
            <div class="text-xs text-base-content/40 font-mono truncate">${escapeHtml(voiceProfile)}</div>
          </div>
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Narration Pace</div>
            <div class="text-base font-bold">${voiceSpeed}</div>
            <div class="text-xs text-base-content/40 font-mono">~2.2s per clause</div>
          </div>
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Visual Strategy</div>
            <div class="text-base font-bold truncate">1:1 Spoken Ink</div>
            <div class="text-xs text-base-content/40 font-mono">Nano Banana Pro</div>
          </div>
          <div class="bg-base-200/60 rounded-box p-3 border border-base-content/5">
            <div class="text-xs text-base-content/60 font-medium">Channel Route</div>
            <div class="text-base font-bold truncate">${escapeHtml(channel)}</div>
            <div class="text-xs text-base-content/40 font-mono">Auto Scheduled</div>
          </div>
        </div>

        <!-- Progress bar -->
        <div class="w-full">
          <progress class="progress progress-primary w-full" value="${renderedCount}" max="${totalShots}"></progress>
        </div>
      </div>
    </section>

    <!-- Filter & Search Controls -->
    <section class="card bg-base-100 card-border shadow-sm mb-6 p-4">
      <div class="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <!-- Search bar -->
        <div class="relative flex-1">
          <input
            type="text"
            id="search_input"
            placeholder="Search clauses, prompts, palettes, shot IDs..."
            class="input input-sm input-bordered w-full pl-9 pr-8"
            oninput="applyFilters()"
          >
          <span class="absolute left-3 top-2 text-base-content/40 text-xs">🔍</span>
          <button id="clear_search" onclick="clearSearch()" class="absolute right-2.5 top-1.5 text-xs text-base-content/40 hover:text-base-content hidden">✕</button>
        </div>

        <!-- Strategy & Status Tabs -->
        <div class="flex items-center gap-2 flex-wrap">
          <div class="join">
            <button class="btn btn-sm join-item filter-btn btn-active" data-filter="all" onclick="setFilter('all', this)">All (${totalShots})</button>
            <button class="btn btn-sm join-item filter-btn" data-filter="rendered" onclick="setFilter('rendered', this)">Rendered (${renderedCount})</button>
            <button class="btn btn-sm join-item filter-btn" data-filter="pending" onclick="setFilter('pending', this)">Pending (${pendingCount})</button>
          </div>

          ${uniqueStrategies.length > 0 ? `
          <select id="strategy_select" class="select select-sm select-bordered" onchange="applyFilters()">
            <option value="all">All Strategies</option>
            ${uniqueStrategies.map(st => `<option value="${escapeHtml(st)}">${escapeHtml(st)}</option>`).join('')}
          </select>` : ''}

          <div class="join">
            <button id="view_grid_btn" class="btn btn-sm join-item btn-active" title="Card Grid View" onclick="setViewMode('grid')">▦ Cards</button>
            <button id="view_table_btn" class="btn btn-sm join-item" title="Table View" onclick="setViewMode('table')">☰ Table</button>
          </div>
        </div>
      </div>
    </section>

    <!-- Shot Count Result Notice -->
    <div class="flex items-center justify-between px-1 mb-4 text-xs font-mono text-base-content/60">
      <span id="filtered_count_label">Showing all ${totalShots} shots</span>
      <span>Click any card image to view in full-screen Lightbox</span>
    </div>

    <!-- View Mode: Card Grid -->
    <div id="grid_view_container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      ${shots.map(s => {
        const isRendered = !!s.render;
        const mediaSrc = isRendered ? s.render.relPath : '';
        const isVideo = isRendered && s.render.type === 'video';

        return `
        <article
          class="card card-border bg-base-100 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden shot-card"
          data-shot-id="${escapeHtml(s.shotId)}"
          data-strategy="${escapeHtml(s.strategy)}"
          data-rendered="${isRendered ? 'true' : 'false'}"
          data-text="${escapeHtml(s.narration.toLowerCase() + ' ' + s.prompt.toLowerCase() + ' ' + s.shotId.toLowerCase() + ' ' + s.palette.toLowerCase())}"
        >
          <!-- Media Preview Box -->
          <div class="relative bg-base-200 ${aspectRatio === '9:16' ? 'aspect-9-16' : 'aspect-16-9'} overflow-hidden group">
            ${isRendered ? (isVideo ? `
              <video src="${escapeHtml(mediaSrc)}" controls preload="metadata" class="w-full h-full object-cover"></video>
            ` : `
              <img
                src="${escapeHtml(mediaSrc)}"
                alt="${escapeHtml(s.shotId)}"
                loading="lazy"
                class="w-full h-full object-cover cursor-pointer transition-transform duration-300 group-hover:scale-105"
                onclick="openLightbox('${escapeHtml(mediaSrc)}', '${escapeHtml(s.shotId)}', '${escapeHtml(s.narration)}', '${escapeHtml(s.prompt)}', '${escapeHtml(s.strategy)}', '${escapeHtml(s.timeRange)}')"
              >
              <div class="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <span class="badge badge-neutral badge-xs font-mono">🔍 Zoom</span>
              </div>
            `) : `
              <div class="w-full h-full flex flex-col items-center justify-center p-4 text-center border-2 border-dashed border-base-content/20 rounded">
                <span class="text-3xl mb-1 opacity-40">🎨</span>
                <span class="text-xs font-semibold text-base-content/50 uppercase tracking-wider">Pending Render</span>
                <span class="text-[10px] text-base-content/40 font-mono mt-0.5">${escapeHtml(s.strategy)}</span>
              </div>
            `}

            <!-- Shot index overlay badge -->
            <div class="absolute top-2 left-2 flex items-center gap-1">
              <span class="badge badge-neutral font-mono font-bold text-xs shadow-md">#${s.shotNum}</span>
              <span class="badge badge-ghost font-mono text-[10px] bg-black/60 text-white backdrop-blur">${escapeHtml(s.timeRange)}</span>
            </div>

            <!-- Status Indicator -->
            <div class="absolute top-2 right-2">
              ${isRendered ? `
                <span class="badge badge-success badge-xs font-semibold shadow">Ready</span>
              ` : `
                <span class="badge badge-warning badge-xs font-semibold shadow">Queued</span>
              `}
            </div>
          </div>

          <!-- Card Body -->
          <div class="card-body p-3.5 gap-2.5">
            <!-- Badges Bar -->
            <div class="flex items-center gap-1.5 flex-wrap">
              <span class="badge ${getStrategyBadgeClass(s.strategy)} badge-xs font-bold uppercase tracking-wider">${escapeHtml(s.strategy)}</span>
              ${s.palette ? `<span class="badge badge-outline badge-xs font-mono">${escapeHtml(s.palette)}</span>` : ''}
              ${s.characters.map(c => `<span class="badge badge-neutral badge-xs font-mono">@${escapeHtml(c)}</span>`).join('')}
              <span class="badge badge-ghost badge-xs font-mono text-base-content/50 ml-auto">${s.duration}s</span>
            </div>

            <!-- Narration / Spoken Clause -->
            <div class="bg-base-200/70 rounded-lg p-2.5 border border-base-content/5">
              <div class="flex items-center justify-between text-[10px] text-base-content/50 font-mono mb-1">
                <span>🎙️ Spoken Clause</span>
                <span>${s.wordCount} words • ${s.wps} wps</span>
              </div>
              <blockquote class="text-xs font-medium text-base-content leading-relaxed">
                "${escapeHtml(s.narration || '[No Spoken Text — SFX / Ambience Only]')}"
              </blockquote>
            </div>

            <!-- Visual Prompt -->
            <div class="text-[11px] text-base-content/70">
              <div class="flex items-center justify-between text-[10px] text-base-content/50 font-mono mb-0.5">
                <span>✏️ Prompt Blueprint</span>
                <button
                  type="button"
                  class="hover:text-primary transition-colors text-[10px]"
                  onclick="copyText('${escapeHtml(s.prompt)}', this)"
                  title="Copy Prompt"
                >
                  📋 Copy
                </button>
              </div>
              <p class="font-mono text-[10px] line-clamp-3 hover:line-clamp-none transition-all leading-normal bg-base-300/40 p-1.5 rounded border border-base-content/5">
                ${escapeHtml(s.prompt || '[No Prompt Specified]')}
              </p>
            </div>
          </div>
        </article>
        `;
      }).join('\n')}
    </div>

    <!-- View Mode: Compact Table (Initially Hidden) -->
    <div id="table_view_container" class="hidden overflow-x-auto rounded-box border border-base-content/10 bg-base-100 shadow-md">
      <table class="table table-zebra table-sm">
        <thead>
          <tr class="bg-base-200 text-xs font-mono">
            <th>#</th>
            <th>Shot ID</th>
            <th>Time</th>
            <th>Dur</th>
            <th>Preview</th>
            <th>Strategy</th>
            <th>Narration Clause</th>
            <th>Prompt</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${shots.map(s => {
            const isRendered = !!s.render;
            const mediaSrc = isRendered ? s.render.relPath : '';
            return `
            <tr class="shot-card"
                data-shot-id="${escapeHtml(s.shotId)}"
                data-strategy="${escapeHtml(s.strategy)}"
                data-rendered="${isRendered ? 'true' : 'false'}"
                data-text="${escapeHtml(s.narration.toLowerCase() + ' ' + s.prompt.toLowerCase() + ' ' + s.shotId.toLowerCase() + ' ' + s.palette.toLowerCase())}"
            >
              <td class="font-mono font-bold">${s.shotNum}</td>
              <td class="font-mono text-xs">${escapeHtml(s.shotId)}</td>
              <td class="font-mono text-xs">${escapeHtml(s.timeRange)}</td>
              <td class="font-mono text-xs">${s.duration}s</td>
              <td>
                ${isRendered ? `
                  <img src="${escapeHtml(mediaSrc)}" class="w-16 h-9 object-cover rounded cursor-pointer" onclick="openLightbox('${escapeHtml(mediaSrc)}', '${escapeHtml(s.shotId)}', '${escapeHtml(s.narration)}', '${escapeHtml(s.prompt)}', '${escapeHtml(s.strategy)}', '${escapeHtml(s.timeRange)}')">
                ` : `
                  <div class="w-16 h-9 bg-base-300 rounded flex items-center justify-center text-[10px] text-base-content/40 font-mono">Pending</div>
                `}
              </td>
              <td><span class="badge ${getStrategyBadgeClass(s.strategy)} badge-xs font-bold">${escapeHtml(s.strategy)}</span></td>
              <td class="max-w-xs text-xs truncate" title="${escapeHtml(s.narration)}">${escapeHtml(s.narration)}</td>
              <td class="max-w-xs text-[10px] font-mono truncate" title="${escapeHtml(s.prompt)}">${escapeHtml(s.prompt)}</td>
              <td>
                ${isRendered ? '<span class="badge badge-success badge-xs">Ready</span>' : '<span class="badge badge-warning badge-xs">Queued</span>'}
              </td>
            </tr>
            `;
          }).join('\n')}
        </tbody>
      </table>
    </div>

    <!-- Empty Filter Fallback -->
    <div id="no_results_box" class="card bg-base-100 card-border p-12 text-center my-8 hidden">
      <div class="text-4xl mb-2">🔍</div>
      <h3 class="text-lg font-bold">No shots match your current filter</h3>
      <p class="text-xs text-base-content/60 mt-1">Try clearing your search query or selecting "All Shots".</p>
      <div class="mt-4">
        <button class="btn btn-sm btn-outline" onclick="resetAllFilters()">Reset Filters</button>
      </div>
    </div>
  </main>

  <!-- Lightbox Modal -->
  <dialog id="lightbox_modal" class="modal">
    <div class="modal-box max-w-4xl p-0 overflow-hidden bg-base-100">
      <div class="relative bg-black flex items-center justify-center max-h-[70vh]">
        <img id="lightbox_img" src="" alt="Preview" class="max-h-[70vh] w-auto object-contain">
        <button class="btn btn-sm btn-circle btn-ghost absolute right-3 top-3 text-white bg-black/50 hover:bg-black/80" onclick="closeLightbox()">✕</button>
      </div>
      <div class="p-5">
        <div class="flex items-center justify-between mb-2">
          <div class="flex items-center gap-2">
            <span id="lightbox_shot_id" class="badge badge-primary font-mono font-bold"></span>
            <span id="lightbox_strategy" class="badge badge-outline text-xs"></span>
            <span id="lightbox_timerange" class="text-xs font-mono text-base-content/60"></span>
          </div>
          <button class="btn btn-xs btn-outline" onclick="copyLightboxPrompt()">Copy Prompt</button>
        </div>
        <div class="bg-base-200 rounded-box p-3 mb-3">
          <div class="text-[10px] uppercase font-bold text-base-content/50 font-mono mb-1">Narration Clause</div>
          <p id="lightbox_narration" class="text-sm font-medium text-base-content"></p>
        </div>
        <div class="bg-base-200/50 rounded-box p-3">
          <div class="text-[10px] uppercase font-bold text-base-content/50 font-mono mb-1">Visual Prompt</div>
          <p id="lightbox_prompt" class="font-mono text-xs text-base-content/80 whitespace-pre-wrap"></p>
        </div>
      </div>
      <div class="modal-action px-5 pb-4 pt-0">
        <form method="dialog">
          <button class="btn btn-sm">Close</button>
        </form>
      </div>
    </div>
    <form method="dialog" class="modal-backdrop">
      <button>close</button>
    </form>
  </dialog>

  <!-- Toast Notification -->
  <div id="toast" class="toast toast-end hidden z-50">
    <div class="alert alert-success py-2 px-4 text-xs font-mono">
      <span id="toast_msg">Copied to clipboard!</span>
    </div>
  </div>

  <!-- Interactive Filtering & Client Script -->
  <script>
    let currentFilter = 'all';
    let currentView = 'grid';

    function setViewMode(mode) {
      currentView = mode;
      const gridBox = document.getElementById('grid_view_container');
      const tableBox = document.getElementById('table_view_container');
      const gridBtn = document.getElementById('view_grid_btn');
      const tableBtn = document.getElementById('view_table_btn');

      if (mode === 'grid') {
        gridBox.classList.remove('hidden');
        tableBox.classList.add('hidden');
        gridBtn.classList.add('btn-active');
        tableBtn.classList.remove('btn-active');
      } else {
        gridBox.classList.add('hidden');
        tableBox.classList.remove('hidden');
        gridBtn.classList.remove('btn-active');
        tableBtn.classList.add('btn-active');
      }
    }

    function setFilter(filter, el) {
      currentFilter = filter;
      document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('btn-active'));
      if (el) el.classList.add('btn-active');
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
      setFilter('all', document.querySelector('.filter-btn[data-filter="all"]'));
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

      const cards = document.querySelectorAll('.shot-card');
      let visibleCount = 0;

      cards.forEach(card => {
        const isRendered = card.getAttribute('data-rendered') === 'true';
        const cardStrategy = card.getAttribute('data-strategy') || '';
        const cardText = card.getAttribute('data-text') || '';

        // Status filter
        let statusMatch = true;
        if (currentFilter === 'rendered') statusMatch = isRendered;
        if (currentFilter === 'pending') statusMatch = !isRendered;

        // Strategy filter
        let strategyMatch = true;
        if (selectedStrategy !== 'all') {
          strategyMatch = (cardStrategy === selectedStrategy);
        }

        // Query match
        let queryMatch = true;
        if (query.length > 0) {
          queryMatch = cardText.includes(query);
        }

        if (statusMatch && strategyMatch && queryMatch) {
          card.classList.remove('hidden-by-filter');
          visibleCount++;
        } else {
          card.classList.add('hidden-by-filter');
        }
      });

      // Update visible count label
      const countLabel = document.getElementById('filtered_count_label');
      if (countLabel) {
        countLabel.innerText = 'Showing ' + visibleCount + ' of ${totalShots} shots';
      }

      // No results notice
      const noResults = document.getElementById('no_results_box');
      if (noResults) {
        if (visibleCount === 0) {
          noResults.classList.remove('hidden');
        } else {
          noResults.classList.add('hidden');
        }
      }
    }

    function openLightbox(src, shotId, narration, prompt, strategy, timeRange) {
      document.getElementById('lightbox_img').src = src;
      document.getElementById('lightbox_shot_id').innerText = '#' + shotId;
      document.getElementById('lightbox_strategy').innerText = strategy;
      document.getElementById('lightbox_timerange').innerText = timeRange;
      document.getElementById('lightbox_narration').innerText = narration || '[No spoken text]';
      document.getElementById('lightbox_prompt').innerText = prompt || '[No prompt]';
      document.getElementById('lightbox_modal').showModal();
    }

    function closeLightbox() {
      document.getElementById('lightbox_modal').close();
    }

    function copyLightboxPrompt() {
      const text = document.getElementById('lightbox_prompt').innerText;
      copyText(text);
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard!');
        if (btn) {
          const original = btn.innerText;
          btn.innerText = '✓ Copied';
          setTimeout(() => btn.innerText = original, 1200);
        }
      }).catch(() => {
        showToast('Failed to copy');
      });
    }

    function copyCommand(cmd) {
      copyText(cmd);
    }

    function showToast(msg) {
      const toast = document.getElementById('toast');
      const toastMsg = document.getElementById('toast_msg');
      if (toast && toastMsg) {
        toastMsg.innerText = msg;
        toast.classList.remove('hidden');
        setTimeout(() => toast.classList.add('hidden'), 2000);
      }
    }
  </script>
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
  const fileUrl = `file://${path.resolve(canonicalPath)}`;

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
    console.log(`  👉 Mở trực tiếp trên trình duyệt (Standalone HTML Fallback):`);
    console.log(`     ${fileUrl}`);
    console.log(`  💡 Khuyến nghị cài đặt Lavish Visual Studio: npm install -g lavish-axi`);
  }
  console.log(`============================================================\n`);

  // If --open flag is set, launch lavish-axi or fallback to system browser
  if (options.open) {
    if (hasLavish) {
      try {
        console.log(`[-] Đang khởi chạy Lavish Editor cho ${relCanonical}...`);
        const child = spawn('lavish-axi', [relCanonical], {
          cwd: config.PROJECT_DIR,
          stdio: 'inherit',
          detached: true
        });
        child.on('error', (err) => {
          console.warn(`[!] Không thể khởi chạy lavish-axi (${err.message}). Mở bằng trình duyệt hệ thống...`);
          openInSystemBrowser(canonicalPath);
        });
        child.unref();
      } catch (err) {
        console.warn(`[!] Không thể khởi chạy lavish-axi: ${err.message}. Mở bằng trình duyệt hệ thống...`);
        openInSystemBrowser(canonicalPath);
      }
    } else {
      console.log(`[-] Không tìm thấy lavish-axi. Mở bằng trình duyệt hệ thống (Standalone HTML Fallback)...`);
      const opened = openInSystemBrowser(canonicalPath);
      if (opened) {
        console.log(`  [✓] Đã mở ${fileUrl} trên trình duyệt hệ thống.`);
      } else {
        console.log(`  👉 Vui lòng mở đường dẫn sau trong trình duyệt:\n     ${fileUrl}`);
      }
      console.log(`  💡 Khuyến nghị cài đặt Lavish Visual Studio: npm install -g lavish-axi\n`);
    }
  }

  return outPath;
}

module.exports = {
  generateBoard,
  formatTime,
  getStrategyBadgeClass,
  findRenderFile,
  isLavishInstalled,
  openInSystemBrowser
};
