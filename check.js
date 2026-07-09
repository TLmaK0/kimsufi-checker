import open from 'open';

const API_URL = 'https://eu.api.ovh.com/v1/dedicated/server/datacenter/availabilities';

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

if (!time || servers.length === 0) {
  console.error('Usage: node check.js <seconds> <serverId...> [--zones=fra,rbx] [--open]');
  console.info('\nExample:');
  console.info('  node check.js 60 25skb01 25skc01 --zones=fra,rbx,gra');
  console.info('\n  <serverId>   server model (24sk10) or planCode (24sk102). Several allowed.');
  console.info('  --zones=...  comma-separated datacenters to watch (e.g. fra,rbx,gra,bhs,sbg).');
  console.info('               If omitted, all datacenters are watched.');
  console.info('  --open       open the order page in the browser on a new hit.');
  console.info('\nTelegram alerts (optional): set these environment variables:');
  console.info('  TELEGRAM_BOT_TOKEN   token from @BotFather');
  console.info('  TELEGRAM_CHAT_ID     your chat/channel id (talk to @userinfobot)');
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

// --- main loop ---------------------------------------------------------------
let requests = 0;
let seen = new Set(); // keys "planCode|datacenter" currently available and already alerted

async function call() {
  requests++;
  const zoneLabel = zones ? ` [${zones.join(', ')}]` : '';
  process.stdout.write(`Requests: ${requests}. Checking ${servers.join(', ')}${zoneLabel} ...\r`);

  let body;
  try {
    const res = await fetch(API_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
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
    process.stdout.write('\x07'); // terminal bell
    console.log(`\n[${new Date().toISOString()}] AVAILABLE:`);
    for (const h of newHits) {
      console.log(`  ${h.server} [${h.planCode}] -> ${h.datacenter} (${h.availability})`);
    }

    const lines = newHits
      .map(
        (h) =>
          `• <b>${h.server}</b> (${h.planCode}) → ${h.datacenter} (${h.availability})`,
      )
      .join('\n');
    const orderUrl = `https://www.kimsufi.com/en/order/kimsufi.xml?reference=${newHits[0].planCode}`;
    await sendTelegram(
      `🚨 <b>Kimsufi disponible</b>\n${lines}\n\n<a href="${orderUrl}">Pedir ahora</a>`,
    );

    if (doOpen) {
      await open(orderUrl);
    }
  } else {
    process.stdout.write(`Requests: ${requests}. Nothing available. Waiting ${time}s...\r`);
  }

  setTimeout(call, time * 1000);
}

console.log(
  `Watching ${servers.join(', ')}${zones ? ` in ${zones.join(', ')}` : ' (all zones)'} every ${time}s. ` +
    `Telegram: ${telegramEnabled ? 'ON' : 'OFF'}. Ctrl+C to stop.`,
);
call();
