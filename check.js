import open from 'open';
// Parsing/formatting logic is shared with the web app; it lives under docs/ so
// the browser (GitHub Pages serves only that folder) can import it too.
import {
  AVAIL_URL,
  catalogUrl,
  fetchJson,
  humanRam,
  humanDisk,
  buildCatalogInfo,
  resolveName,
} from './docs/kimsufi-core.js';

const modelNames = {}; // server code / planCode -> commercial model name (e.g. "KS-5")

// --- parse arguments ---------------------------------------------------------
// Usage: node check.js <seconds> <serverId...> [--zones=fra,rbx] [--open]
const raw = process.argv.slice(2);
const flags = {};
const positional = [];
for (const a of raw) {
  if (a.startsWith('--')) {
    const [k, v] = a.slice(2).split('=');
    flags[k] = v === undefined ? true : v;
  } else {
    positional.push(a);
  }
}

const time = Number(positional[0]); // seconds between checks
const servers = positional.slice(1);
const zones = flags.zones
  ? String(flags.zones).split(',').map((z) => z.trim().toLowerCase()).filter(Boolean)
  : null; // null = all datacenters
const doOpen = Boolean(flags.open);

function printUsage() {
  console.info('\nUsage: node check.js <seconds> <serverId...> [--zones=fra,rbx] [--open]');
  console.info('       node check.js --list        (just print the server list and exit)');
  console.info('\nExample:');
  console.info('  node check.js 60 25skb01 25skc01 --zones=fra,rbx,gra');
  console.info('\n  <serverId>   server code (24sk10) or planCode (24sk102). Several allowed.');
  console.info('  --zones=...  comma-separated datacenters to watch (e.g. fra,rbx,gra,bhs,sbg).');
  console.info('               If omitted, all datacenters are watched.');
  console.info('  --open       open the order page in the browser on a new hit.');
  console.info('\nTelegram alerts (optional): set these environment variables:');
  console.info('  TELEGRAM_BOT_TOKEN   token from @BotFather');
  console.info('  TELEGRAM_CHAT_ID     your chat/channel id (talk to @userinfobot)');
}

if (flags.list) {
  await listServers();
  process.exit(0);
}

if (!time || servers.length === 0) {
  await listServers();
  printUsage();
  process.exit(1);
}

// --- telegram ----------------------------------------------------------------
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
const telegramEnabled = Boolean(TG_TOKEN && TG_CHAT);

if (!telegramEnabled) {
  console.warn(
    'WARNING: Telegram alerts disabled (set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to enable).',
  );
}

async function sendTelegram(text) {
  if (!telegramEnabled) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TG_CHAT,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`\nTelegram send failed: HTTP ${res.status} ${body}`);
    }
  } catch (err) {
    console.error(`\nTelegram send failed: ${err.message}`);
  }
}

