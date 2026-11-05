// Phone tools that need no camera tracking: spirit level, tilt protractor, screen ruler, unit converter.
import { settings, saveSettings, num } from './units.js';
import { $, $$, esc, sheet, copyText } from './ui.js';

const DEG = 180 / Math.PI;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Smoothed gravity vector from the accelerometer.
function gravity(onSample) {
  const g = { x: 0, y: 0, z: 0, ready: false };
  const handler = e => {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    if (!g.ready) { Object.assign(g, { x: a.x, y: a.y, z: a.z, ready: true }); }
    else { g.x += (a.x - g.x) * 0.15; g.y += (a.y - g.y) * 0.15; g.z += (a.z - g.z) * 0.15; }
    onSample(g);
  };
  const needsPermission = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function';
  return {
    needsPermission,
    async start() {
      if (needsPermission) {
        try { if (await DeviceMotionEvent.requestPermission() !== 'granted') return false; } catch { return false; }
      }
      window.addEventListener('devicemotion', handler);
      return true;
    },
    stop() { window.removeEventListener('devicemotion', handler); },
    g,
  };
}

function sensorGate(el, sensor, onStart) {
  const warn = el.querySelector('[data-sensor-warn]');
  const go = async () => {
    const ok = await sensor.start();
    if (!ok) { warn.hidden = false; warn.textContent = 'Motion access was refused. Allow motion sensors for this site in browser settings.'; return; }
    onStart?.();
    setTimeout(() => { if (!sensor.g.ready) { warn.hidden = false; warn.textContent = 'No motion data. Open this on a phone in Chrome.'; } }, 1500);
  };
  if (sensor.needsPermission) {
    const b = document.createElement('button');
    b.className = 'btn'; b.textContent = 'Start sensors';
    b.onclick = () => { b.remove(); go(); };
    warn.before(b);
  } else go();
}

function readOffsets(key) { try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; } }
function writeOffsets(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } }

// ------------------------------------------------------------- spirit level
export function level(el) {
  el.innerHTML = `
  <div class="instrument">
    <div class="vial" id="vial"><div class="bubble" id="bubble"></div></div>
    <div class="tube" id="tube" hidden><div class="bubble" id="tbubble"></div></div>
    <div class="readout num" id="deg">--</div>
    <div class="sub-readouts num"><span id="lmode">Waiting for sensor</span><span id="lxy"></span></div>
    <p class="note" data-sensor-warn hidden></p>
    <div class="btn-row">
      <button class="btn ghost" id="cal">Calibrate</button>
      <button class="btn ghost" id="reset">Reset</button>
    </div>
    <p class="note">Lay the phone flat for a bullseye, or stand it on an edge for a bar level. To calibrate, put it on a surface, tap Calibrate, then turn it 180° on the same spot and check the reading matches. Turn on rotation lock first.</p>
  </div>`;
  const KEY = 'tl.level.offsets';
  let off = { fx: 0, fy: 0, up: 0, ...readOffsets(KEY) };
  let last = null;
  const sensor = gravity(g => {
    const mag = Math.hypot(g.x, g.y, g.z) || 9.81;
    const flat = Math.abs(g.z) > mag * 0.8;
    $('#vial', el).hidden = !flat;
    $('#tube', el).hidden = flat;
    let shown;
    if (flat) {
      const tx = Math.atan2(g.x, Math.abs(g.z)) * DEG - off.fx;
      const ty = Math.atan2(g.y, Math.abs(g.z)) * DEG - off.fy;
      last = { flat, tx, ty, rawx: tx + off.fx, rawy: ty + off.fy };
      shown = Math.hypot(tx, ty);
      $('#bubble', el).style.left = `${50 + clamp(tx, -10, 10) * 4}%`;
      $('#bubble', el).style.top = `${50 - clamp(ty, -10, 10) * 4}%`;
      $('#lmode', el).textContent = 'Flat';
      $('#lxy', el).textContent = `X ${tx.toFixed(1)}° · Y ${ty.toFixed(1)}°`;
    } else {
      const roll = Math.atan2(g.x, g.y) * DEG;
      const dev = roll - Math.round(roll / 90) * 90 - off.up;
      last = { flat, dev, raw: dev + off.up };
      shown = Math.abs(dev);
      $('#tbubble', el).style.left = `${50 + clamp(dev, -10, 10) * 4}%`;
      $('#lmode', el).textContent = 'On edge';
      $('#lxy', el).textContent = '';
    }
    const d = $('#deg', el);
    d.innerHTML = `${shown.toFixed(1)}<small>°</small>`;
    d.classList.toggle('ok', shown < 0.3);
  });
  sensorGate(el, sensor);
  $('#cal', el).onclick = () => {
    if (!last) return;
    if (last.flat) { off.fx = last.rawx; off.fy = last.rawy; } else off.up = last.raw;
    writeOffsets(KEY, off);
  };
  $('#reset', el).onclick = () => { off = { fx: 0, fy: 0, up: 0 }; writeOffsets(KEY, off); };
  return () => sensor.stop();
}

