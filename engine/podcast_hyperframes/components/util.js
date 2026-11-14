// Shared helpers for generic HyperFrames overlay components.
// Components never invent content: every label, value, number and color comes from the scene spec.

const TEXT_COLOR = '#F3EFE6';
const MUTED_COLOR = 'rgba(243,239,230,0.55)';
const DEFAULT_PALETTE = ['#F5C518', '#10B981', '#3B82F6', '#EF4444', '#A855F7', '#F97316'];

const NAMED_COLOR_RE = /^[a-zA-Z]{3,20}$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FUNC_COLOR_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9.,%\s/]+\)$/;

function escapeHtml(str) {
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Accept only plain CSS color literals so user JSON can never inject markup or CSS through style attributes.
function safeColor(value, fallback = DEFAULT_PALETTE[0]) {
  const v = typeof value === 'string' ? value.trim() : '';
  if (v && (HEX_COLOR_RE.test(v) || FUNC_COLOR_RE.test(v) || NAMED_COLOR_RE.test(v))) return v;
  return fallback;
}

function paletteColor(i) {
  return DEFAULT_PALETTE[((i % DEFAULT_PALETTE.length) + DEFAULT_PALETTE.length) % DEFAULT_PALETTE.length];
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function pct(value, fallback = 0) {
  return clamp(num(value, fallback), 0, 100);
}

function hasText(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function list(value) {
  return Array.isArray(value) ? value.filter(v => v !== undefined && v !== null) : [];
}

// Optional heading shown above any component when the scene provides `title`.
function titleHtml(sc, esc) {
  if (!hasText(sc.title)) return '';
  const color = safeColor(sc.title_color, TEXT_COLOR);
  return `<div class="sc-title anim-item" style="color:${color}">${esc(sc.title)}</div>`;
}

function layer(id, sc, inner, esc) {
  const pos = ['top', 'center', 'bottom'].includes(sc.position) ? sc.position : 'top';
  return `<div id="${id}" class="scene-layer pos-${pos}" data-scene-type="${esc(sc.type)}" data-layout-ignore>${titleHtml(sc, esc)}${inner}</div>`;
}

module.exports = {
  TEXT_COLOR,
  MUTED_COLOR,
  DEFAULT_PALETTE,
  escapeHtml,
  safeColor,
  paletteColor,
  num,
  clamp,
  pct,
  hasText,
  list,
  layer
};
