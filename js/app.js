import { settings, saveSettings, setUnits, onUnitsChange, num } from './units.js';
import { $, $$, esc, toast, sheet, copyText, shareText, shareBlob, downloadBlob, sketchCanvas, canvasBlob, icons } from './ui.js';
import { listEntries, updateEntry, removeEntry, clearEntries, getImage } from './store.js';
import { arSupported, startAR } from './ar.js';
import { level, protractor, ruler, converter, calibrateRuler } from './tools.js';
import { paint, tiles, curtains, carpet } from './estimators.js';

const AR_TOOLS = [
  ['tape', 'Tape measure', 'Point to point, any direction', icons.tape],
  ['height', 'Height', 'From the floor up: people, doors, furniture', icons.height],
  ['area', 'Area & perimeter', 'Tap the corners of a room, wall or table', icons.area],
  ['angle', 'Angle', 'Between two edges, like a corner or a slope', icons.angle],
  ['distance', 'Distance from phone', 'How far away a spot is', icons.distance],
  ['box', 'Box volume', 'Length × width × height of a carton or cupboard', icons.box],
  ['path', 'Path length', 'Bent runs: wiring, piping, a garden edge', icons.path],
];
const PHONE_TOOLS = [
  ['level', 'Spirit level', 'Flat bullseye or edge bar', icons.level],
  ['protractor', 'Tilt protractor', 'Slope, grade and edge angles', icons.protractor],
  ['ruler', 'Screen ruler', 'Small objects, calibrated with a bank card', icons.ruler],
  ['convert', 'Unit converter', 'cm, ft, sq ft, gaj, guntha, litres', icons.convert],
];
const ESTIMATORS = [
  ['paint', 'Paint', 'Litres, cans and cost for a room', icons.paint],
  ['tiles', 'Tiles & flooring', 'Boxes with wastage, cost per sq ft', icons.tiles],
  ['curtains', 'Curtains', 'Panels and fabric metres', icons.curtain],
  ['carpet', 'Carpet vs built-up', 'Loading % and real price per sq ft', icons.home],
];
const ROUTES = {
  level: ['Spirit level', level],
  protractor: ['Tilt protractor', protractor],
  ruler: ['Screen ruler', ruler],
  convert: ['Unit converter', converter],
  paint: ['Paint estimate', paint],
  tiles: ['Tiles & flooring', tiles],
  curtains: ['Curtains', curtains],
  carpet: ['Carpet vs built-up', carpet],
  history: ['History', historyView],
  settings: ['Settings', settingsView],
};
const TOOL_NAMES = Object.fromEntries([...AR_TOOLS, ...PHONE_TOOLS, ...ESTIMATORS].map(([k, name]) => [k, name]));

let cleanup = null;
let arState = 'checking';
arSupported().then(ok => { arState = ok ? 'ok' : 'no'; if (!location.hash.replace('#', '')) home(); });

function route() {
  cleanup?.(); cleanup = null;
  const key = location.hash.replace('#', '');
  const screen = $('#screen');
  window.scrollTo(0, 0);
  if (!ROUTES[key]) { $('#back').hidden = true; $('#title').textContent = ''; home(); return; }
  const [title, fn] = ROUTES[key];
  $('#back').hidden = false;
  $('#title').textContent = title;
  screen.innerHTML = '';
  cleanup = fn(screen, { exit: () => goHome() }) || null;
}
const goHome = () => { if (history.length > 1 && location.hash) history.back(); else location.hash = ''; };

// ------------------------------------------------------------- home
function rows(list, ar) {
  return `<div class="rows">${list.map(([k, name, desc, icon]) => `
    <button class="row ${ar ? 'ar' : ''}" data-${ar ? 'ar' : 'go'}="${k}">
      <span class="glyph">${icon}</span>
      <span class="txt"><b>${esc(name)}</b><span>${esc(desc)}</span></span>
      <span class="chev">${icons.chev}</span>
    </button>`).join('')}</div>`;
}

