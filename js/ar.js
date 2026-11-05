// Camera measuring with WebXR (Chrome on Android uses ARCore underneath).
// The camera feed is composited by the browser; we draw lines and labels on a 2D canvas inside the DOM overlay.
import {
  sub, add, scale, dist, norm, cross, mid, pathLength, polygon, centroid, angleAt,
  verticalHeight, snapPoint, rotateByQuat, mulMat4,
} from './geometry.js';
import {
  settings, saveSettings, setUnits, onUnitsChange,
  fmtLen, fmtLenAlt, fmtArea, fmtAreaAlt, fmtVol, fmtVolAlt, fmtDeg,
} from './units.js';
import { $, toast, roundRect, canvasBlob } from './ui.js';
import { addEntry, putImage } from './store.js';

const NEAR = 0.05;
const BLADE = '#f4c634';
let S = null; // live session state

export async function arSupported() {
  try { return !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')); }
  catch { return false; }
}

// ---------------------------------------------------------------- modes
const snapped = s => {
  if (!s.hit) return null;
  const prev = s.pts[s.pts.length - 1];
  if (prev && settings.snap) return snapPoint(prev, s.hit);
  return { p: s.hit, kind: null };
};
const kindTag = k => (k === 'level' ? ' · level' : k === 'plumb' ? ' · plumb' : '');
const noSurface = 'Point at the floor or a table and move the phone slowly';

export const AR_MODES = {
  tape: {
    name: 'Tape',
    cursor: snapped,
    add(s, c) {
      if (!s.pts.length) s.pts = [c.p];
      else { s.done.push({ a: s.pts[0], b: c.p, kind: c.kind }); s.pts = []; }
    },
    readout(s) {
      const c = s.cursor;
      if (s.pts.length && c) { const L = dist(s.pts[0], c.p); return { value: fmtLen(L), sub: fmtLenAlt(L) + kindTag(c.kind), hint: 'Aim at the other end, tap +' }; }
      const last = s.done[s.done.length - 1];
      const hint = c ? 'Aim at one end, tap +' : noSurface;
      if (last) { const L = dist(last.a, last.b); return { value: fmtLen(L), sub: fmtLenAlt(L), hint }; }
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = s.done.map(d => ({ t: 'line', a: d.a, b: d.b, label: fmtLen(dist(d.a, d.b)), kind: d.kind }));
      if (s.pts.length) {
        out.push({ t: 'dot', p: s.pts[0] });
        if (s.cursor) out.push({ t: 'line', a: s.pts[0], b: s.cursor.p, label: fmtLen(dist(s.pts[0], s.cursor.p)), kind: s.cursor.kind, live: true });
      }
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => `Line ${i + 1}: ${fmtLen(dist(d.a, d.b))} (${fmtLenAlt(dist(d.a, d.b))})${kindTag(d.kind)}`);
      const value = items.length === 1 ? fmtLen(dist(items[0].a, items[0].b)) : `${items.length} lines`;
      return { title: 'Tape', value, lines, data: { segments: items.map(d => [d.a, d.b]) } };
    },
  },

  height: {
    name: 'Height',
    cursor(s) {
      if (!s.pts.length) return s.hit ? { p: s.hit } : null;
      const t = verticalHeight(s.pts[0], s.camPos, s.camDir);
      if (t == null) return null;
      const b = s.pts[0];
      return { p: [b[0], b[1] + Math.max(0, t), b[2]], kind: 'plumb', free: true };
    },
    add(s, c) {
      if (!s.pts.length) s.pts = [c.p];
      else { s.done.push({ a: s.pts[0], b: c.p }); s.pts = []; }
    },
    readout(s) {
      if (s.pts.length && s.cursor) { const H = dist(s.pts[0], s.cursor.p); return { value: fmtLen(H), sub: fmtLenAlt(H), hint: 'Tilt up until the crosshair sits on the top, tap +' }; }
      const last = s.done[s.done.length - 1];
      const hint = s.hit ? 'Aim at the floor where it stands, tap +' : noSurface;
      if (last) { const H = dist(last.a, last.b); return { value: fmtLen(H), sub: fmtLenAlt(H), hint }; }
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = s.done.map(d => ({ t: 'line', a: d.a, b: d.b, label: fmtLen(dist(d.a, d.b)) }));
      if (s.pts.length) {
        out.push({ t: 'dot', p: s.pts[0] });
        if (s.cursor) out.push({ t: 'line', a: s.pts[0], b: s.cursor.p, label: fmtLen(dist(s.pts[0], s.cursor.p)), live: true });
      }
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => `Height ${i + 1}: ${fmtLen(dist(d.a, d.b))} (${fmtLenAlt(dist(d.a, d.b))})`);
      return { title: 'Height', value: items.length === 1 ? fmtLen(dist(items[0].a, items[0].b)) : `${items.length} heights`, lines, data: { segments: items.map(d => [d.a, d.b]) } };
    },
  },

  area: {
    name: 'Area',
    finishLabel: 'Close',
    cursor(s) {
      if (!s.hit) return null;
      if (s.pts.length >= 3 && dist(s.hit, s.pts[0]) < 0.06) return { p: s.pts[0], close: true };
      return snapped(s);
    },
    add(s, c) { if (c.close) this.finish(s); else s.pts.push(c.p); },
    canFinish: s => s.pts.length >= 3,
    finish(s) { if (s.pts.length >= 3) { s.done.push({ pts: s.pts.slice() }); s.pts = []; } },
    readout(s) {
      const c = s.cursor;
      if (s.pts.length >= 2 && c) {
        const poly = c.close ? s.pts : [...s.pts, c.p];
        const { area } = polygon(poly);
        return { value: fmtArea(area), sub: `${fmtAreaAlt(area)} · perimeter ${fmtLen(pathLength(poly, true))}`, hint: s.pts.length >= 3 ? 'Tap + on the first corner, or Close' : 'Tap + at the next corner' };
      }
      const last = s.done[s.done.length - 1];
      const hint = !c ? noSurface : s.pts.length ? 'Tap + at the next corner' : 'Tap + at the first corner';
      if (last) { const { area } = polygon(last.pts); return { value: fmtArea(area), sub: `${fmtAreaAlt(area)} · perimeter ${fmtLen(pathLength(last.pts, true))}`, hint }; }
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = [];
      s.done.forEach(d => {
        out.push({ t: 'poly', pts: d.pts });
        d.pts.forEach((p, i) => { const q = d.pts[(i + 1) % d.pts.length]; out.push({ t: 'line', a: p, b: q, label: fmtLen(dist(p, q)), small: true }); });
        out.push({ t: 'label', p: centroid(d.pts), text: fmtArea(polygon(d.pts).area), big: true });
      });
      for (let i = 1; i < s.pts.length; i++) out.push({ t: 'line', a: s.pts[i - 1], b: s.pts[i], label: fmtLen(dist(s.pts[i - 1], s.pts[i])), small: true });
      s.pts.forEach(p => out.push({ t: 'dot', p }));
      if (s.pts.length && s.cursor) {
        const last = s.pts[s.pts.length - 1];
        out.push({ t: 'line', a: last, b: s.cursor.p, label: fmtLen(dist(last, s.cursor.p)), kind: s.cursor.kind, live: true });
        if (s.pts.length >= 2 && !s.cursor.close) out.push({ t: 'line', a: s.cursor.p, b: s.pts[0], dash: true });
      }
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => {
        const { area } = polygon(d.pts);
        return `Area ${i + 1}: ${fmtArea(area)} (${fmtAreaAlt(area)}), perimeter ${fmtLen(pathLength(d.pts, true))}`;
      });
      const total = items.reduce((t, d) => t + polygon(d.pts).area, 0);
      return { title: 'Area', value: fmtArea(total), m2: total, lines, data: { polys: items.map(d => d.pts) } };
    },
  },

  angle: {
    name: 'Angle',
    cursor: snapped,
    add(s, c) {
      s.pts.push(c.p);
      if (s.pts.length === 3) { const [a, b, cc] = s.pts; s.done.push({ a, b, c: cc }); s.pts = []; }
    },
    readout(s) {
      const hints = ['Tap + at the end of the first arm', 'Tap + on the corner', 'Tap + at the end of the second arm'];
      const hint = s.cursor ? hints[s.pts.length] : noSurface;
      if (s.pts.length === 2 && s.cursor) return { value: fmtDeg(angleAt(s.pts[0], s.pts[1], s.cursor.p)), sub: '', hint };
      const last = s.done[s.done.length - 1];
      if (last) return { value: fmtDeg(angleAt(last.a, last.b, last.c)), sub: '', hint };
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = [];
      s.done.forEach(d => {
        out.push({ t: 'line', a: d.a, b: d.b }, { t: 'line', a: d.b, b: d.c });
        out.push({ t: 'label', p: d.b, text: fmtDeg(angleAt(d.a, d.b, d.c)), big: true });
      });
      s.pts.forEach(p => out.push({ t: 'dot', p }));
      if (s.pts.length === 2) out.push({ t: 'line', a: s.pts[0], b: s.pts[1] });
      if (s.pts.length && s.cursor) {
        out.push({ t: 'line', a: s.pts[s.pts.length - 1], b: s.cursor.p, kind: s.cursor.kind, live: true });
        if (s.pts.length === 2) out.push({ t: 'label', p: s.pts[1], text: fmtDeg(angleAt(s.pts[0], s.pts[1], s.cursor.p)), big: true });
      }
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => `Angle ${i + 1}: ${fmtDeg(angleAt(d.a, d.b, d.c))}`);
      return { title: 'Angle', value: items.length === 1 ? fmtDeg(angleAt(items[0].a, items[0].b, items[0].c)) : `${items.length} angles`, lines, data: {} };
    },
  },

  distance: {
    name: 'Distance',
    cursor: s => (s.hit ? { p: s.hit } : null),
    add(s, c) { s.done.push({ p: c.p, d: dist(s.camPos, c.p) }); },
    readout(s) {
      if (s.cursor) { const d = dist(s.camPos, s.cursor.p); return { value: fmtLen(d), sub: `${fmtLenAlt(d)} from phone`, hint: 'Tap + to pin this spot' }; }
      return { value: '--', sub: '', hint: noSurface };
    },
    prims: s => s.done.map(d => ({ t: 'pin', p: d.p, text: fmtLen(d.d) })),
    summary(items) {
      const lines = items.map((d, i) => `Pin ${i + 1}: ${fmtLen(d.d)} (${fmtLenAlt(d.d)}) from phone`);
      return { title: 'Distance', value: items.length === 1 ? fmtLen(items[0].d) : `${items.length} pins`, lines, data: {} };
    },
  },

  path: {
    name: 'Path',
    finishLabel: 'Finish',
    cursor: snapped,
    add(s, c) { s.pts.push(c.p); },
    canFinish: s => s.pts.length >= 2,
    finish(s) { if (s.pts.length >= 2) { s.done.push({ pts: s.pts.slice() }); s.pts = []; } },
    readout(s) {
      if (s.pts.length && s.cursor) {
        const L = pathLength([...s.pts, s.cursor.p]);
        return { value: fmtLen(L), sub: `${fmtLenAlt(L)} · ${s.pts.length} points`, hint: s.pts.length >= 2 ? 'Tap + at the next bend, or Finish' : 'Tap + at the next bend' };
      }
      const last = s.done[s.done.length - 1];
      const hint = s.cursor ? 'Tap + where the path starts' : noSurface;
      if (last) { const L = pathLength(last.pts); return { value: fmtLen(L), sub: fmtLenAlt(L), hint }; }
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = [];
      const chain = (pts, live) => {
        for (let i = 1; i < pts.length; i++) out.push({ t: 'line', a: pts[i - 1], b: pts[i], label: fmtLen(dist(pts[i - 1], pts[i])), small: true, live });
        pts.forEach(p => out.push({ t: 'dot', p }));
      };
      s.done.forEach(d => { chain(d.pts); out.push({ t: 'label', p: d.pts[d.pts.length - 1], text: `Σ ${fmtLen(pathLength(d.pts))}`, big: true }); });
      chain(s.pts);
      if (s.pts.length && s.cursor) out.push({ t: 'line', a: s.pts[s.pts.length - 1], b: s.cursor.p, label: fmtLen(dist(s.pts[s.pts.length - 1], s.cursor.p)), kind: s.cursor.kind, live: true });
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => `Path ${i + 1}: ${fmtLen(pathLength(d.pts))} (${fmtLenAlt(pathLength(d.pts))}), ${d.pts.length - 1} segments`);
      return { title: 'Path', value: items.length === 1 ? fmtLen(pathLength(items[0].pts)) : `${items.length} paths`, lines, data: { paths: items.map(d => d.pts) } };
    },
  },

  box: {
    name: 'Box volume',
    cursor(s) {
      if (s.pts.length < 3) return snapped(s);
      const t = verticalHeight(s.pts[2], s.camPos, s.camDir);
      if (t == null) return null;
      const b = s.pts[2];
      return { p: [b[0], b[1] + Math.max(0, t), b[2]], kind: 'plumb', free: true };
    },
    add(s, c) {
      if (s.pts.length < 3) s.pts.push(c.p);
      else { const [p0, p1, p2] = s.pts; s.done.push({ p0, p1, p2, h: c.p[1] - p2[1] }); s.pts = []; }
    },
    readout(s) {
      const hints = ['Tap + on a bottom corner', 'Tap + at the end of the length', 'Tap + at the end of the width', 'Tilt up to the top edge, tap +'];
      const hint = s.cursor ? hints[s.pts.length] : (s.pts.length === 3 ? hints[3] : noSurface);
      const P = s.pts, c = s.cursor;
      if (P.length === 1 && c) return { value: fmtLen(dist(P[0], c.p)), sub: 'Length', hint };
      if (P.length === 2 && c) return { value: fmtLen(dist(P[1], c.p)), sub: `Width · length ${fmtLen(dist(P[0], P[1]))}`, hint };
      if (P.length === 3 && c) {
        const L = dist(P[0], P[1]), W = dist(P[1], P[2]), H = c.p[1] - P[2][1];
        return { value: fmtVol(L * W * H), sub: `${fmtLen(L)} × ${fmtLen(W)} × ${fmtLen(H)}`, hint };
      }
      const last = s.done[s.done.length - 1];
      if (last) { const { L, W, H } = dims(last); return { value: fmtVol(L * W * H), sub: `${fmtLen(L)} × ${fmtLen(W)} × ${fmtLen(H)}`, hint }; }
      return { value: '--', sub: '', hint };
    },
    prims(s) {
      const out = [];
      const drawBox = (p0, p1, p2, h, live) => {
        const p3 = add(p0, sub(p2, p1));
        const base = [p0, p1, p2, p3];
        base.forEach((p, i) => out.push({ t: 'line', a: p, b: base[(i + 1) % 4], label: i < 2 ? fmtLen(dist(p, base[(i + 1) % 4])) : null, small: true, live }));
        if (h > 0.005) {
          const top = base.map(p => [p[0], p[1] + h, p[2]]);
          top.forEach((p, i) => out.push({ t: 'line', a: p, b: top[(i + 1) % 4], live }));
          base.forEach((p, i) => out.push({ t: 'line', a: p, b: top[i], label: i === 2 ? fmtLen(h) : null, small: true, live }));
        }
      };
      s.done.forEach(d => drawBox(d.p0, d.p1, d.p2, d.h));
      const P = s.pts, c = s.cursor;
      P.forEach(p => out.push({ t: 'dot', p }));
      if (P.length === 1 && c) out.push({ t: 'line', a: P[0], b: c.p, label: fmtLen(dist(P[0], c.p)), live: true, kind: c.kind });
      if (P.length === 2) { out.push({ t: 'line', a: P[0], b: P[1] }); if (c) drawBox(P[0], P[1], c.p, 0, true); }
      if (P.length === 3) drawBox(P[0], P[1], P[2], c ? c.p[1] - P[2][1] : 0, true);
      return out;
    },
    summary(items) {
      const lines = items.map((d, i) => {
        const { L, W, H } = dims(d);
        return `Box ${i + 1}: ${fmtLen(L)} × ${fmtLen(W)} × ${fmtLen(H)} = ${fmtVol(L * W * H)} (${fmtVolAlt(L * W * H)})`;
      });
      const d = items[0], v = dims(d);
      return { title: 'Box', value: items.length === 1 ? fmtVol(v.L * v.W * v.H) : `${items.length} boxes`, lines, data: {} };
    },
  },
};
const dims = d => ({ L: dist(d.p0, d.p1), W: dist(d.p1, d.p2), H: d.h });