// ------------------------------------------------------------- tilt protractor
export function protractor(el) {
  el.innerHTML = `
  <div class="instrument">
    <div class="readout num" id="ang">--</div>
    <div class="sub-readouts num"><span id="pmode">Waiting for sensor</span><span>Grade <b id="grade">--</b></span><span><b id="ratio">--</b></span></div>
    <p class="note" data-sensor-warn hidden></p>
    <div class="btn-row">
      <button class="btn" id="hold">Hold</button>
      <button class="btn ghost" id="zero">Set zero</button>
    </div>
    <p class="note" id="zero-note" hidden>Measuring relative to the zero you set. Tap Clear zero to go back to true level.</p>
    <p class="note"><b>Slope of a surface:</b> lay the phone flat on it. <b>Angle of an edge</b> (stair rail, roof line, a leg of a table): hold the phone's long side against it. <b>Angle between two surfaces:</b> set zero on the first, then read the second.</p>
  </div>`;
  let held = false, zero = null, current = 0;
  const sensor = gravity(g => {
    if (held) return;
    const mag = Math.hypot(g.x, g.y, g.z) || 9.81;
    const flat = Math.abs(g.z) > mag * 0.7;
    const a = flat
      ? Math.acos(clamp(Math.abs(g.z) / mag, 0, 1)) * DEG
      : Math.atan2(Math.abs(g.y), Math.abs(g.x)) * DEG;
    current = a;
    const shown = zero == null ? a : Math.abs(a - zero);
    $('#ang', el).innerHTML = `${shown.toFixed(1)}<small>°</small>`;
    const t = Math.tan(shown / DEG);
    $('#grade', el).textContent = shown >= 89.5 ? '--' : `${(t * 100).toFixed(1)}%`;
    $('#ratio', el).textContent = t > 0.0005 && shown < 89.5 ? `1 in ${num(1 / t, 1)}` : 'level';
    $('#pmode', el).textContent = flat ? 'Surface slope' : 'Edge angle';
  });
  sensorGate(el, sensor);
  $('#hold', el).onclick = e => { held = !held; e.target.textContent = held ? 'Release' : 'Hold'; };
  $('#zero', el).onclick = e => {
    zero = zero == null ? current : null;
    e.target.textContent = zero == null ? 'Set zero' : 'Clear zero';
    $('#zero-note', el).hidden = zero == null;
  };
  return () => sensor.stop();
}

// ------------------------------------------------------------- screen ruler
const CARD_SHORT_MM = 53.98; // ISO/IEC 7810 ID-1, every debit/credit/Aadhaar PVC card

