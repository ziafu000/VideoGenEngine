// comparison_bars: horizontal rows or vertical columns comparing user-provided values.
// Scene fields: orientation ('horizontal' | 'vertical'), items: [{ label, value, pct (0-100), color }]
const { safeColor, paletteColor, pct, list, layer, TEXT_COLOR } = require('./util');

function renderComparisonBars(sc, id, esc) {
  const items = list(sc.items).filter(it => typeof it === 'object');
  if (items.length === 0) return '';

  if (sc.orientation === 'vertical') {
    const cols = items.map((it, i) => {
      const color = safeColor(it.color, paletteColor(i));
      const h = Math.max(4, Math.round(170 * pct(it.pct, 100) / 100));
      return `
      <div class="bar-col anim-item">
        <div class="bar-val num-mono" style="color:${color}">${esc(it.value)}</div>
        <div class="bar-wrap"><div class="bar anim-bar-y" style="height:${h}px;background:${color}"></div></div>
        <div class="bar-name" style="color:${safeColor(it.label_color, TEXT_COLOR)}">${esc(it.label)}</div>
      </div>`;
    }).join('');
    return layer(id, sc, `<div class="bar-stage">${cols}</div>`, esc);
  }

  const rows = items.map((it, i) => {
    const color = safeColor(it.color, paletteColor(i));
    return `
    <div class="sp-row anim-item">
      <div class="sp-meta"><span>${esc(it.label)}</span><span class="num-mono" style="color:${color}">${esc(it.value)}</span></div>
      <div class="sp-track"><div class="sp-fill anim-bar-x" style="width:${pct(it.pct, 100)}%;background:${color}"></div></div>
    </div>`;
  }).join('');
  return layer(id, sc, rows, esc);
}

module.exports = { renderComparisonBars };