// ---------------------------------------------------------------- session
let wired = false;
function wireUI() {
  if (wired) return; wired = true;
  const root = $('#ar');
  // Taps on our buttons must not also count as a tap on the scene.
  root.addEventListener('beforexrselect', e => { if (e.target.closest('button')) e.preventDefault(); });
  $('#ar-add').addEventListener('click', doAdd);
  $('#ar-undo').addEventListener('click', () => {
    if (!S) return;
    if (S.pts.length) S.pts.pop(); else if (S.done.length > S.savedUpTo) S.done.pop();
    refresh();
  });
  $('#ar-finish').addEventListener('click', () => { if (S && mode().finish) { mode().finish(S); buzz(); refresh(); } });
  $('#ar-save').addEventListener('click', () => { if (save()) toast('Saved to History'); });
  $('#ar-photo').addEventListener('click', () => { if (S) { S.wantPhoto = true; } });
  $('#ar-close').addEventListener('click', () => S?.session.end());
  $('#ar-units').addEventListener('click', () => setUnits(settings.units === 'metric' ? 'imperial' : 'metric'));
  $('#ar-snap').addEventListener('click', () => { settings.snap = !settings.snap; saveSettings(); refresh(); });
  onUnitsChange(() => refresh());
}

const mode = () => AR_MODES[S.mode];
const buzz = () => { try { navigator.vibrate?.(12); } catch { /* not allowed */ } };

