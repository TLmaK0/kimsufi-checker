# Checks Kimsufi servers availability

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
