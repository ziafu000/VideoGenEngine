// metric_counter: a single animated number counting from `from` to `to`.
// Scene fields: from, to, prefix, suffix, decimals, locale, label, caption, color, count_duration
const { safeColor, num, clamp, hasText, layer, paletteColor, TEXT_COLOR } = require('./util');

function formatNumber(value, decimals, locale) {
  try {
    return Number(value).toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  } catch {
    return Number(value).toFixed(decimals);
  }
}

function renderMetricCounter(sc, id, esc, spec = {}) {
  if (sc.to === undefined || sc.to === null || !Number.isFinite(Number(sc.to))) return '';
  const to = num(sc.to);
  const from = num(sc.from, 0);
  const decimals = clamp(Math.round(num(sc.decimals, 0)), 0, 6);
  const locale = typeof sc.locale === 'string' && sc.locale ? sc.locale : (spec.locale || 'en-US');
  const color = safeColor(sc.color, paletteColor(1));
  const prefix = hasText(sc.prefix) ? String(sc.prefix) : '';
  const suffix = hasText(sc.suffix) ? String(sc.suffix) : '';
  const dur = num(sc.count_duration, 0);

  const label = hasText(sc.label)
    ? `<div class="mc-label anim-item" style="color:${safeColor(sc.label_color, TEXT_COLOR)}">${esc(sc.label)}</div>`
    : '';
  const caption = hasText(sc.caption) ? `<div class="mc-caption anim-item">${esc(sc.caption)}</div>` : '';
  const finalText = `${prefix}${formatNumber(to, decimals, locale)}${suffix}`;

  return layer(id, sc, `
    <div class="mc-wrap">
      ${label}
      <div class="mc-num num-mono anim-item anim-counter" style="color:${color}" data-from="${from}" data-to="${to}" data-decimals="${decimals}" data-locale="${esc(locale)}" data-prefix="${esc(prefix)}" data-suffix="${esc(suffix)}"${dur > 0 ? ` data-dur="${dur}"` : ''}>${esc(finalText)}</div>
      ${caption}
    </div>`, esc);
}

module.exports = { renderMetricCounter, formatNumber };