function doAdd() {
  if (!S) return;
  const c = S.cursor;
  if (!c) { toast('No surface yet. Move the phone slowly.'); return; }
  mode().add(S, c);
  buzz();
  refresh();
}

function refresh() {
  if (!S) return;
  const m = mode();
  const r = m.readout(S);
  $('#ar-value').textContent = r.value;
  $('#ar-sub').textContent = r.sub;
  $('#ar-hint').textContent = S.tracking ? r.hint : 'Tracking lost. Move slowly, more light helps.';
  $('#ar-mode').textContent = m.name;
  $('#ar-units').textContent = settings.units === 'metric' ? 'cm' : 'ft';
  $('#ar-snap').setAttribute('aria-pressed', String(settings.snap));
  $('#ar-undo').disabled = !(S.pts.length || S.done.length > S.savedUpTo);
  const fin = $('#ar-finish');
  fin.hidden = !m.finishLabel;
  if (m.finishLabel) { fin.textContent = m.finishLabel; fin.disabled = !m.canFinish(S); }
  $('#ar-save').disabled = S.done.length <= S.savedUpTo;
}

function save() {
  if (!S) return null;
  const items = S.done.slice(S.savedUpTo);
  if (!items.length) return null;
  const sum = mode().summary(items);
  try {
    const entry = addEntry({ tool: S.mode, title: sum.title, value: sum.value, text: sum.lines.join('\n'), data: sum.data, m2: sum.m2 });
    S.savedUpTo = S.done.length;
    refresh();
    return entry;
  } catch { toast('Could not save. Phone storage may be full.'); return null; }
}

