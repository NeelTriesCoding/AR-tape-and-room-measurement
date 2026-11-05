import { flatten, polygon, pathLength } from './geometry.js';
import { fmtLen, fmtArea, fmtAreaAlt } from './units.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let toastTimer;
export function toast(msg, ms = 2200) {
  const arOpen = !$('#ar').hidden;
  const el = arOpen ? $('#ar-toast') : $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

export function sheet(html, onMount) {
  const back = document.createElement('div');
  back.className = 'sheet-backdrop';
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); window.removeEventListener('popstate', close); };
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) close(); });
  document.body.appendChild(back);
  onMount?.(back.firstElementChild, close);
  return close;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); return; } catch { /* fall back */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); toast('Copied'); } catch { toast('Copy failed. Long-press to select instead.'); }
  ta.remove();
}

export async function shareText(text) {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  copyText(text);
}

export async function shareBlob(blob, filename, text = '') {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  downloadBlob(blob, filename);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// Top-down room sketch as a PNG-ready canvas. Fixed light palette so it prints and shares cleanly.
export function sketchCanvas(points, title = 'Room') {
  const S = 1200, pad = 150;
  const c = document.createElement('canvas');
  c.width = S; c.height = S + 140;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);

  // grid
  ctx.strokeStyle = '#eceee8'; ctx.lineWidth = 1;
  for (let i = 0; i <= S; i += 40) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, S); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(S, i); ctx.stroke();
  }

  const flat = flatten(points);
  const xs = flat.map(p => p[0]), ys = flat.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const k = Math.min((S - pad * 2) / (maxX - minX || 1), (S - pad * 2) / (maxY - minY || 1));
  const ox = (S - (maxX - minX) * k) / 2, oy = (S - (maxY - minY) * k) / 2;
  const P = flat.map(([x, y]) => [ox + (x - minX) * k, oy + (y - minY) * k]);

  ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
  ctx.fillStyle = 'rgba(242,190,34,.35)'; ctx.fill();
  ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.strokeStyle = '#1b1c19'; ctx.stroke();

  // side labels, pushed outward from the polygon centre
  const cx = P.reduce((s, p) => s + p[0], 0) / P.length, cy = P.reduce((s, p) => s + p[1], 0) / P.length;
  ctx.font = '600 34px Barlow, Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const L = Math.hypot(points[i][0] - points[(i + 1) % P.length][0], points[i][1] - points[(i + 1) % P.length][1], points[i][2] - points[(i + 1) % P.length][2]);
    let mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const dx = mx - cx, dy = my - cy, dl = Math.hypot(dx, dy) || 1;
    mx += dx / dl * 44; my += dy / dl * 44;
    const text = fmtLen(L);
    const w = ctx.measureText(text).width + 24;
    ctx.fillStyle = '#1b1c19'; roundRect(ctx, mx - w / 2, my - 24, w, 48, 24); ctx.fill();
    ctx.fillStyle = '#f2be22'; ctx.fillText(text, mx, my + 1);
  }
  ctx.fillStyle = '#c3362b';
  P.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); });

  // footer
  const { area } = polygon(points);
  ctx.fillStyle = '#1b1c19'; ctx.fillRect(0, S, c.width, 140);
  ctx.textAlign = 'left'; ctx.fillStyle = '#f2be22';
  ctx.font = '700 56px "Barlow Condensed", Arial, sans-serif';
  ctx.fillText(`${fmtArea(area)}  ·  ${fmtAreaAlt(area)}`, 40, S + 52);
  ctx.fillStyle = '#ffffff'; ctx.font = '500 30px Barlow, Arial, sans-serif';
  ctx.fillText(`${title} · perimeter ${fmtLen(pathLength(points, true))} · Tapeline`, 40, S + 104);
  return c;
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export const canvasBlob = c => new Promise(res => c.toBlob(res, 'image/png'));

const I = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const icons = {
  tape: I('<path d="M3 15h18"/><path d="M3 11v8M21 11v8"/><path d="M7 15v-2M11 15v-3M15 15v-2M19 15v-3"/>'),
  height: I('<path d="M12 3v18"/><path d="M8 7l4-4 4 4M8 17l4 4 4-4"/><path d="M5 21h14"/>'),
  area: I('<path d="M4 7l6-3 10 4-2 11-12 1z"/><circle cx="4" cy="7" r="1"/><circle cx="20" cy="8" r="1"/>'),
  angle: I('<path d="M4 20L18 5"/><path d="M4 20h16"/><path d="M10 20a6 6 0 0 0-2-4.5"/>'),
  distance: I('<rect x="3" y="6" width="6" height="12" rx="1.5"/><path d="M12 12h6"/><circle cx="20" cy="12" r="1.6"/><path d="M14 10l-2 2 2 2"/>'),
  box: I('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  path: I('<path d="M4 18l5-8 5 5 6-10"/><circle cx="4" cy="18" r="1.3"/><circle cx="9" cy="10" r="1.3"/><circle cx="14" cy="15" r="1.3"/><circle cx="20" cy="5" r="1.3"/>'),
  level: I('<rect x="2" y="9" width="20" height="6" rx="3"/><ellipse cx="12" cy="12" rx="2.5" ry="1.4"/><path d="M8.5 9v6M15.5 9v6"/>'),
  protractor: I('<path d="M3 18a9 9 0 0 1 18 0z"/><path d="M12 18l5-6"/><path d="M7 18v-1M17 18v-1M12 9v1"/>'),
  ruler: I('<rect x="7" y="2" width="10" height="20" rx="1.5"/><path d="M7 6h4M7 10h3M7 14h4M7 18h3"/>'),
  convert: I('<path d="M4 8h14l-3-3M20 16H6l3 3"/>'),
  paint: I('<rect x="3" y="3" width="15" height="6" rx="1.5"/><path d="M18 6h2v5h-8v3"/><rect x="10.5" y="14" width="3" height="7" rx="1"/>'),
  tiles: I('<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 12h18M12 3v18"/>'),
  curtain: I('<path d="M3 4h18"/><path d="M5 4c0 6 1 11 4 16M19 4c0 6-1 11-4 16"/><path d="M9 20h-4M15 20h4"/>'),
  home: I('<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>'),
  history: I('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v4h4"/><path d="M12 8v4l3 2"/>'),
  settings: I('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  chev: I('<path d="M9 5l7 7-7 7"/>'),
};