// --- server list -------------------------------------------------------------
async function listServers() {
  let cat;
  let avail;
  try {
    [cat, avail] = await Promise.all([fetchJson(catalogUrl('FR')), fetchJson(AVAIL_URL)]);
  } catch (err) {
    console.error(`Could not load server list: ${err.message}`);
    return;
  }

  const info = buildCatalogInfo(cat);

  const byServer = {}; // server code -> aggregated row
  for (const x of avail) {
    const name = resolveName(info, x.planCode);
    if (!name) continue;
    const e =
      byServer[x.server] ||
      (byServer[x.server] = {
        code: x.server,
        name,
        price: info.priceByName[name] ?? null,
        cpu: info.cpuByName[name] || {},
        ram: x.memory,
        disk: x.storage,
        zones: new Set(),
      });
    for (const dc of x.datacenters) {
      if (dc.availability !== 'unavailable') e.zones.add(dc.datacenter);
    }
  }

  const byName = {}; // collapse regional duplicates, keep cheapest code, union zones
  for (const e of Object.values(byServer)) {
    const existing = byName[e.name];
    if (existing) {
      for (const z of e.zones) existing.zones.add(z);
      // prefer the base code without a regional suffix (e.g. 24skgame01 over 24skgame01-apac)
      const cleaner = (a, b) =>
        (a.split('-').length - b.split('-').length) || (a.length - b.length);
      if (cleaner(e.code, existing.code) < 0) existing.code = e.code;
      continue;
    }
    byName[e.name] = e;
  }

  // remember model names so alerts can show them (e.g. "KS-5" next to 24sk50)
  for (const [planCode, name] of Object.entries(info.nameByPlan)) modelNames[planCode] = name;
  for (const [code, e] of Object.entries(byServer)) modelNames[code] = e.name;

  const rows = Object.values(byName).sort(
    (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  );

  const pad = (s, n) => String(s).padEnd(n);
  console.log('\nKimsufi servers (live prices & availability):\n');
  console.log(
    pad('CODE', 13) + pad('MODEL', 9) + pad('€/mo', 9) + pad('CPU', 18) +
      pad('CORES', 9) + pad('RAM', 11) + pad('DISK', 27) + 'AVAILABLE NOW',
  );
  for (const e of rows) {
    const price = e.price != null ? `€${e.price.toFixed(2)}` : '?';
    const cores = `${e.cpu.cores ?? '?'}c/${e.cpu.threads ?? '?'}t`;
    const zones = e.zones.size ? [...e.zones].sort().join(', ') : '—';
    console.log(
      pad(e.code, 13) + pad(e.name, 9) + pad(price, 9) + pad(e.cpu.model || '?', 18) +
        pad(cores, 9) + pad(humanRam(e.ram), 11) + pad(humanDisk(e.disk), 27) + zones,
    );
  }
  console.log('');
}

// --- main loop ---------------------------------------------------------------
let requests = 0;
let seen = new Set(); // keys "planCode|datacenter" currently available and already alerted

async function call() {
  requests++;
  const zoneLabel = zones ? ` [${zones.join(', ')}]` : '';
  process.stdout.write(`Requests: ${requests}. Checking ${servers.join(', ')}${zoneLabel} ...\r`);

  let body;
  try {
    body = await fetchJson(AVAIL_URL);
  } catch (err) {
    console.error(`\nRequest failed: ${err.message}. Retrying in ${time}s...`);
    setTimeout(call, time * 1000);
    return;
  }

  const matches = body.filter(
    (item) => servers.includes(item.server) || servers.includes(item.planCode),
  );

  const currentKeys = new Set();
  const newHits = [];

  for (const item of matches) {
    for (const dc of item.datacenters) {
      if (dc.availability === 'unavailable') continue;
      if (zones && !zones.includes(dc.datacenter.toLowerCase())) continue;
      const key = `${item.planCode}|${dc.datacenter}`;
      if (currentKeys.has(key)) continue; // API lists the same planCode/dc more than once
      currentKeys.add(key);
      if (!seen.has(key)) {
        newHits.push({
          server: item.server,
          planCode: item.planCode,
          datacenter: dc.datacenter,
          availability: dc.availability,
        });
      }
    }
  }

  seen = currentKeys; // drop entries no longer available so they re-alert next time

  if (newHits.length > 0) {
    const modelOf = (h) => modelNames[h.server] || modelNames[h.planCode] || h.server;
    const orderUrl = (h) => `https://eco.ovhcloud.com/en/kimsufi/${modelOf(h).toLowerCase()}/`;
    process.stdout.write('\x07'); // terminal bell
    console.log(`\n[${new Date().toISOString()}] AVAILABLE:`);
    for (const h of newHits) {
      console.log(`  ${modelOf(h)} (${h.server}) [${h.planCode}] -> ${h.datacenter} (${h.availability})`);
    }

    const lines = newHits
      .map(
        (h) =>
          `• <b>${modelOf(h)}</b> (${h.server}) → ${h.datacenter} (${h.availability}) — <a href="${orderUrl(h)}">order</a>`,
      )
      .join('\n');
    await sendTelegram(`🚨 <b>Kimsufi available</b>\n${lines}`);

    if (doOpen) {
      await open(orderUrl(newHits[0]));
    }
  } else {
    process.stdout.write(`Requests: ${requests}. Nothing available. Waiting ${time}s...\r`);
  }

  setTimeout(call, time * 1000);
}

await listServers();
console.log(
  `Watching ${servers.join(', ')}${zones ? ` in ${zones.join(', ')}` : ' (all zones)'} every ${time}s. ` +
    `Telegram: ${telegramEnabled ? 'ON' : 'OFF'}. Ctrl+C to stop.`,
);
call();