export async function startAR(modeName, onEnd) {
  wireUI();
  if (S) return;
  if (!navigator.xr) throw Object.assign(new Error('no-xr'), { code: 'no-xr' });
  const root = $('#ar');
  root.hidden = false;
  $('#ar-mode').textContent = AR_MODES[modeName].name;
  $('#ar-value').textContent = '--';
  $('#ar-sub').textContent = '';
  let session;
  try {
    // Must be the first await: Chrome only allows this inside the tap that opened it.
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'dom-overlay'],
      optionalFeatures: ['camera-access'],
      domOverlay: { root },
    });
  } catch (err) { root.hidden = true; throw err; }

  try {
    const glCanvas = document.createElement('canvas');
    const gl = glCanvas.getContext('webgl2', { xrCompatible: true }) || glCanvas.getContext('webgl', { xrCompatible: true });
    session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });
    const ref = await session.requestReferenceSpace('local');
    const viewer = await session.requestReferenceSpace('viewer');
    const hitSource = await session.requestHitTestSource({ space: viewer });
    let binding = null;
    try { if (typeof XRWebGLBinding !== 'undefined') binding = new XRWebGLBinding(session, gl); } catch { /* no camera access */ }
    S = {
      mode: modeName, session, gl, ref, hitSource, binding, onEnd,
      pts: [], done: [], savedUpTo: 0, hit: null, hitNormal: [0, 1, 0], cursor: null,
      camPos: [0, 0, 0], camDir: [0, 0, -1], proj: null, viewMat: null, tracking: false, wantPhoto: false,
    };
    session.addEventListener('end', finishSession);
    session.addEventListener('select', doAdd);
    refresh();
    session.requestAnimationFrame(onFrame);
  } catch (err) {
    session.end().catch(() => {});
    root.hidden = true;
    throw err;
  }
}