export function calibrateRuler(onDone) {
  let ppmm = settings.ppmm || 6.3;
  sheet(`
    <h2>Calibrate the ruler</h2>
    <p class="note" style="margin:0">Place any bank card on the screen with its <b>short edge</b> along the bar. Drag the slider until the bar matches the card exactly.</p>
    <div id="cal-bar" class="card-shape" style="height:44px">card short edge</div>
    <input class="range" type="range" id="cal-range" min="3" max="10" step="0.01" value="${ppmm}">
    <div class="btn-row" style="justify-content:center">
      <button class="btn ghost" id="cal-minus">−</button>
      <button class="btn ghost" id="cal-plus">+</button>
    </div>
    <div class="btn-row"><button class="btn" id="cal-save">Save calibration</button><button class="btn ghost" data-close>Cancel</button></div>
  `, (root, close) => {
    const bar = $('#cal-bar', root), range = $('#cal-range', root);
    const paint = () => { bar.style.width = `${CARD_SHORT_MM * ppmm}px`; range.value = ppmm; };
    range.oninput = () => { ppmm = Number(range.value); paint(); };
    $('#cal-minus', root).onclick = () => { ppmm = Math.max(3, ppmm - 0.02); paint(); };
    $('#cal-plus', root).onclick = () => { ppmm = Math.min(10, ppmm + 0.02); paint(); };
    $('#cal-save', root).onclick = () => { settings.ppmm = ppmm; saveSettings(); close(); onDone?.(); };
    paint();
  });
}

export function ruler(el, { exit }) {
  const wrap = document.createElement('div');
  wrap.className = 'ruler-wrap';
  wrap.innerHTML = `<canvas></canvas>
    <div class="ruler-hud">
      <div class="val num" id="rv">--</div>
      <div class="alt num" id="ra"></div>
      <div class="btn-row"><button id="rcal">Calibrate</button><button id="rclose">Close</button></div>
      <div id="rwarn" style="font-size:14px;max-width:24ch"></div>
    </div>`;
  document.body.appendChild(wrap);
  const canvas = $('canvas', wrap);
  const ctx = canvas.getContext('2d');
  let A = 80, B = 300; // handle positions, CSS px from top
  const ppmm = () => settings.ppmm || 6.3;

  const draw = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = '#1b1c19';
    ctx.strokeStyle = ink; ctx.fillStyle = ink; ctx.lineWidth = 1;
    ctx.font = '600 14px Barlow, Roboto, sans-serif'; ctx.textBaseline = 'middle';
    // metric on the left
    const p = ppmm();
    for (let mm = 0; mm * p < H; mm++) {
      const y = mm * p + 0.5;
      const L = mm % 10 === 0 ? 28 : mm % 5 === 0 ? 18 : 10;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(L, y); ctx.stroke();
      if (mm % 10 === 0 && mm) { ctx.textAlign = 'left'; ctx.fillText(String(mm / 10), 32, y); }
    }
    // inches on the right
    const pi = p * 25.4;
    for (let s = 0; (s / 16) * pi < H; s++) {
      const y = (s / 16) * pi + 0.5;
      const L = s % 16 === 0 ? 28 : s % 8 === 0 ? 22 : s % 4 === 0 ? 16 : s % 2 === 0 ? 11 : 7;
      ctx.beginPath(); ctx.moveTo(W - L, y); ctx.lineTo(W, y); ctx.stroke();
      if (s % 16 === 0 && s) { ctx.textAlign = 'right'; ctx.fillText(`${s / 16}″`, W - 32, y); }
    }
    ctx.textAlign = 'left'; ctx.fillText('cm', 32, 12); ctx.textAlign = 'right'; ctx.fillText('in', W - 32, 12);
    // handles
    [A, B].forEach(y => {
      ctx.strokeStyle = '#c3362b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = '#c3362b'; ctx.beginPath(); ctx.arc(W / 2, y, 9, 0, Math.PI * 2); ctx.fill();
    });
    const mm = Math.abs(B - A) / p;
    $('#rv', wrap).textContent = mm < 100 ? `${mm.toFixed(1)} mm` : `${(mm / 10).toFixed(2)} cm`;
    $('#ra', wrap).textContent = `${(mm / 25.4).toFixed(2)} in`;
    $('#rwarn', wrap).textContent = settings.ppmm ? 'Drag the red lines to the edges of the object.' : 'Not calibrated yet, readings are approximate. Tap Calibrate.';
  };

  let drag = null;
  canvas.style.touchAction = 'none';
  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    drag = Math.abs(e.clientY - A) < Math.abs(e.clientY - B) ? 'A' : 'B';
    wrap.setPointerCapture(e.pointerId);
    move(e);
  });
  const move = e => {
    if (!drag) return;
    const y = clamp(e.clientY - wrap.getBoundingClientRect().top, 0, wrap.clientHeight);
    if (drag === 'A') A = y; else B = y;
    draw();
  };
  wrap.addEventListener('pointermove', move);
  wrap.addEventListener('pointerup', () => { drag = null; });
  $('#rcal', wrap).onclick = () => calibrateRuler(draw);
  $('#rclose', wrap).onclick = exit;
  window.addEventListener('resize', draw);
  draw();
  el.innerHTML = '';
  return () => { wrap.remove(); window.removeEventListener('resize', draw); };
}

