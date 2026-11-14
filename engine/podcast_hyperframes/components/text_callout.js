// text_callout: one or more short lines, each optionally emphasized or struck through.
// Scene fields: lines: [string | { text, style: 'normal' | 'emphasis' | 'strike', color }]
const { safeColor, hasText, list, layer, TEXT_COLOR } = require('./util');

function renderTextCallout(sc, id, esc) {
  const lines = list(sc.lines)
    .map(l => (typeof l === 'object' ? l : { text: l }))
    .filter(l => hasText(l.text));
  if (lines.length === 0) return '';
  const html = lines.map(l => {
    const style = ['emphasis', 'strike'].includes(l.style) ? l.style : 'normal';
    const color = safeColor(l.color, TEXT_COLOR);
    return `<div class="tc-line tc-${style} anim-item" style="color:${color}">${esc(l.text)}</div>`;
  }).join('');
  return layer(id, sc, `<div class="tc-stack">${html}</div>`, esc);
}

module.exports = { renderTextCallout };
