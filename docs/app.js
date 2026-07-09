// Kimsufi Checker — static browser app.
// Talks directly to the public OVH API (CORS is allowed: access-control-allow-origin: *).

const AVAIL_URL = 'https://eu.api.ovh.com/v1/dedicated/server/datacenter/availabilities';
const catalogUrl = (country) =>
  `https://eu.api.ovh.com/v1/order/catalog/public/eco?ovhSubsidiary=${country}`;

// Datacenter -> { label, continent }. Unknown codes fall back to "Other".
const DC_INFO = {
  gra: { label: 'Gravelines, FR', continent: 'Europe' },
  rbx: { label: 'Roubaix, FR', continent: 'Europe' },
  sbg: { label: 'Strasbourg, FR', continent: 'Europe' },
  'eu-west-par-a': { label: 'Paris A, FR', continent: 'Europe' },
  'eu-west-par-b': { label: 'Paris B, FR', continent: 'Europe' },
  'eu-west-par-c': { label: 'Paris C, FR', continent: 'Europe' },
  fra: { label: 'Frankfurt, DE', continent: 'Europe' },
  lon: { label: 'London, UK', continent: 'Europe' },
  waw: { label: 'Warsaw, PL', continent: 'Europe' },
  bhs: { label: 'Beauharnois, CA', continent: 'North America' },
  'ca-east-tor-a': { label: 'Toronto, CA', continent: 'North America' },
  sgp: { label: 'Singapore', continent: 'Asia-Pacific' },
  syd: { label: 'Sydney, AU', continent: 'Asia-Pacific' },
  ynm: { label: 'Mumbai, IN', continent: 'Asia-Pacific' },
};
const CONTINENT_ORDER = ['Europe', 'North America', 'Asia-Pacific', 'Other'];
const ECO_PATH = { FR: 'fr', ES: 'es', IE: 'en', DE: 'de', IT: 'it', PL: 'pl', GB: 'en' };

const $ = (id) => document.getElementById(id);

const state = {
  country: 'FR',
  currency: 'EUR',
  models: [], // [{name, price, cpu, ram, disk, zonesNow:Set}]
  nameByPlan: {}, // planCode -> model name (built from catalog)
  planCodesSorted: [], // known plan codes, longest first (prefix fallback)
  priceByName: {},
  cpuByName: {},
  selectedModels: new Set(),
  selectedZones: new Set(),
  presentZones: [], // datacenter codes seen in the data
  seen: new Set(), // "planCode|dc" already alerted (rising-edge)
  timer: null,
  requests: 0,
  running: false,
};

// ---- persistence ------------------------------------------------------------
function saveState() {
  localStorage.setItem(
    'kimsufi-checker',
    JSON.stringify({
      country: $('country').value,
      interval: $('interval').value,
      sound: $('sound').checked,
      notify: $('notify').checked,
      models: [...state.selectedModels],
      zones: [...state.selectedZones],
    }),
  );
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem('kimsufi-checker') || '{}');
    if (s.country) $('country').value = s.country;
    if (s.interval) $('interval').value = s.interval;
    if (typeof s.sound === 'boolean') $('sound').checked = s.sound;
    if (typeof s.notify === 'boolean') $('notify').checked = s.notify;
    if (Array.isArray(s.models)) state.selectedModels = new Set(s.models);
    if (Array.isArray(s.zones)) state.selectedZones = new Set(s.zones);
  } catch { /* ignore */ }
}

