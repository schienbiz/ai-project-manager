# SOP: ATung Machine Procedures

> 主機識別已抽換為 `~/.ssh/config` 的 `chusMBp` 別名（該檔未進版控）。
> 這個 repo 是公開的，使用者名稱、tailnet 名稱與 Tailscale IP 不放在這裡。

ATung is the development machine. Production services run on chusMBp.
ATung's critical local service is Syncthing (keeps code in sync with chusMBp).

---

## chusMBp Sleep Prevention (CRITICAL)

chusMBp has a caffeinate LaunchAgent (`com.chusmbp.caffeinate`) that prevents sleep.
If it's not installed, run once on chusMBp:
```bash
bash ~/CloudSync/ai-project-manager/scripts/install-on-chusmbp.sh
```

Verify running: `pgrep caffeinate && echo OK`

---

## Watchdog (Tier-0 Auto-Heal)

Runs every 5 minutes. Checks Syncthing + chusMBp reachability.
Uses Syncthing heartbeat file to distinguish machine-offline vs tunnel-only failures.
**No "Restart All Services" button** — it was removed because it called back to chusMBp which is
down when you need it most. SSH manually instead.

- Script: `~/watchdog.sh`
- Log: `/tmp/atung-watchdog.log`
- LaunchAgent: `com.atung.watchdog`
- Heartbeat file: `~/CloudSync/ai-project-manager/data/heartbeat.json` (written by chusMBp every 5 min)

**If watchdog itself is down:**
```bash
launchctl load ~/Library/LaunchAgents/com.atung.watchdog.plist
launchctl start com.atung.watchdog
cat /tmp/atung-watchdog.log
```

---

## 1. Syncthing Down

**Detect:** `curl -s http://localhost:8384/rest/system/ping -H "X-API-Key: $SYNCTHING_KEY"`

**Fix:**
```bash
brew services restart syncthing
# or:
launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing"
```

**Verify:** Open http://localhost:8384 — check folders show "Up to Date".

---

## 2. chusMBp Unreachable

**Diagnosis — check heartbeat first:**
```bash
python3 -c "import json,time; d=json.load(open('$HOME/CloudSync/ai-project-manager/data/heartbeat.json')); print('age:', int(time.time())-d['ts'], 's'); print(d)"
```
- Age < 10 min → machine is alive, tunnels are the issue
- Age > 10 min → machine is offline (slept, crashed, or no power)

**If tunnels are the issue (machine alive):**
```bash
# Check Tailscale status
/Applications/Tailscale.app/Contents/MacOS/Tailscale status

# Restart Tailscale
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale down && sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale up
```

**If machine is offline (wait for it to come back, then SSH):**
```bash
# Via Tailscale (preferred, when online)
ssh chusMBp

# Via bore SSH fallback (port in latest Telegram notification)
ssh -p <PORT> <user>@bore.pub
```

**Restart all services after SSH:**
```bash
ssh chusMBp "for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.marketing-assistant.dev com.relationship-os.dev com.proxy.marketing com.voice-trainer; do launchctl kickstart -k gui/501/\$label; done"
```

**If caffeinate not installed (machine kept sleeping):**
```bash
ssh chusMBp "bash ~/CloudSync/ai-project-manager/scripts/install-on-chusmbp.sh"
```

---

## 3. Restart a Single chusMBp Service Remotely

```bash
# AI PM
ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"

# AI Learning Tool
ssh chusMBp "launchctl kickstart -k gui/501/com.ai-learning-tool.dev"

# Marketing Assistant
ssh chusMBp "launchctl kickstart -k gui/501/com.marketing-assistant.dev"

# Relationship OS
ssh chusMBp "launchctl kickstart -k gui/501/com.relationship-os.dev"
```

---

## 4. Deploy Code to chusMBp After Local Changes

**AI PM (requires build):**
```bash
cd ~/CloudSync/ai-project-manager
npm run build
scp server/index.js chusMBp:$HOME/CloudSync/ai-project-manager/server/index.js
scp -r dist chusMBp:$HOME/CloudSync/ai-project-manager/
ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

**Server-only changes (no build needed):**
```bash
scp server/index.js chusMBp:$HOME/CloudSync/ai-project-manager/server/index.js
ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

**Other services (Syncthing syncs automatically):**
```bash
# Wait for Syncthing sync, then restart service:
ssh chusMBp "launchctl kickstart -k gui/501/<LABEL>"
```

---

## 5. Check All Services (Quick)

```bash
# chusMBp services
ssh chusMBp "for svc in '3000:/health' '3001:/' '3003:/health' '3004:/pm/api/status'; do port=\${svc%%:*}; path=\${svc##*:}; code=\$(curl -s --max-time 3 \"http://localhost:\$port\$path\" -o /dev/null -w '%{http_code}'); echo \"Port \$port: \$code\"; done"

# ATung Syncthing
curl -s http://localhost:8384/rest/system/ping -H "X-API-Key: $SYNCTHING_KEY"

# Watchdog last run
cat /tmp/atung-watchdog.log | tail -5
```

---

## 6. LINE Expense Bot (Not Yet Deployed)

The bot code is at `~/line-expense-bot`. It needs Render + Neon PostgreSQL to run.

**Required .env:**
```
LINE_CHANNEL_SECRET=...
LINE_CHANNEL_ACCESS_TOKEN=...
APP_URL=https://<render-url>.onrender.com
DATABASE_URL=postgresql://...@...neon.tech/dbname?pgbouncer=true&connection_limit=1
ADMIN_LINE_ID=...
MAX_EXPENSE_AMOUNT=999999
```

When ready to deploy: create Neon DB → create Render web service → set env vars → push.

---

## 7. 2560 Trading App (Render)

URL: https://two560-app.onrender.com
Free tier — cold starts ~35s after 15min idle. No action needed unless errors appear.

---

## Reference: chusMBp SSH

```bash
ssh chusMBp   # via Tailscale IP
ssh <chusmbp-user>@chusMBp          # if hostname resolves
```

Logs on chusMBp:
- AI PM: `/tmp/ai-project-manager.log`, `/tmp/ai-project-manager.err`
- AI Learning: `/tmp/ai-learning-tool.log`, `/tmp/ai-learning-tool.err`
- Marketing: `/tmp/marketing-dev.log`, `/tmp/marketing-dev-error.log`
- Watchdog: `/tmp/watchdog.log`
