# Checks Kimsufi servers availability

Kimsufi (by OVHcloud) offers cheap dedicated servers starting at **€9.99/month**.
They sell out fast, so this tool polls the OVH availability API and alerts you
(terminal bell + optional Telegram) the moment a server you want is back in stock.

## Kimsufi servers & prices

Snapshot of the current Kimsufi line-up, sorted by price (EUR/month, France
subsidiary; taken from the OVH public catalog on 2026-07-09). Prices and specs
change over time — the script always checks live availability regardless.

| Model | Price/mo | CPU | Cores/Threads | Freq (base/turbo) | RAM | Storage |
|---|---|---|---|---|---|---|
| **KS-B** | €9.99 | Xeon E5-1620v2 | 4c/8t | 3.7/3.9 GHz | 32 GB ECC | 1×120 GB SSD |
| **KS-C** | €11.99 | Xeon E5-1650v2 | 6c/12t | 3.5/3.9 GHz | 32 GB ECC | 1×120 GB SSD |
| **KS-1** | €16.99 | Xeon-D 1520 | 4c/8t | 2.2/2.6 GHz | 32 GB ECC | 2×2 TB HDD |
| **KS-4** | €16.99 | Xeon-E3 1230v6 | 4c/8t | 3.5/3.9 GHz | 16 GB ECC | 2×2 TB HDD |
| **KS-5** | €17.99 | Xeon-E3 1270v6 | 4c/8t | 3.8/4.2 GHz | 32 GB ECC | 2×2 TB HDD |
| **KS-2** | €18.99 | Xeon-D 1540 | 8c/16t | 2.0/2.6 GHz | 32 GB ECC | 2×2 TB HDD |
| **KS-3** | €18.99 | Xeon-E3 1245v5 | 4c/8t | 3.5/3.9 GHz | 32 GB ECC | 2×2 TB HDD |
| **KS-1-B** | €19.99 | Xeon D-2123IT | 4c/8t | 2.2/3.0 GHz | 32 GB ECC | 2×4 TB HDD |
| **KS-5-B** | €21.99 | Xeon E5-1650v4 | 6c/12t | 3.6/4.0 GHz | 128 GB ECC | 2×2 TB HDD |
| **KS-STOR** | €23.99 | Xeon-D 1521 | 4c/8t | 2.4/2.7 GHz | 16 GB ECC | 4×4 TB HDD + 1×500 GB NVMe |
| **KS-5-A** | €26.99 | Xeon E-2274G | 4c/8t | 4.0/4.9 GHz | 32 GB ECC | 2×2 TB NVMe |
| **KS-GAME** | €28.99 | Core i7-7700K | 4c/8t | 4.2/4.5 GHz | 32 GB ECC | 2×450 GB NVMe + 1×4 TB HDD |
| **KS-6** | €38.99 | EPYC 7351P | 16c/32t | 2.4/2.9 GHz | 128 GB ECC | 2×1 TB NVMe |
| **KS-6-B** | €54.99 | Xeon E5-2680v3 | 12c/24t | 2.5/3.3 GHz | 256 GB ECC | 2×480 GB SSD |
| **KS-A** | €54.99 | Core i7-6700K | 4c/8t | 4.0/4.2 GHz | 32 GB ECC | 1×480 GB SSD |
| **KS-7** | €61.99 | EPYC 7451 | 24c/48t | 2.3/3.2 GHz | 128 GB ECC | 2×4 TB HDD |

## Install

```npm install```

Requires Node.js 18 or newer (uses the built-in `fetch`).

## Usage
```node check.js <seconds> <serverId...> [--zones=fra,rbx] [--open]```

Watch several servers, only in the given datacenters, every 60 seconds:

```node check.js 60 25skb01 25skc01 --zones=fra,rbx,gra```

- `<serverId>` — one or more servers. Matches either the `server` model
  (e.g. `24sk10`) or the `planCode` (e.g. `24sk102`) returned by the OVH
  availability API
  (`https://eu.api.ovh.com/v1/dedicated/server/datacenter/availabilities`).
- `--zones=...` — comma-separated datacenters to watch (e.g. `fra,rbx,gra,sbg,bhs`).
  If omitted, all datacenters are watched.
- `--open` — also open the order page in the browser on a new hit.

The script keeps running and, each time a watched server becomes available
in a watched zone, it rings the terminal bell, prints the hit, and (if
configured) sends a Telegram alert. It only alerts once per availability;
if the server goes out of stock and comes back, it alerts again.

### Telegram alerts (optional)

Set these environment variables to receive alerts on Telegram:

```
export TELEGRAM_BOT_TOKEN=123456:AA...   # from @BotFather
export TELEGRAM_CHAT_ID=987654321        # your chat id (ask @userinfobot)
```

Then run as usual. If they are not set, the script still works and just
prints to the terminal.

To leave it running in the background and log its output:

```node check.js 60 25skb01 25skc01 --zones=fra,rbx > checker.log 2>&1 &```

Copyright 2019 Hugo Freire

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
