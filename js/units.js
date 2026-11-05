// Settings and number formatting. All lengths are stored in metres internally.
const DEFAULTS = { units: 'metric', snap: true, ppmm: null };

export const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('tl.settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
})();

export function saveSettings() {
  try { localStorage.setItem('tl.settings', JSON.stringify(settings)); } catch { /* storage blocked */ }
}

const listeners = new Set();
export function onUnitsChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function setUnits(u) {
  settings.units = u; saveSettings();
  listeners.forEach(fn => fn(u));
}

export const M_PER_IN = 0.0254;
export const M_PER_FT = 0.3048;
export const SQFT_PER_M2 = 10.763910417;
export const CUFT_PER_M3 = 35.3146667;

const other = u => (u === 'metric' ? 'imperial' : 'metric');

export function fmtLen(m, units = settings.units) {
  if (m == null || !isFinite(m)) return '--';
  if (units === 'metric') {
    if (Math.abs(m) < 1) return `${(m * 100).toFixed(1)} cm`;
    return `${m.toFixed(2)} m`;
  }
  const inches = m / M_PER_IN;
  if (Math.abs(inches) < 12) return `${inches.toFixed(1)} in`;
  let ft = Math.floor(inches / 12);
  let rem = Math.round((inches - ft * 12) * 2) / 2;
  if (rem >= 12) { ft += 1; rem = 0; }
  return `${ft}′ ${rem % 1 ? rem.toFixed(1) : rem}″`;
}
export const fmtLenAlt = m => fmtLen(m, other(settings.units));

export function fmtArea(m2, units = settings.units) {
  if (m2 == null || !isFinite(m2)) return '--';
  return units === 'metric' ? `${m2.toFixed(2)} m²` : `${(m2 * SQFT_PER_M2).toFixed(1)} sq ft`;
}
export const fmtAreaAlt = m2 => fmtArea(m2, other(settings.units));

export function fmtVol(m3, units = settings.units) {
  if (m3 == null || !isFinite(m3)) return '--';
  if (units === 'metric') return m3 < 1 ? `${(m3 * 1000).toFixed(1)} L` : `${m3.toFixed(3)} m³`;
  return `${(m3 * CUFT_PER_M3).toFixed(2)} cu ft`;
}
export const fmtVolAlt = m3 => fmtVol(m3, other(settings.units));

export const fmtDeg = d => (d == null || !isFinite(d) ? '--' : `${d.toFixed(1)}°`);

export function inr(n) {
  if (!isFinite(n)) return '--';
  return '₹' + Math.round(n).toLocaleString('en-IN');
}
export function num(n, digits = 1) {
  if (!isFinite(n)) return '--';
  return Number(n).toLocaleString('en-IN', { maximumFractionDigits: digits });
}
