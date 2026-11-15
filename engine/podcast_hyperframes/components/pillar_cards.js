// pillar_cards: a row of numbered badges with short labels.
// Scene fields: items: [{ code, label, color }]
const { safeColor, hasText, list, layer, paletteColor } = require('./util');

function renderPillarCards(sc, id, esc) {
  const items = list(sc.items).filter(it => typeof it === 'object');
  if (items.length === 0) return '';
  const cards = items.map((it, i) => {
    const color = safeColor(it.color, paletteColor(i));
    const code = hasText(it.code) ? it.code : String(i + 1).padStart(2, '0');
    return `<div class="pl-item anim-item">
      <svg width="104" height="104" viewBox="0 0 104 104">
        <circle cx="52" cy="52" r="46" fill="rgba(12,13,15,0.25)" stroke="${color}" stroke-width="5"/>
        <text x="52" y="64" text-anchor="middle" fill="${color}" font-family="JetBrains Mono" font-size="34" font-weight="800">${esc(code)}</text>
      </svg>
      <span class="pl-name" style="color:${color}">${esc(it.label)}</span>
    </div>`;
  }).join('');
  return layer(id, sc, `<div class="pl-row">${cards}</div>`, esc);
}

module.exports = { renderPillarCards };