// ------------------------------------------------------------- unit converter
const UNITS = {
  Length: { base: 'm', list: [['mm', 0.001], ['cm', 0.01], ['m', 1], ['km', 1000], ['inch', 0.0254], ['ft', 0.3048], ['yard', 0.9144]] },
  Area: {
    base: 'sq ft',
    list: [['sq ft', 1], ['sq m', 10.7639104], ['sq yd', 9], ['gaj', 9], ['sq in', 1 / 144], ['cent', 435.6], ['guntha', 1089], ['acre', 43560], ['hectare', 107639.104]],
  },
  Volume: { base: 'L', list: [['ml', 0.001], ['L', 1], ['cu m', 1000], ['cu ft', 28.3168466], ['cu in', 0.016387064], ['US gallon', 3.78541178]] },
};

export function converter(el) {
  let cat = 'Area', from = 'sq ft', val = 1000;
  try { ({ cat = cat, from = from, val = val } = JSON.parse(localStorage.getItem('tl.conv') || '{}')); } catch { /* defaults */ }
  const render = () => {
    const U = UNITS[cat];
    if (!U.list.some(([u]) => u === from)) from = U.list[0][0];
    const f = U.list.find(([u]) => u === from)[1];
    el.innerHTML = `
      <div class="seg" role="group" aria-label="Category">${Object.keys(UNITS).map(c => `<button data-cat="${c}" aria-pressed="${c === cat}">${c}</button>`).join('')}</div>
      <div class="form">
        <div class="fields">
          <div class="field"><label for="cv">Value</label><div class="input"><input id="cv" type="number" inputmode="decimal" step="any" value="${esc(val)}"></div></div>
          <div class="field"><label for="cu">From</label><div class="input"><select id="cu">${U.list.map(([u]) => `<option ${u === from ? 'selected' : ''}>${u}</option>`).join('')}</select></div></div>
        </div>
      </div>
      <div class="rows" style="margin-top:14px">${U.list.filter(([u]) => u !== from).map(([u, k]) => {
        const out = (Number(val) || 0) * f / k;
        const shown = Math.abs(out) >= 0.01 || out === 0 ? num(out, 3) : out.toPrecision(3);
        return `<button class="row" data-copy="${esc(shown)} ${u}"><span class="txt"><b class="num">${shown}</b><span>${u}</span></span><span class="chev">Copy</span></button>`;
      }).join('')}</div>
      ${cat === 'Area' ? '<p class="note">Gaj is taken as 1 sq yd (9 sq ft), the usual figure in north India. Guntha is 1,089 sq ft and cent is 435.6 sq ft. Bigha varies by state, so it is left out.</p>' : ''}`;
    $$('[data-cat]', el).forEach(b => (b.onclick = () => { cat = b.dataset.cat; persist(); render(); }));
    $('#cv', el).oninput = e => { val = e.target.value; persist(); renderRowsOnly(); };
    $('#cu', el).onchange = e => { from = e.target.value; persist(); render(); };
    $$('[data-copy]', el).forEach(b => (b.onclick = () => copyText(b.dataset.copy)));
  };
  // Re-render rows without stealing focus from the input
  const renderRowsOnly = () => {
    const input = $('#cv', el); const pos = input.selectionStart;
    render();
    const again = $('#cv', el); again.focus();
    try { again.setSelectionRange(pos, pos); } catch { /* number inputs refuse */ }
  };
  const persist = () => { try { localStorage.setItem('tl.conv', JSON.stringify({ cat, from, val })); } catch { /* ignore */ } };
  render();
}
