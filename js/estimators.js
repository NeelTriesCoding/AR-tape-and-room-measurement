// Home estimators in sq ft and INR. Every default is editable; rates are the user's own.
import { num, inr, SQFT_PER_M2 } from './units.js';
import { $, $$, esc, copyText, toast } from './ui.js';
import { listEntries, addEntry } from './store.js';

const F = (id, label, v, suffix = '', extra = '') => `
  <div class="field"><label for="${id}">${label}</label>
    <div class="input"><input id="${id}" name="${id}" type="number" inputmode="decimal" step="any" min="0" value="${esc(v[id])}" ${extra}>${suffix ? `<span class="suffix">${suffix}</span>` : ''}</div></div>`;
const C = (id, label, v) => `<label class="check"><input type="checkbox" id="${id}" name="${id}" ${v[id] ? 'checked' : ''}> ${label}</label>`;
const SEL = (id, label, v, opts) => `
  <div class="field"><label for="${id}">${label}</label>
    <div class="input"><select id="${id}" name="${id}">${opts.map(([val, text]) => `<option value="${esc(val)}" ${String(v[id]) === String(val) ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select></div></div>`;
const SEG = (id, v, opts) => `<div class="seg" role="group">${opts.map(([val, text]) => `<button type="button" data-seg="${id}" data-val="${val}" aria-pressed="${v[id] === val}">${text}</button>`).join('')}</div>`;

function areaChips(target) {
  const areas = listEntries().filter(e => e.m2 > 0).slice(0, 6);
  if (!areas.length) return '';
  return `<div class="field"><label>Use a saved measurement</label><div class="chips">${areas.map(e =>
    `<button type="button" class="chip" data-fill="${target}" data-val="${(e.m2 * SQFT_PER_M2).toFixed(1)}"><b>${num(e.m2 * SQFT_PER_M2, 0)} sq ft</b> · ${esc(e.title)}</button>`).join('')}</div></div>`;
}

function estimator(el, { key, defaults, form, compute, note }) {
  let v;
  try { v = { ...defaults, ...JSON.parse(localStorage.getItem('tl.est.' + key) || '{}') }; } catch { v = { ...defaults }; }
  const save = () => { try { localStorage.setItem('tl.est.' + key, JSON.stringify(v)); } catch { /* ignore */ } };
  let last = null;

  const renderResult = () => {
    const r = compute(v);
    last = r;
    $('#res', el).innerHTML = `
      <div><div class="label">${esc(r.bigLabel)}</div><div class="big">${esc(r.big)}</div></div>
      <dl>${r.rows.map(([k, val]) => `<dt>${esc(k)}</dt><dd>${esc(val)}</dd>`).join('')}</dl>
      <div class="actions"><button id="r-copy">Copy</button><button id="r-save">Save to History</button></div>`;
    $('#r-copy', el).onclick = () => copyText(r.text);
    $('#r-save', el).onclick = () => {
      try { addEntry({ tool: key, title: r.title, value: r.big, text: r.text }); toast('Saved to History'); }
      catch { toast('Could not save. Storage may be full.'); }
    };
  };
  const renderForm = () => {
    $('#frm', el).innerHTML = form(v);
    $$('[data-seg]', el).forEach(b => (b.onclick = () => { v[b.dataset.seg] = b.dataset.val; save(); renderForm(); renderResult(); }));
    $$('[data-fill]', el).forEach(b => (b.onclick = () => {
      v[b.dataset.fill] = Number(b.dataset.val); save(); renderForm(); renderResult(); toast('Filled in');
    }));
  };
  el.innerHTML = `<section class="result" id="res" aria-live="polite"></section><form class="form" id="frm" novalidate></form>${note ? `<p class="note">${note}</p>` : ''}`;
  const frm = $('#frm', el);
  frm.addEventListener('submit', e => e.preventDefault());
  const onChange = e => {
    const t = e.target;
    if (!t.name) return;
    v[t.name] = t.type === 'checkbox' ? t.checked : t.tagName === 'SELECT' ? t.value : (t.value === '' ? '' : Number(t.value));
    if (key === 'tiles' && t.name === 'size' && TILE_SIZES[t.value]) { Object.assign(v, TILE_SIZES[t.value]); renderForm(); }
    save(); renderResult();
  };
  frm.addEventListener('input', onChange);
  frm.addEventListener('change', onChange);
  renderForm(); renderResult();
}
const n = x => (Number(x) > 0 ? Number(x) : 0);

// ------------------------------------------------------------- paint
function bestPacks(litres) {
  const need = Math.max(0, litres);
  let best = null;
  for (let a = 0; a <= Math.ceil(need / 20); a++)
    for (let b = 0; b <= 2; b++)
      for (let c = 0; c <= 3; c++)
        for (let d = 0; d <= 4; d++) {
          const tot = 20 * a + 10 * b + 4 * c + d;
          if (tot < need) continue;
          const cnt = a + b + c + d;
          if (!best || tot < best.tot || (tot === best.tot && cnt < best.cnt)) best = { tot, cnt, a, b, c, d };
        }
  const parts = [[best.a, 20], [best.b, 10], [best.c, 4], [best.d, 1]].filter(([k]) => k).map(([k, s]) => `${k} × ${s} L`);
  return { total: best.tot, text: parts.join(' + ') || 'none' };
}

export function paint(el) {
  estimator(el, {
    key: 'paint',
    defaults: { mode: 'room', L: 12, W: 10, H: 10, doors: 1, doorW: 3, doorH: 7, windows: 1, winW: 4, winH: 4, ceiling: false, area: 350, coats: 2, coverage: 120, price: 400 },
    form: v => `
      ${SEG('mode', v, [['room', 'Room size'], ['area', 'Wall area']])}
      ${v.mode === 'room' ? `
        <div class="fields">${F('L', 'Length', v, 'ft')}${F('W', 'Width', v, 'ft')}${F('H', 'Wall height', v, 'ft')}</div>
        <h3>Doors and windows</h3>
        <div class="fields">${F('doors', 'Doors', v)}${F('doorW', 'Door width', v, 'ft')}${F('doorH', 'Door height', v, 'ft')}</div>
        <div class="fields">${F('windows', 'Windows', v)}${F('winW', 'Window width', v, 'ft')}${F('winH', 'Window height', v, 'ft')}</div>
        ${C('ceiling', 'Paint the ceiling too', v)}` : `
        <div class="fields">${F('area', 'Area to paint', v, 'sq ft')}</div>${areaChips('area')}`}
      <h3>Paint</h3>
      <div class="fields">${F('coats', 'Coats', v)}${F('coverage', 'Coverage per coat', v, 'sq ft/L')}${F('price', 'Your price', v, '₹/L')}</div>`,
    compute(v) {
      let areaSqft;
      if (v.mode === 'room') {
        const walls = 2 * (n(v.L) + n(v.W)) * n(v.H);
        const openings = n(v.doors) * n(v.doorW) * n(v.doorH) + n(v.windows) * n(v.winW) * n(v.winH);
        areaSqft = Math.max(0, walls - openings) + (v.ceiling ? n(v.L) * n(v.W) : 0);
      } else areaSqft = n(v.area);
      const litres = n(v.coverage) ? areaSqft * n(v.coats) / n(v.coverage) : 0;
      const packs = bestPacks(litres);
      const cost = packs.total * n(v.price);
      const rows = [
        ['Paintable area', `${num(areaSqft, 0)} sq ft`],
        ['Coats', String(n(v.coats))],
        ['Buy', packs.text],
        ['Approx. cost', inr(cost)],
      ];
      return {
        title: 'Paint estimate', bigLabel: 'Paint needed', big: `${num(litres, 1)} L`, rows,
        text: `Paint estimate\nArea: ${num(areaSqft, 0)} sq ft, ${n(v.coats)} coats\nPaint: ${num(litres, 1)} L (buy ${packs.text})\nCost: about ${inr(cost)} at ₹${n(v.price)}/L`,
      };
    },
    note: 'Coverage differs by brand and wall: check the can. Emulsions usually state 100 to 140 sq ft per litre per coat on a primed wall. Putty and primer are not included.',
  });
}

// ------------------------------------------------------------- tiles
const TILE_SIZES = {
  '300x300': { tw: 300, th: 300, perBox: 9 },
  '300x600': { tw: 300, th: 600, perBox: 6 },
  '600x600': { tw: 600, th: 600, perBox: 4 },
  '600x1200': { tw: 600, th: 1200, perBox: 2 },
  '800x800': { tw: 800, th: 800, perBox: 3 },
  '800x1600': { tw: 800, th: 1600, perBox: 2 },
  custom: {},
};
export function tiles(el) {
  estimator(el, {
    key: 'tiles',
    defaults: { mode: 'area', area: 150, L: 12, W: 10, size: '600x600', tw: 600, th: 600, perBox: 4, wastage: 10, price: 60 },
    form: v => `
      ${SEG('mode', v, [['area', 'Floor area'], ['room', 'Room size']])}
      ${v.mode === 'room'
        ? `<div class="fields">${F('L', 'Length', v, 'ft')}${F('W', 'Width', v, 'ft')}</div>`
        : `<div class="fields">${F('area', 'Area to cover', v, 'sq ft')}</div>${areaChips('area')}`}
      <h3>Tile</h3>
      <div class="fields">${SEL('size', 'Size', v, [['300x300', '300 × 300 mm (1 × 1 ft)'], ['300x600', '300 × 600 mm (1 × 2 ft)'], ['600x600', '600 × 600 mm (2 × 2 ft)'], ['600x1200', '600 × 1200 mm (2 × 4 ft)'], ['800x800', '800 × 800 mm'], ['800x1600', '800 × 1600 mm'], ['custom', 'Custom']])}</div>
      <div class="fields">${F('tw', 'Tile width', v, 'mm')}${F('th', 'Tile length', v, 'mm')}${F('perBox', 'Tiles per box', v)}</div>
      <div class="fields">${F('wastage', 'Wastage', v, '%')}${F('price', 'Your price', v, '₹/sq ft')}</div>`,
    compute(v) {
      const area = v.mode === 'room' ? n(v.L) * n(v.W) : n(v.area);
      const tileSqft = (n(v.tw) * n(v.th)) / 92903.04;
      const tilesNeeded = tileSqft ? Math.ceil(area * (1 + n(v.wastage) / 100) / tileSqft) : 0;
      const boxes = n(v.perBox) ? Math.ceil(tilesNeeded / n(v.perBox)) : 0;
      const bought = boxes * n(v.perBox) * tileSqft;
      const cost = bought * n(v.price);
      return {
        title: 'Tile estimate', bigLabel: 'Boxes to buy', big: `${boxes} boxes`,
        rows: [
          ['Floor area', `${num(area, 0)} sq ft`],
          ['Tiles incl. wastage', String(tilesNeeded)],
          ['Area you pay for', `${num(bought, 1)} sq ft`],
          ['Approx. cost', inr(cost)],
        ],
        text: `Tile estimate\nArea: ${num(area, 0)} sq ft, tile ${n(v.tw)} × ${n(v.th)} mm, ${n(v.wastage)}% wastage\nTiles: ${tilesNeeded}, boxes: ${boxes} (${n(v.perBox)} per box)\nCost: about ${inr(cost)} at ₹${n(v.price)}/sq ft`,
      };
    },
    note: 'Tiles per box changes by brand and thickness, so check the box label. Use 10% wastage for straight laying and about 15% for diagonal or patterned laying. Skirting is not included.',
  });
}

// ------------------------------------------------------------- curtains
export function curtains(el) {
  estimator(el, {
    key: 'curtains',
    defaults: { width: 60, drop: 84, windows: 1, overhang: 6, fullness: '2', fabricW: '54', allowance: 16, price: 300 },
    form: v => `
      <div class="fields">${F('width', 'Window width', v, 'in')}${F('drop', 'Drop (rod to hem)', v, 'in')}${F('windows', 'Windows', v)}</div>
      <div class="fields">${F('overhang', 'Rod past frame, each side', v, 'in')}${F('allowance', 'Hem + heading', v, 'in')}</div>
      <div class="fields">
        ${SEL('fullness', 'Fullness', v, [['1.5', '1.5× (flat, eyelet)'], ['2', '2× (standard)'], ['2.5', '2.5× (rich pleats)']])}
        ${SEL('fabricW', 'Fabric roll width', v, [['44', '44 in'], ['48', '48 in'], ['54', '54 in'], ['110', '110 in (wide width)']])}
      </div>
      <div class="fields">${F('price', 'Your fabric price', v, '₹/m')}</div>`,
    compute(v) {
      const rod = n(v.width) + 2 * n(v.overhang);
      const usable = Math.max(1, Number(v.fabricW) - 4);
      const panels = Math.max(1, Math.ceil((rod * Number(v.fullness)) / usable));
      const cut = n(v.drop) + n(v.allowance);
      const metres = Math.ceil((panels * n(v.windows) * cut * 0.0254) * 10) / 10;
      const cost = metres * n(v.price);
      return {
        title: 'Curtain estimate', bigLabel: 'Fabric needed', big: `${num(metres, 1)} m`,
        rows: [
          ['Rod length', `${num(rod, 0)} in (${num(rod * 2.54, 0)} cm)`],
          ['Panels per window', String(panels)],
          ['Cut length per panel', `${num(cut, 0)} in`],
          ['Approx. cost', inr(cost)],
        ],
        text: `Curtain estimate\nWindow ${n(v.width)} × ${n(v.drop)} in, ${n(v.windows)} window(s)\nRod: ${num(rod, 0)} in, ${panels} panels per window at ${v.fullness}× fullness\nFabric: ${num(metres, 1)} m of ${v.fabricW} in roll, about ${inr(cost)}`,
      };
    },
    note: 'Patterned fabric needs extra for matching the repeat; add one repeat length per panel. Hem + heading of 16 in suits most stitched pleats; eyelet tops need a little less.',
  });
}

// ------------------------------------------------------------- carpet vs built-up
export function carpet(el) {
  estimator(el, {
    key: 'carpet',
    defaults: { carpetA: 650, quoted: 1000, rate: 0 },
    form: v => `
      <div class="fields">${F('carpetA', 'Carpet area (RERA or measured)', v, 'sq ft')}${F('quoted', 'Area the builder or broker quotes', v, 'sq ft')}</div>
      ${areaChips('carpetA')}
      <div class="fields">${F('rate', 'Quoted rate (optional)', v, '₹/sq ft')}</div>`,
    compute(v) {
      const c = n(v.carpetA), q = n(v.quoted);
      const loading = c ? (q - c) / c * 100 : 0;
      const share = q ? c / q * 100 : 0;
      const total = q * n(v.rate);
      const eff = c && n(v.rate) ? total / c : 0;
      const rows = [
        ['Usable share of quoted area', `${num(share, 1)}%`],
        ['Extra area you pay for', `${num(Math.max(0, q - c), 0)} sq ft`],
      ];
      if (n(v.rate)) rows.push(['Total at quoted rate', inr(total)], ['Real price per carpet sq ft', inr(eff)]);
      return {
        title: 'Carpet vs quoted area', bigLabel: 'Loading', big: `${num(loading, 1)}%`, rows,
        text: `Carpet vs quoted area\nCarpet: ${num(c, 0)} sq ft, quoted: ${num(q, 0)} sq ft\nLoading: ${num(loading, 1)}%, usable share ${num(share, 1)}%` + (n(v.rate) ? `\nAt ₹${num(n(v.rate), 0)}/sq ft quoted, you pay ${inr(eff)} per carpet sq ft` : ''),
      };
    },
    note: 'Under RERA, flats must be sold on carpet area, which includes internal partition walls. A floor you measure with the camera leaves those walls out, so it will come out a little smaller than the RERA figure. Ask for the RERA carpet area in writing and check it on MahaRERA.',
  });
}
