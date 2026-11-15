// balance_scale: a beam on a fulcrum weighing two user-provided sides.
// Scene fields: left: { label, value, color }, right: { label, value, color },
//               tilt: -1..1 (negative lowers the left pan, positive lowers the right pan)
const { safeColor, num, clamp, hasText, layer, paletteColor, TEXT_COLOR } = require('./util');

function side(obj, cx, cy, color, esc) {
  const label = hasText(obj.label)
    ? `<text x="${cx}" y="${cy - 56}" text-anchor="middle" fill="${color}" font-family="Be Vietnam Pro" font-size="30" font-weight="800">${esc(obj.label)}</text>`
    : '';
  const value = hasText(obj.value)
    ? `<text x="${cx}" y="${cy + 50}" text-anchor="middle" fill="${TEXT_COLOR}" font-family="JetBrains Mono" font-size="26" font-weight="700">${esc(obj.value)}</text>`
    : '';
  return `<g class="anim-item">
      <line x1="${cx}" y1="${cy - 40}" x2="${cx}" y2="${cy}" stroke="${color}" stroke-width="3"/>
      <path d="M ${cx - 70} ${cy} Q ${cx} ${cy + 34} ${cx + 70} ${cy} Z" fill="rgba(12,13,15,0.25)" stroke="${color}" stroke-width="5" stroke-linejoin="round"/>
      ${label}${value}
    </g>`;
}

function renderBalanceScale(sc, id, esc) {
  const left = sc.left && typeof sc.left === 'object' ? sc.left : null;
  const right = sc.right && typeof sc.right === 'object' ? sc.right : null;
  if (!left || !right) return '';
  const tilt = clamp(num(sc.tilt, 0), -1, 1);
  const cx = 468, pivotY = 80, half = 300;
  const dy = Math.round(Math.sin((tilt * 8 * Math.PI) / 180) * half);
  const lx = cx - half, ly = pivotY - dy;
  const rx = cx + half, ry = pivotY + dy;
  const lColor = safeColor(left.color, paletteColor(0));
  const rColor = safeColor(right.color, paletteColor(1));
  return layer(id, sc, `
    <svg width="936" height="260" viewBox="0 0 936 260">
      <polygon points="${cx},${pivotY} ${cx - 40},250 ${cx + 40},250" fill="rgba(243,239,230,0.18)" stroke="${TEXT_COLOR}" stroke-width="4" stroke-linejoin="round"/>
      <line x1="${lx}" y1="${ly}" x2="${rx}" y2="${ry}" stroke="${TEXT_COLOR}" stroke-width="7" stroke-linecap="round" class="anim-item"/>
      <circle cx="${cx}" cy="${pivotY}" r="9" fill="${TEXT_COLOR}"/>
      ${side(left, lx, ly + 40, lColor, esc)}
      ${side(right, rx, ry + 40, rColor, esc)}
    </svg>`, esc);
}

module.exports = { renderBalanceScale };