// ---- helpers ----------------------------------------------------------------
function humanRam(m) {
  const mo = /ram-(\d+)g/.exec(m || '');
  return mo ? `${mo[1]} GB ECC` : (m || '?');
}
function humanDiskSeg(seg) {
  const mo = /(\d+)x(\d+)(ssd|sa|nvme|hdd)?/.exec(seg);
  if (!mo) return seg;
  const [, n, sizeStr, typ] = mo;
  const size = Number(sizeStr);
  const unit = size < 1000 ? 'GB' : 'TB';
  const disp = size < 1000 ? size : Math.round(size / 1000);
  const typeMap = { ssd: 'SSD', sa: 'HDD', nvme: 'NVMe', hdd: 'HDD' };
  return `${n}×${disp} ${unit} ${typeMap[typ] || ''}`.trim();
}
function humanDisk(s) {
  s = s || '';
  let m = /^(?:no|soft|hard)raid-(.+)$/.exec(s);
  if (m) return humanDiskSeg(m[1]);
  m = /^hybridsoftraid-(.+)$/.exec(s);
  if (m) return m[1].split('-').map(humanDiskSeg).join(' + ');
  return s || '?';
}
function fmtPrice(p) {
  if (p == null) return '?';
  const sym = { EUR: '€', GBP: '£', PLN: 'zł', USD: '$' }[state.currency];
  return sym ? `${p.toFixed(2)} ${sym}` : `${p.toFixed(2)} ${state.currency}`;
}
function dcLabel(dc) {
  return DC_INFO[dc]?.label || dc;
}
function resolveName(planCode) {
  if (state.nameByPlan[planCode]) return state.nameByPlan[planCode];
  for (const k of state.planCodesSorted) {
    if (planCode.startsWith(k)) return state.nameByPlan[k];
  }
  return null;
}
const orderUrl = (name) =>
  `https://eco.ovhcloud.com/${ECO_PATH[state.country] || 'en'}/kimsufi/${name.toLowerCase()}/`;

// ---- data loading -----------------------------------------------------------
async function loadData() {
  const country = $('country').value;
  state.country = country;
  $('models').textContent = 'Loading…';

  const [cat, avail] = await Promise.all([
    fetch(catalogUrl(country), { headers: { Accept: 'application/json' } }).then((r) => r.json()),
    fetch(AVAIL_URL, { headers: { Accept: 'application/json' } }).then((r) => r.json()),
  ]);

  state.currency = cat.locale?.currencyCode || 'EUR';

  // catalog: planCode -> {name, price, cpu} for kimsufi KS-* plans
  const products = Object.fromEntries((cat.products || []).map((p) => [p.name, p]));
  state.nameByPlan = {};
  state.priceByName = {};
  state.cpuByName = {};
  for (const plan of cat.plans || []) {
    const srv = products[plan.product]?.blobs?.technical?.server;
    if (!srv || srv.range !== 'kimsufi') continue;
    const name = plan.invoiceName.split('|')[0].trim();
    if (!name.startsWith('KS-')) continue;
    const pricing = (plan.pricings || []).find((x) => x.interval === 1 && x.phase === 1);
    const price = pricing ? pricing.price / 1e8 : null;
    state.nameByPlan[plan.planCode] = name;
    state.cpuByName[name] = srv.cpu || {};
    if (price != null && (state.priceByName[name] == null || price < state.priceByName[name])) {
      state.priceByName[name] = price;
    }
  }
  state.planCodesSorted = Object.keys(state.nameByPlan).sort((a, b) => b.length - a.length);

  buildModels(avail);
  renderModels();
  renderZones();
}

function buildModels(avail) {
  const byName = {};
  const zones = new Set();
  for (const item of avail) {
    const name = resolveName(item.planCode);
    if (!name) continue;
    const m =
      byName[name] ||
      (byName[name] = {
        name,
        price: state.priceByName[name] ?? null,
        cpu: state.cpuByName[name] || {},
        ram: item.memory,
        disk: item.storage,
        zonesNow: new Set(),
      });
    for (const dc of item.datacenters) {
      zones.add(dc.datacenter);
      if (dc.availability !== 'unavailable') m.zonesNow.add(dc.datacenter);
    }
  }
  state.models = Object.values(byName).sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  );
  state.presentZones = [...zones];
}

