// Shared logic used by BOTH the CLI (../check.js) and the web app (app.js).
// Pure functions + fetch helpers only — no DOM, no Node-specific APIs — so it
// runs unchanged in the browser and in Node 18+ (both provide global fetch).
// It lives under docs/ because GitHub Pages only serves this folder, so the
// browser cannot import anything from outside it; the CLI imports it by path.

export const AVAIL_URL =
  'https://eu.api.ovh.com/v1/dedicated/server/datacenter/availabilities';
export const catalogUrl = (country = 'FR') =>
  `https://eu.api.ovh.com/v1/order/catalog/public/eco?ovhSubsidiary=${country}`;

export async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ---- human-readable specs ---------------------------------------------------
export function humanRam(m) {
  const mo = /ram-(\d+)g/.exec(m || '');
  return mo ? `${mo[1]} GB ECC` : (m || '?');
}

export function humanDiskSeg(seg) {
  const mo = /(\d+)x(\d+)(ssd|sa|nvme|hdd)?/.exec(seg);
  if (!mo) return seg;
  const [, n, sizeStr, typ] = mo;
  const size = Number(sizeStr);
  const unit = size < 1000 ? 'GB' : 'TB';
  const disp = size < 1000 ? size : Math.round(size / 1000);
  const typeMap = { ssd: 'SSD', sa: 'HDD', nvme: 'NVMe', hdd: 'HDD' };
  return `${n}×${disp} ${unit} ${typeMap[typ] || ''}`.trim();
}

export function humanDisk(s) {
  s = s || '';
  let m = /^(?:no|soft|hard)raid-(.+)$/.exec(s);
  if (m) return humanDiskSeg(m[1]);
  m = /^hybridsoftraid-(.+)$/.exec(s);
  if (m) return m[1].split('-').map(humanDiskSeg).join(' + ');
  return s || '?';
}

// ---- catalog parsing --------------------------------------------------------
// Turn an OVH eco catalog response into lookups for the Kimsufi (KS-*) range.
export function buildCatalogInfo(cat) {
  const products = Object.fromEntries((cat.products || []).map((p) => [p.name, p]));
  const nameByPlan = {}; // planCode -> "KS-5"
  const priceByName = {}; // "KS-5" -> monthly price (cheapest variant)
  const cpuByName = {}; // "KS-5" -> cpu blob
  for (const plan of cat.plans || []) {
    const srv = products[plan.product]?.blobs?.technical?.server;
    if (!srv || srv.range !== 'kimsufi') continue;
    const name = plan.invoiceName.split('|')[0].trim();
    if (!name.startsWith('KS-')) continue; // skip non-Kimsufi mis-tagged by OVH
    const pricing = (plan.pricings || []).find((x) => x.interval === 1 && x.phase === 1);
    const price = pricing ? pricing.price / 1e8 : null;
    nameByPlan[plan.planCode] = name;
    cpuByName[name] = srv.cpu || {};
    if (price != null && (priceByName[name] == null || price < priceByName[name])) {
      priceByName[name] = price;
    }
  }
  const planCodesSorted = Object.keys(nameByPlan).sort((a, b) => b.length - a.length);
  return { currency: cat.locale?.currencyCode || 'EUR', nameByPlan, priceByName, cpuByName, planCodesSorted };
}

// Resolve a planCode (incl. regional variants like 24sk402-sgp) to a model name.
export function resolveName(info, planCode) {
  if (info.nameByPlan[planCode]) return info.nameByPlan[planCode];
  for (const k of info.planCodesSorted) {
    if (planCode.startsWith(k)) return info.nameByPlan[k];
  }
  return null;
}
