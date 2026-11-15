// step_flow: two or more cards connected by arrows (e.g. before -> after, cause -> effect).
// Scene fields: items: [{ title, subtitle, color }]
const { safeColor, hasText, list, layer, paletteColor } = require('./util');

function renderStepFlow(sc, id, esc) {
  const items = list(sc.items).filter(it => typeof it === 'object' && (hasText(it.title) || hasText(it.subtitle)));
  if (items.length === 0) return '';
  const parts = [];
  items.forEach((it, i) => {
    const color = safeColor(it.color, paletteColor(i));
    if (i > 0) parts.push('<div class="sf-arrow anim-item">&#10140;</div>');
    parts.push(`<div class="sf-card anim-item" style="border-color:${color}">
      ${hasText(it.title) ? `<div class="sf-title" style="color:${color}">${esc(it.title)}</div>` : ''}
      ${hasText(it.subtitle) ? `<div class="sf-sub num-mono">${esc(it.subtitle)}</div>` : ''}
    </div>`);
  });
  return layer(id, sc, `<div class="sf-row">${parts.join('')}</div>`, esc);
}

module.exports = { renderStepFlow };
