// Generic, domain-agnostic HyperFrames overlay components.
// Every scene is declared by the user in `spec.scenes`; nothing is inferred from titles or project ids,
// and no fallback scenes are generated when the list is empty.
const { escapeHtml, num } = require('./util');
const { renderComparisonBars } = require('./comparison_bars');
const { renderMetricCounter } = require('./metric_counter');
const { renderTrendLine } = require('./trend_line');
const { renderPillarCards } = require('./pillar_cards');
const { renderBalanceScale } = require('./balance_scale');
const { renderFunnel } = require('./funnel');
const { renderGauge } = require('./gauge');
const { renderSpectrumSlider } = require('./spectrum_slider');
const { renderTextCallout } = require('./text_callout');
const { renderStepFlow } = require('./step_flow');

const COMPONENTS = {
  comparison_bars: renderComparisonBars,
  metric_counter: renderMetricCounter,
  trend_line: renderTrendLine,
  pillar_cards: renderPillarCards,
  balance_scale: renderBalanceScale,
  funnel: renderFunnel,
  gauge: renderGauge,
  spectrum_slider: renderSpectrumSlider,
  text_callout: renderTextCallout,
  step_flow: renderStepFlow
};

const COMPONENT_TYPES = Object.keys(COMPONENTS);

/**
 * Normalize `spec.scenes` into a validated list.
 * - Missing / empty `spec.scenes` -> [] (no default scenes).
 * - Entries with an unknown `type` are dropped with a warning.
 * - `start` / `end` are coerced to numbers (end defaults to start + 6s, minimum 0.8s window).
 */
function normalizeScenes(spec = {}, { warn = console.warn } = {}) {
  const raw = spec && Array.isArray(spec.scenes) ? spec.scenes : [];
  const out = [];
  raw.forEach((sc, i) => {
    if (!sc || typeof sc !== 'object') return;
    if (!Object.prototype.hasOwnProperty.call(COMPONENTS, sc.type)) {
      if (warn) warn(`[!] Bỏ qua scene #${i}: type không hợp lệ "${sc.type}". Hỗ trợ: ${COMPONENT_TYPES.join(', ')}`);
      return;
    }
    const start = Math.max(0, num(sc.start, 0));
    const end = Math.max(start + 0.8, num(sc.end, start + 6));
    out.push({ ...sc, start, end });
  });
  return out;
}

function renderScene(sc, idx, esc = escapeHtml, spec = {}) {
  const render = COMPONENTS[sc && sc.type];
  if (!render) return '';
  return render(sc, `scene-${idx}`, esc, spec) || '';
}

function buildScenesHtml(spec = {}, esc = escapeHtml) {
  return normalizeScenes(spec).map((sc, idx) => renderScene(sc, idx, esc, spec)).join('\n');
}

module.exports = { COMPONENT_TYPES, normalizeScenes, renderScene, buildScenesHtml };