function home() {
  const n = listEntries().length;
  const status = {
    checking: ['', 'Checking camera measuring…'],
    ok: ['ok', 'Camera measuring ready'],
    no: ['no', 'Camera measuring not available here'],
  }[arState];
  $('#screen').innerHTML = `
    <section class="hero">
      <p class="wordmark">Tapeline</p>
      <div class="blade" aria-hidden="true">${[1, 2, 4, 5, 6, 7, 8].map(i => `<span style="left:${i * 100}px">${i * 10}</span>`).join('')}<span class="foot" style="left:304.8px">1F</span></div>
      <p class="lede">Measure with your camera, level a shelf, price a paint job. No ads, no sign-up, nothing leaves your phone.</p>
      <span class="status ${status[0]}"><i></i>${status[1]}</span>
    </section>

    <section class="group">
      <div class="group-head"><h2>Camera</h2><small>Chrome + ARCore phones</small></div>
      ${rows(AR_TOOLS, true)}
    </section>
    <section class="group">
      <div class="group-head"><h2>Phone tools</h2><small>Work on any phone</small></div>
      ${rows(PHONE_TOOLS)}
    </section>
    <section class="group">
      <div class="group-head"><h2>Home estimates</h2><small>sq ft and ₹</small></div>
      ${rows(ESTIMATORS)}
    </section>
    <section class="group">
      <div class="rows">
        <button class="row" data-go="history"><span class="glyph">${icons.history}</span><span class="txt"><b>History</b><span>${n ? `${n} saved` : 'Nothing saved yet'}</span></span><span class="chev">${icons.chev}</span></button>
        <button class="row" data-go="settings"><span class="glyph">${icons.settings}</span><span class="txt"><b>Settings</b><span>Units, snapping, ruler calibration</span></span><span class="chev">${icons.chev}</span></button>
      </div>
    </section>
    <p class="footnote">Camera readings are usually within 1 to 2 cm over a couple of metres in good light. Use a real tape for anything you're cutting.</p>`;

  $$('[data-go]').forEach(b => (b.onclick = () => { location.hash = b.dataset.go; }));
  $$('[data-ar]').forEach(b => (b.onclick = () => openAR(b.dataset.ar)));
}

function openAR(mode) {
  if (arState === 'no' || !navigator.xr) { arHelp(); return; }
  // startAR must run synchronously inside the tap, so no awaits before it.
  startAR(mode, () => { if (!location.hash) home(); }).catch(err => {
    console.warn(err);
    if (err && (err.name === 'NotSupportedError' || err.code === 'no-xr')) arHelp();
    else if (err && err.name === 'SecurityError') toast('Camera blocked. Allow camera for this site and try again.', 3500);
    else toast('Could not start the camera. Close other camera apps and try again.', 3500);
  });
}

function arHelp() {
  sheet(`
    <h2>Camera measuring isn't available</h2>
    <p class="note" style="margin:0">It needs all three of these:</p>
    <div class="rows">
      <div class="row"><span class="txt"><b>An ARCore-supported Android phone</b><span>Most phones from the last few years. Google keeps the list.</span></span></div>
      <div class="row"><span class="txt"><b>Google Play Services for AR</b><span>Free on the Play Store. Install or update it.</span></span></div>
      <div class="row"><span class="txt"><b>Chrome</b><span>Samsung Internet, Firefox and in-app browsers (WhatsApp, Instagram) won't work.</span></span></div>
    </div>
    <div class="btn-row">
      <a class="btn" href="https://play.google.com/store/apps/details?id=com.google.ar.core" target="_blank" rel="noopener">Get Play Services for AR</a>
      <a class="btn ghost" href="https://developers.google.com/ar/devices" target="_blank" rel="noopener">Supported phones</a>
    </div>
    <p class="note" style="margin:0">On iPhone, Safari doesn't offer this. Apple's built-in Measure app does the same job. The level, ruler, converter and estimators here work on any phone.</p>
    <button class="btn ghost" data-close>OK</button>`);
}

// ------------------------------------------------------------- history
function historyView(el) {
  const urls = [];
  const render = () => {
    const list = listEntries();
    if (!list.length) {
      el.innerHTML = `<div class="empty"><p>Nothing saved yet.</p><p>Measurements you save, and anything left on screen when you close the camera, show up here.</p></div>`;
      return;
    }
    el.innerHTML = `
      <div class="btn-row" style="margin-bottom:12px"><button class="btn ghost" id="copy-all">Copy all as text</button></div>
      ${list.map(e => `
      <article class="card entry" data-id="${e.id}">
        <header><span class="tag">${esc(TOOL_NAMES[e.tool] || e.tool)}</span><time>${new Date(e.ts).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</time></header>
        <input class="title-input" value="${esc(e.title)}" aria-label="Name" data-rename>
        ${e.photo ? '<img alt="Measurement photo" data-img>' : ''}
        <pre>${esc(e.text || e.value)}</pre>
        <div class="btn-row">
          <button class="btn ghost" data-act="copy">Copy</button>
          <button class="btn ghost" data-act="share">Share</button>
          ${e.photo ? '<button class="btn ghost" data-act="photo">Save photo</button>' : ''}
          ${e.data?.polys?.length ? '<button class="btn ghost" data-act="sketch">Room sketch</button>' : ''}
          <button class="btn ghost" data-act="del">Delete</button>
        </div>
      </article>`).join('')}`;
    $('#copy-all', el).onclick = () => copyText(list.map(entryText).join('\n\n'));
    $$('[data-img]', el).forEach(async img => {
      const id = img.closest('[data-id]').dataset.id;
      try { const b = await getImage(id); if (b) { const u = URL.createObjectURL(b); urls.push(u); img.src = u; } else img.remove(); } catch { img.remove(); }
    });
    $$('[data-rename]', el).forEach(inp => (inp.onchange = () => updateEntry(inp.closest('[data-id]').dataset.id, { title: inp.value.trim() || 'Untitled' })));
    $$('[data-act]', el).forEach(b => (b.onclick = async () => {
      const id = b.closest('[data-id]').dataset.id;
      const e = listEntries().find(x => x.id === id);
      if (!e) return;
      const act = b.dataset.act;
      if (act === 'copy') copyText(entryText(e));
      if (act === 'share') shareText(entryText(e));
      if (act === 'photo') { const blob = await getImage(id); if (blob) shareBlob(blob, `${slug(e.title)}.png`, entryText(e)); }
      if (act === 'sketch') showSketch(e);
      if (act === 'del') {
        if (b.dataset.armed) { removeEntry(id); render(); }
        else { b.dataset.armed = '1'; b.textContent = 'Tap again to delete'; b.classList.add('danger'); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; b.classList.remove('danger'); } }, 3000); }
      }
    }));
  };
  render();
  return () => urls.forEach(u => URL.revokeObjectURL(u));
}
const slug = s => (s || 'tapeline').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tapeline';
const entryText = e => `${e.title}\n${e.text || e.value}\n${new Date(e.ts).toLocaleDateString('en-IN')} · Tapeline`;