// ---- rendering --------------------------------------------------------------
function renderModels() {
  const el = $('models');
  el.innerHTML = '';
  for (const m of state.models) {
    const row = document.createElement('label');
    row.className = 'model-row';
    const inNow = m.zonesNow.size > 0;
    const availText = inNow
      ? `<span class="badge in">in stock</span> ${[...m.zonesNow].map(dcLabel).join(', ')}
         <a class="order-inline" href="${orderUrl(m.name)}" target="_blank" rel="noopener">Order →</a>`
      : '<span class="badge out">out of stock</span>';
    row.innerHTML = `
      <input type="checkbox" value="${m.name}" ${state.selectedModels.has(m.name) ? 'checked' : ''}>
      <div>
        <div class="m-name">${m.name}</div>
        <div class="m-specs">${m.cpu.model || '?'} · ${m.cpu.cores ?? '?'}c/${m.cpu.threads ?? '?'}t · ${humanRam(m.ram)} · ${humanDisk(m.disk)}</div>
      </div>
      <div class="m-price">${fmtPrice(m.price)}<span style="color:var(--muted);font-weight:400">/mo</span></div>
      <div class="m-avail">${availText}</div>`;
    row.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) state.selectedModels.add(m.name);
      else state.selectedModels.delete(m.name);
      saveState();
    });
    // clicking the inline order link must not toggle the row checkbox
    row.querySelector('.order-inline')?.addEventListener('click', (e) => e.stopPropagation());
    el.appendChild(row);
  }
}

function renderZones() {
  const el = $('zones');
  el.innerHTML = '';
  const groups = {};
  for (const dc of state.presentZones) {
    const cont = DC_INFO[dc]?.continent || 'Other';
    (groups[cont] ||= []).push(dc);
  }
  for (const cont of CONTINENT_ORDER) {
    const list = groups[cont];
    if (!list || !list.length) continue;
    list.sort((a, b) => dcLabel(a).localeCompare(dcLabel(b)));

    const wrap = document.createElement('div');
    const allChecked = list.every((dc) => state.selectedZones.has(dc));
    wrap.innerHTML = `
      <div class="continent-head">
        <input type="checkbox" ${allChecked ? 'checked' : ''}>
        <span>${cont}</span>
      </div>
      <div class="zone-list"></div>`;
    const zoneList = wrap.querySelector('.zone-list');
    const contBox = wrap.querySelector('.continent-head input');
    contBox.addEventListener('change', (e) => {
      list.forEach((dc) => (e.target.checked ? state.selectedZones.add(dc) : state.selectedZones.delete(dc)));
      renderZones();
      saveState();
    });
    for (const dc of list) {
      const chip = document.createElement('label');
      chip.className = 'zone-chip';
      chip.innerHTML = `<input type="checkbox" value="${dc}" ${state.selectedZones.has(dc) ? 'checked' : ''}> ${dcLabel(dc)}`;
      chip.querySelector('input').addEventListener('change', (e) => {
        if (e.target.checked) state.selectedZones.add(dc);
        else state.selectedZones.delete(dc);
        contBox.checked = list.every((z) => state.selectedZones.has(z));
        saveState();
      });
      zoneList.appendChild(chip);
    }
    el.appendChild(wrap);
  }
}

function renderResults(hits) {
  const sec = $('results');
  const list = $('results-list');
  sec.hidden = false;
  if (!hits.length) {
    list.innerHTML = '<p class="empty">Nothing available yet in your selection…</p>';
    return;
  }
  hits.sort((a, b) => (state.priceByName[a.name] ?? 0) - (state.priceByName[b.name] ?? 0));
  list.innerHTML = hits
    .map(
      (h) => `
      <div class="hit">
        <span class="model">${h.name}</span>
        <span class="meta">${h.server}</span>
        <span class="where">→ ${dcLabel(h.dc)}</span>
        <span class="meta">${fmtPrice(state.priceByName[h.name])}/mo · ${h.availability}</span>
        <a class="order" href="${orderUrl(h.name)}" target="_blank" rel="noopener">Order</a>
      </div>`,
    )
    .join('');
}

