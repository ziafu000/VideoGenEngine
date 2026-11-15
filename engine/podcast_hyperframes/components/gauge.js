// gauge: a semicircular dial filled to a 0-100 value.
// Scene fields: value (0-100), value_label, label, color, min_label, max_label
const { safeColor, num, pct, hasText, layer, paletteColor, TEXT_COLOR, MUTED_COLOR } = require('./util');

function arcPoint(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: +(cx + r * Math.cos(rad)).toFixed(1), y: +(cy - r * Math.sin(rad)).toFixed(1) };
}

function renderGauge(sc, id, esc) {
  if (sc.value === undefined || sc.value === null || !Number.isFinite(Number(sc.value))) return '';
  const value = pct(sc.value);
  const color = safeColor(sc.color, paletteColor(0));
  const cx = 468, cy = 220, r = 170;
  const start = arcPoint(cx, cy, r, 180);
  const endBg = arcPoint(cx, cy, r, 0);
  const endVal = arcPoint(cx, cy, r, 180 - value * 1.8);
  const valueLabel = hasText(sc.value_label) ? sc.value_label : `${num(sc.value)}%`;
  const fill = value > 0
    ? `<path d="M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${endVal.x} ${endVal.y}" fill="none" stroke="${color}" stroke-width="22" stroke-linecap="round" pathLength="1100" stroke-dasharray="1100" stroke-dashoffset="0" class="anim-draw"/>`
    : '';
  const minLbl = hasText(sc.min_label)
    ? `<text x="${start.x}" y="252" text-anchor="middle" fill="${MUTED_COLOR}" font-family="JetBrains Mono" font-size="22" font-weight="700">${esc(sc.min_label)}</text>`
    : '';
  const maxLbl = hasText(sc.max_label)
    ? `<text x="${endBg.x}" y="252" text-anchor="middle" fill="${MUTED_COLOR}" font-family="JetBrains Mono" font-size="22" font-weight="700">${esc(sc.max_label)}</text>`
    : '';
  const label = hasText(sc.label)
    ? `<text x="${cx}" y="${cy + 30}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Be Vietnam Pro" font-size="26" font-weight="700">${esc(sc.label)}</text>`
    : '';
  return layer(id, sc, `
    <svg width="936" height="262" viewBox="0 0 936 262">
      <path d="M ${start.x} ${start.y} A ${r} ${r} 0 0 1 ${endBg.x} ${endBg.y}" fill="none" stroke="rgba(243,239,230,0.2)" stroke-width="22" stroke-linecap="round"/>
      ${fill}
      <g class="anim-item">
        <text x="${cx}" y="${cy - 20}" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="56" font-weight="800">${esc(valueLabel)}</text>
        ${label}
      </g>
      <g class="anim-item">${minLbl}${maxLbl}</g>
    </svg>`, esc);
}

module.exports = { renderGauge };