async function showSketch(e) {
  const polys = e.data.polys;
  let i = 0;
  sheet(`<h2>Room sketch</h2><img id="sk-img" alt="Top-down sketch"><div class="btn-row">
      ${polys.length > 1 ? '<button class="btn ghost" id="sk-next">Next shape</button>' : ''}
      <button class="btn" id="sk-share">Share PNG</button><button class="btn ghost" id="sk-dl">Download</button><button class="btn ghost" data-close>Close</button></div>
      <p class="note" style="margin:0">Drawn from the corners you tapped, flattened onto the floor plane.</p>`, async root => {
    let blob, url;
    const paintIt = async () => {
      const c = sketchCanvas(polys[i], polys.length > 1 ? `${e.title} ${i + 1}` : e.title);
      blob = await canvasBlob(c);
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      $('#sk-img', root).src = url;
    };
    await paintIt();
    $('#sk-share', root).onclick = () => shareBlob(blob, `${slug(e.title)}-sketch.png`);
    $('#sk-dl', root).onclick = () => downloadBlob(blob, `${slug(e.title)}-sketch.png`);
    const next = $('#sk-next', root); if (next) next.onclick = () => { i = (i + 1) % polys.length; paintIt(); };
  });
}

// ------------------------------------------------------------- settings
function settingsView(el) {
  const render = () => {
    el.innerHTML = `
      <div class="form" style="margin-top:0">
        <h3>Units</h3>
        <div class="seg"><button data-units="metric" aria-pressed="${settings.units === 'metric'}">Metric (cm, m)</button><button data-units="imperial" aria-pressed="${settings.units === 'imperial'}">Feet & inches</button></div>
        <h3>Camera</h3>
        <label class="check"><input type="checkbox" id="snap" ${settings.snap ? 'checked' : ''}> Snap lines to level and plumb when they're within a few degrees</label>
        <h3>Screen ruler</h3>
        <div class="btn-row"><button class="btn ghost" id="cal">${settings.ppmm ? 'Recalibrate' : 'Calibrate'} with a bank card</button></div>
        <p class="note" style="margin:0">${settings.ppmm ? `Calibrated: ${num(settings.ppmm, 2)} screen points per mm.` : 'Not calibrated yet.'}</p>
        <h3>Data</h3>
        <div class="btn-row"><button class="btn ghost" id="clear">Delete all history</button></div>
        <p class="note" style="margin:0">Everything is stored only in this browser on this phone. Clearing Chrome's site data deletes it.</p>
      </div>`;
    $$('[data-units]', el).forEach(b => (b.onclick = () => { setUnits(b.dataset.units); render(); }));
    $('#snap', el).onchange = e => { settings.snap = e.target.checked; saveSettings(); };
    $('#cal', el).onclick = () => calibrateRuler(render);
    $('#clear', el).onclick = e => {
      const b = e.target;
      if (b.dataset.armed) { clearEntries(); toast('History deleted'); render(); return; }
      b.dataset.armed = '1'; b.textContent = 'Tap again to delete everything'; b.classList.add('danger');
    };
  };
  render();
}

// ------------------------------------------------------------- boot
function syncUnitToggle() {
  $('#u-metric').setAttribute('aria-pressed', String(settings.units === 'metric'));
  $('#u-imperial').setAttribute('aria-pressed', String(settings.units === 'imperial'));
}
$('#u-metric').onclick = () => setUnits('metric');
$('#u-imperial').onclick = () => setUnits('imperial');
onUnitsChange(() => {
  syncUnitToggle();
  const key = location.hash.replace('#', '');
  if (key === 'history') route();
});
$('#back').onclick = goHome;
window.addEventListener('hashchange', route);
syncUnitToggle();
route();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
