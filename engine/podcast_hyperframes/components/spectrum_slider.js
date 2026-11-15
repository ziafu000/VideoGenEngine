// spectrum_slider: a horizontal axis with labelled markers and an optional animated pointer.
// Scene fields: min_label, max_label, markers: [{ pct, label, color }],
//               pointer: { from_pct, to_pct, label, color }
const { safeColor, pct, hasText, list, layer, paletteColor, TEXT_COLOR, MUTED_COLOR } = require('./util');

function renderSpectrumSlider(sc, id, esc) {
  const markers = list(sc.markers).filter(m => typeof m === 'object');
  const pointer = sc.pointer && typeof sc.pointer === 'object' ? sc.pointer : null;
  if (markers.length === 0 && !pointer) return '';
  const X = p => Math.round(60 + pct(p) * 8.16);
  const f = 'font-family="JetBrains Mono" text-anchor="middle"';

  const ends = [
    hasText(sc.min_label) ? `<text x="${X(0)}" y="166" ${f} fill="${MUTED_COLOR}" font-size="24" font-weight="700">${esc(sc.min_label)}</text>` : '',
    hasText(sc.max_label) ? `<text x="${X(100)}" y="166" ${f} fill="${MUTED_COLOR}" font-size="24" font-weight="700">${esc(sc.max_label)}</text>` : ''
  ].join('');

  const markerHtml = markers.map((m, i) => {
    const color = safeColor(m.color, paletteColor(i));
    const lbl = hasText(m.label) ? `<text x="${X(m.pct)}" y="70" ${f} fill="${color}" font-size="28" font-weight="800">${esc(m.label)}</text>` : '';
    return `<g class="anim-item"><circle cx="${X(m.pct)}" cy="110" r="11" fill="${color}"/>${lbl}</g>`;
  }).join('');

  let pointerHtml = '';
  if (pointer) {
    const color = safeColor(pointer.color, TEXT_COLOR);
    const toX = X(pointer.to_pct !== undefined ? pointer.to_pct : pointer.from_pct);
    const fromX = X(pointer.from_pct !== undefined ? pointer.from_pct : pointer.to_pct);
    const lbl = hasText(pointer.label) ? `<text x="${toX}" y="214" ${f} fill="${color}" font-size="30" font-weight="800">${esc(pointer.label)}</text>` : '';
    pointerHtml = `<g class="anim-pointer" data-from-x="${fromX - toX}" data-to-x="0">
        <polygon points="${toX},126 ${toX - 14},158 ${toX + 14},158" fill="${color}"/>
      </g>
      <g class="anim-item">${lbl}</g>`;
  }

  return layer(id, sc, `
    <svg width="936" height="230" viewBox="0 0 936 230">
      <line x1="${X(0)}" y1="110" x2="${X(100)}" y2="110" stroke="${MUTED_COLOR}" stroke-width="6" stroke-linecap="round"/>
      <g class="anim-item">${ends}</g>
      ${markerHtml}
      ${pointerHtml}
    </svg>`, esc);
}

module.exports = { renderSpectrumSlider };