function finishSession() {
  if (!S) return;
  let autoSaved = false;
  if (S.done.length > S.savedUpTo) autoSaved = !!save();
  try { S.hitSource.cancel(); } catch { /* already gone */ }
  const cb = S.onEnd;
  S = null;
  $('#ar').hidden = true;
  if (autoSaved) toast('Measurements saved to History');
  cb?.();
}

function onFrame(t, frame) {
  const s = S;
  if (!s || frame.session !== s.session) return;
  s.session.requestAnimationFrame(onFrame);
  const { gl } = s;
  const layer = s.session.renderState.baseLayer;
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  const pose = frame.getViewerPose(s.ref);
  if (!pose) { s.tracking = false; s.hit = null; s.cursor = null; refresh(); drawOverlay(); return; }
  s.tracking = true;
  const view = pose.views[0];
  s.proj = view.projectionMatrix;
  s.viewMat = view.transform.inverse.matrix;
  const o = view.transform.position;
  s.camPos = [o.x, o.y, o.z];
  s.camDir = norm(rotateByQuat([0, 0, -1], view.transform.orientation));

  const hits = frame.getHitTestResults(s.hitSource);
  if (hits.length) {
    const hp = hits[0].getPose(s.ref);
    if (hp) {
      const p = hp.transform.position;
      s.hit = [p.x, p.y, p.z];
      s.hitNormal = norm(rotateByQuat([0, 1, 0], hp.transform.orientation));
    }
  } else s.hit = null;

  s.cursor = mode().cursor(s);
  refresh();
  if (s.wantPhoto) { s.wantPhoto = false; capturePhoto(view); }
  drawOverlay();
}

