// funnel: many inputs narrowing to a few outputs, with optional top/bottom callouts.
// Scene fields: top_label, bottom_label, color, input_count (default 12), output_count (default 2)
const { safeColor, num, clamp, hasText, layer, paletteColor, TEXT_COLOR } = require('./util');

function renderFunnel(sc, id, esc) {
  const color = safeColor(sc.color, paletteColor(1));
  const inputs = clamp(Math.round(num(sc.input_count, 12)), 0, 40);
  const outputs = clamp(Math.round(num(sc.output_count, 2)), 0, 6);
  const dots = [];
  for (let i = 0; i < inputs; i++) {
    const row = i % 3;
    const perRow = Math.ceil(inputs / 3) || 1;
    const col = Math.floor(i / 3);
    const width = 420 - row * 130;
    const x = Math.round(468 - width / 2 + (width * (col + 0.5)) / perRow);
    const y = 70 + row * 40;
    dots.push(`<circle cx="${x}" cy="${y}" r="5" fill="${TEXT_COLOR}" fill-opacity="0.6"/>`);
  }
  const outs = [];
  for (let i = 0; i < outputs; i++) {
    const x = Math.round(468 + (i - (outputs - 1) / 2) * 36);
    outs.push(`<circle cx="${x}" cy="184" r="7" fill="${color}"/>`);
  }
  const top = hasText(sc.top_label)
    ? `<text x="468" y="30" text-anchor="middle" fill="${TEXT_COLOR}" font-family="Be Vietnam Pro" font-size="28" font-weight="700" class="anim-item">${esc(sc.top_label)}</text>`
    : '';
  const bottom = hasText(sc.bottom_label)
    ? `<text x="468" y="248" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="40" font-weight="800" class="anim-item">${esc(sc.bottom_label)}</text>`
    : '';
  return layer(id, sc, `
    <svg width="936" height="270" viewBox="0 0 936 270">
      ${top}
      <g class="anim-item">
        <polygon points="188,46 748,46 528,196 408,196" fill="rgba(243,239,230,0.08)" stroke="${TEXT_COLOR}" stroke-opacity="0.65" stroke-width="3" stroke-linejoin="round"/>
        ${dots.join('')}
        ${outs.join('')}
      </g>
      ${bottom}
    </svg>`, esc);
}

module.exports = { renderFunnel };
