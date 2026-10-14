'use strict';
function normalizeCoverCrop(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.enabled !== true) return null;
  const { x, y, zoom } = value;
  if (![x, y, zoom].every((number) => typeof number === 'number' && Number.isFinite(number))) return null;
  if (x < 0 || x > 100 || y < 0 || y > 100 || zoom < 1 || zoom > 2.5) return null;
  return { enabled: true, x, y, zoom };
}
module.exports = { normalizeCoverCrop };
