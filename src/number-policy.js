// Display precision never changes stored forecasts, metrics, or admission gates.
export function formatPrice(value, symbol = '') {
  if (!Number.isFinite(value)) return '--';
  const digits = symbol === 'XAUUSD' ? 2 : 5;
  const rounded = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value;
  return rounded.toLocaleString('en-US', {minimumFractionDigits: digits, maximumFractionDigits: digits});
}