// ---------------------------------------------------------------- drawing
function drawOverlay() {
  const c = $('#ar-canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  if (!S || !S.viewMat) return;
  drawScene(ctx, w, h, dpr, true);
}

function drawScene(ctx, w, h, k, withReticle) {
  const s = S;
  const toView = p => mulMat4(s.viewMat, [p[0], p[1], p[2], 1]);
  const toScreen = v => {
    const c = mulMat4(s.proj, [v[0], v[1], v[2], 1]);
    return [(c[0] / c[3] * 0.5 + 0.5) * w, (1 - (c[1] / c[3] * 0.5 + 0.5)) * h];
  };
  const proj = p => { const v = toView(p); return v[2] < -NEAR ? toScreen(v) : null; };
  const clipSeg = (a, b) => {
    let va = toView(a), vb = toView(b);
    const ina = va[2] < -NEAR, inb = vb[2] < -NEAR;
    if (!ina && !inb) return null;
    if (!ina || !inb) {
      const t = (-NEAR - va[2]) / (vb[2] - va[2]);
      const m = [va[0] + (vb[0] - va[0]) * t, va[1] + (vb[1] - va[1]) * t, -NEAR];
      if (!ina) va = m; else vb = m;
    }
    return [toScreen(va), toScreen(vb)];
  };
  const label = (pt, text, big) => {
    if (!pt || !text) return;
    const fs = (big ? 20 : 15) * k;
    ctx.font = `600 ${fs}px Barlow, Roboto, sans-serif`;
    const tw = ctx.measureText(text).width, ph = fs * 1.7, pw = tw + fs * 1.2;
    ctx.fillStyle = 'rgba(20,20,18,.85)';
    roundRect(ctx, pt[0] - pw / 2, pt[1] - ph / 2, pw, ph, ph / 2); ctx.fill();
    ctx.fillStyle = BLADE; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, pt[0], pt[1] + fs * 0.05);
  };
  const dot = (p, r = 6, fill = '#fff') => {
    const q = proj(p); if (!q) return;
    ctx.beginPath(); ctx.arc(q[0], q[1], r * k, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill(); ctx.lineWidth = 2 * k; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  };

  const prims = mode().prims(s);
  const labels = [];
  for (const pr of prims) {
    if (pr.t === 'poly') {
      const pts = pr.pts.map(proj);
      if (pts.some(p => !p)) continue;
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.fillStyle = 'rgba(244,198,52,.28)'; ctx.fill();
    }
  }
  for (const pr of prims) {
    if (pr.t === 'line') {
      const seg = clipSeg(pr.a, pr.b); if (!seg) continue;
      const [[x1, y1], [x2, y2]] = seg;
      ctx.setLineDash(pr.dash ? [8 * k, 8 * k] : []);
      ctx.lineCap = 'round';
      ctx.lineWidth = 6 * k; ctx.strokeStyle = 'rgba(0,0,0,.45)';
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.lineWidth = 3 * k; ctx.strokeStyle = pr.kind ? '#7fe3a2' : pr.live ? '#ffffff' : BLADE;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.setLineDash([]);
      if (pr.label) labels.push([[(x1 + x2) / 2, (y1 + y2) / 2], pr.label + kindTag(pr.kind), false]);
    } else if (pr.t === 'dot') dot(pr.p);
    else if (pr.t === 'pin') { dot(pr.p, 7, BLADE); const q = proj(pr.p); if (q) labels.push([[q[0], q[1] - 26 * k], pr.text, false]); }
    else if (pr.t === 'label') labels.push([proj(pr.p), pr.text, pr.big]);
  }
  labels.forEach(([pt, text, big]) => label(pt, text, big));

  if (withReticle && s.hit) {
    const n = s.hitNormal;
    const t1 = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
    const t2 = cross(n, t1);
    const ring = [];
    for (let i = 0; i <= 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      ring.push(proj(add(s.hit, add(scale(t1, Math.cos(a) * 0.04), scale(t2, Math.sin(a) * 0.04)))));
    }
    if (ring.every(Boolean)) {
      ctx.beginPath(); ring.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.lineWidth = 4 * k; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke();
      ctx.lineWidth = 2 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }
  if (withReticle && s.cursor) dot(s.cursor.p, 5, s.cursor.close ? '#7fe3a2' : BLADE);
}

// ---------------------------------------------------------------- photo
function capturePhoto(view) {
  const s = S;
  const { gl } = s;
  let w = Math.round(window.innerWidth * 2), h = Math.round(window.innerHeight * 2);
  const canvas = document.createElement('canvas');
  let gotCamera = false;
  try {
    if (s.binding && view.camera) {
      const cam = view.camera;
      w = cam.width; h = cam.height;
      const tex = s.binding.getCameraImage(cam);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE) {
        const px = new Uint8Array(w * h * 4);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d');
        const img = ctx.createImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        ctx.putImageData(img, 0, 0);
        gotCamera = true;
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, s.session.renderState.baseLayer.framebuffer);
      gl.deleteFramebuffer(fb);
    }
  } catch { gotCamera = false; }

  if (!gotCamera) {
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#1b1c19'; ctx.fillRect(0, 0, w, h);
  }
  const ctx = canvas.getContext('2d');
  const k = w / window.innerWidth;
  drawScene(ctx, w, h, k, false);

  const r = mode().readout(s);
  const band = 64 * k;
  ctx.fillStyle = 'rgba(20,20,18,.85)'; ctx.fillRect(0, h - band, w, band);
  ctx.fillStyle = BLADE; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${30 * k}px "Barlow Condensed", Roboto, sans-serif`;
  ctx.fillText(`${mode().name}: ${r.value}`, 16 * k, h - band / 2);
  ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = `500 ${14 * k}px Barlow, Roboto, sans-serif`;
  ctx.fillText(new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) + ' · Tapeline', w - 16 * k, h - band / 2);

  const items = s.done.length ? s.done : [];
  const sum = items.length ? mode().summary(items) : { title: mode().name, value: r.value, lines: [`${mode().name}: ${r.value}`], data: {} };
  canvasBlob(canvas).then(async blob => {
    try {
      const entry = addEntry({ tool: s.mode, title: `${sum.title} photo`, value: sum.value, text: sum.lines.join('\n'), data: sum.data, m2: sum.m2, photo: true });
      await putImage(entry.id, blob);
      toast(gotCamera ? 'Photo saved to History' : 'Saved. This phone blocks the camera image, so the photo has labels only.', gotCamera ? 2200 : 3800);
    } catch { toast('Could not save the photo. Storage may be full.'); }
  });
}
