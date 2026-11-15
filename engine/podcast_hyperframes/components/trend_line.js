// trend_line: an animated polyline drawn through user-provided points (auto-scaled to min/max).
// Scene fields: points: [number], color, start_label, end_label, x_labels: [string]
const { safeColor, num, hasText, list, layer, paletteColor, TEXT_COLOR, MUTED_COLOR } = require('./util');

function renderTrendLine(sc, id, esc) {
  const pts = list(sc.points).map(v => Number(v)).filter(Number.isFinite);
  if (pts.length < 2) return '';
  const color = safeColor(sc.color, paletteColor(1));
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const x0 = 40, x1 = 896, yTop = 50, yBottom = 200;
  const coords = pts.map((v, i) => ({
    x: Math.round(x0 + ((x1 - x0) * i) / (pts.length - 1)),
    y: Math.round(yBottom - (yBottom - yTop) * ((v - min) / span))
  }));
  const d = coords.map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x} ${c.y}`).join(' ');
  const a = coords[0];
  const b = coords[coords.length - 1];

  const startLabel = hasText(sc.start_label)
    ? `<text x="${a.x}" y="${Math.min(244, a.y + 40)}" fill="${TEXT_COLOR}" font-family="JetBrains Mono" font-size="26" font-weight="700">${esc(sc.start_label)}</text>`
    : '';
  const endLabel = hasText(sc.end_label)
    ? `<text x="${b.x}" y="${Math.max(30, b.y - 22)}" text-anchor="end" fill="${color}" font-family="JetBrains Mono" font-size="32" font-weight="800">${esc(sc.end_label)}</text>`
    : '';
  const xLabels = list(sc.x_labels).slice(0, coords.length).map((lbl, i) =>
    `<text x="${coords[i].x}" y="246" text-anchor="middle" fill="${MUTED_COLOR}" font-family="JetBrains Mono" font-size="20" font-weight="700">${esc(lbl)}</text>`
  ).join('');

  return layer(id, sc, `
    <svg width="936" height="250" viewBox="0 0 936 250">
      <path d="${d}" fill="none" stroke="${color}" stroke-width="${num(sc.stroke_width, 6)}" stroke-linecap="round" stroke-linejoin="round" pathLength="1100" stroke-dasharray="1100" stroke-dashoffset="0" class="anim-draw"/>
      <g class="anim-item"><circle cx="${a.x}" cy="${a.y}" r="8" fill="${TEXT_COLOR}"/>${startLabel}</g>
      <g class="anim-item"><circle cx="${b.x}" cy="${b.y}" r="10" fill="${color}"/>${endLabel}</g>
      ${xLabels ? `<g class="anim-item">${xLabels}</g>` : ''}
    </svg>`, esc);
}

module.exports = { renderTrendLine };