// ---- alerts -----------------------------------------------------------------
let audioCtx;
function beep() {
  if (!$('sound').checked) return;
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < 2; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.frequency.value = 880;
      const t = audioCtx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t);
      o.stop(t + 0.2);
    }
  } catch { /* ignore */ }
}
function notify(hit) {
  if (!$('notify').checked || Notification.permission !== 'granted') return;
  const n = new Notification(`${hit.name} available!`, {
    body: `${dcLabel(hit.dc)} · ${fmtPrice(state.priceByName[hit.name])}/mo`,
    tag: `${hit.planCode}|${hit.dc}`,
  });
  n.onclick = () => window.open(orderUrl(hit.name), '_blank');
}

// ---- polling ----------------------------------------------------------------
async function poll() {
  state.requests++;
  let avail;
  try {
    avail = await fetch(AVAIL_URL, { headers: { Accept: 'application/json' } }).then((r) => r.json());
  } catch (err) {
    updateStatus(`request failed (${err.message})`);
    return;
  }

  const currentKeys = new Set();
  const hits = [];
  const newHits = [];
  for (const item of avail) {
    const name = resolveName(item.planCode);
    if (!name || !state.selectedModels.has(name)) continue;
    for (const dc of item.datacenters) {
      if (dc.availability === 'unavailable') continue;
      if (!state.selectedZones.has(dc.datacenter)) continue;
      const key = `${item.planCode}|${dc.datacenter}`;
      if (currentKeys.has(key)) continue;
      currentKeys.add(key);
      const hit = { name, server: item.server, planCode: item.planCode, dc: dc.datacenter, availability: dc.availability };
      hits.push(hit);
      if (!state.seen.has(key)) newHits.push(hit);
    }
  }
  state.seen = currentKeys;

  renderResults(hits);
  if (newHits.length) {
    beep();
    newHits.forEach(notify);
  }
  updateStatus();
}

function updateStatus(error) {
  const el = $('status');
  el.hidden = false;
  const time = new Date().toLocaleTimeString();
  if (error) {
    el.innerHTML = `<span>⚠️ ${error} — retrying…</span>`;
    return;
  }
  el.innerHTML = `
    <span><span class="dot"></span>Watching <strong>${state.selectedModels.size}</strong> model(s) in <strong>${state.selectedZones.size}</strong> zone(s)</span>
    <span>Checks: <strong>${state.requests}</strong></span>
    <span>Last check: <strong>${time}</strong></span>`;
}

// ---- start / stop -----------------------------------------------------------
async function start() {
  if (!state.selectedModels.size) { alert('Select at least one server model.'); return; }
  if (!state.selectedZones.size) { alert('Select at least one datacenter.'); return; }

  if ($('notify').checked && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }

  state.running = true;
  state.requests = 0;
  state.seen = new Set();
  $('start').disabled = true;
  $('stop').disabled = false;
  $('country').disabled = true;
  saveState();

  await poll();
  const interval = Number($('interval').value) * 1000;
  state.timer = setInterval(poll, interval);
}

function stop() {
  state.running = false;
  clearInterval(state.timer);
  state.timer = null;
  $('start').disabled = false;
  $('stop').disabled = true;
  $('country').disabled = false;
  $('status').innerHTML = '<span>Stopped.</span>';
}

// ---- wire up ----------------------------------------------------------------
loadState();
$('start').addEventListener('click', start);
$('stop').addEventListener('click', stop);
$('country').addEventListener('change', () => { saveState(); loadData(); });
$('interval').addEventListener('change', saveState);
$('sound').addEventListener('change', saveState);
$('notify').addEventListener('change', async () => {
  if ($('notify').checked && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch { /* ignore */ }
  }
  saveState();
});
$('models-all').addEventListener('click', () => {
  state.models.forEach((m) => state.selectedModels.add(m.name));
  renderModels(); saveState();
});
$('models-none').addEventListener('click', () => {
  state.selectedModels.clear(); renderModels(); saveState();
});
$('zones-all').addEventListener('click', () => {
  state.presentZones.forEach((z) => state.selectedZones.add(z));
  renderZones(); saveState();
});
$('zones-none').addEventListener('click', () => {
  state.selectedZones.clear(); renderZones(); saveState();
});

loadData().catch((err) => {
  $('models').innerHTML = `<p class="empty">Failed to load data: ${err.message}</p>`;
});
