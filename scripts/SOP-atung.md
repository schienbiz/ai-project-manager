# SOP: ATung Machine Procedures

ATung is the development machine. Production services run on chusMBp.
ATung's critical local service is Syncthing (keeps code in sync with chusMBp).

---

## Watchdog (Tier-0 Auto-Heal)

Runs every 5 minutes. Checks Syncthing + chusMBp reachability. Sends Telegram alert on issues.

- Script: `~/watchdog.sh`
- Log: `/tmp/atung-watchdog.log`
- LaunchAgent: `com.atung.watchdog`

**If watchdog itself is down:**
```bash
launchctl load ~/Library/LaunchAgents/com.atung.watchdog.plist
launchctl start com.atung.watchdog
cat /tmp/atung-watchdog.log
```

---

## 1. Syncthing Down

**Detect:** `curl -s http://localhost:8384/rest/system/ping -H "X-API-Key: JHPURzgxjGsAmbv5mgRACvL2WYxFHPRW"`

**Fix:**
```bash
brew services restart syncthing
# or:
launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing"
```

**Verify:** Open http://localhost:8384 — check folders show "Up to Date".

---

## 2. chusMBp Unreachable (Tailscale)

**Check Tailscale status:**
```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale status
# chusMBp should show as 100.85.224.76 — Online
```

**Fix:**
```bash
# Restart Tailscale
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale down
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale up
```

**If chusMBp itself crashed:** SSH in and restart all services:
```bash
ssh chuchuchien0430@100.85.224.76 "for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.marketing-assistant.dev com.relationship-os.dev com.proxy.marketing; do launchctl kickstart -k gui/501/\$label; done"
```

---

## 3. Restart a Single chusMBp Service Remotely

```bash
# AI PM
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.ai-project-manager.dev"

# AI Learning Tool
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.ai-learning-tool.dev"

# Marketing Assistant
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.marketing-assistant.dev"

# Relationship OS
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.relationship-os.dev"
```

---

## 4. Deploy Code to chusMBp After Local Changes

**AI PM (requires build):**
```bash
cd ~/CloudSync/ai-project-manager
npm run build
scp server/index.js chuchuchien0430@100.85.224.76:/Users/chuchuchien0430/CloudSync/ai-project-manager/server/index.js
scp -r dist chuchuchien0430@100.85.224.76:/Users/chuchuchien0430/CloudSync/ai-project-manager/
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

**Server-only changes (no build needed):**
```bash
scp server/index.js chuchuchien0430@100.85.224.76:/Users/chuchuchien0430/CloudSync/ai-project-manager/server/index.js
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

**Other services (Syncthing syncs automatically):**
```bash
# Wait for Syncthing sync, then restart service:
ssh chuchuchien0430@100.85.224.76 "launchctl kickstart -k gui/501/<LABEL>"
```

---

## 5. Check All Services (Quick)

```bash
# chusMBp services
ssh chuchuchien0430@100.85.224.76 "for svc in '3000:/health' '3001:/' '3003:/health' '3004:/pm/api/status'; do port=\${svc%%:*}; path=\${svc##*:}; code=\$(curl -s --max-time 3 \"http://localhost:\$port\$path\" -o /dev/null -w '%{http_code}'); echo \"Port \$port: \$code\"; done"

# ATung Syncthing
curl -s http://localhost:8384/rest/system/ping -H "X-API-Key: JHPURzgxjGsAmbv5mgRACvL2WYxFHPRW"

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
ssh chuchuchien0430@100.85.224.76   # via Tailscale IP
ssh chuchuchien0430@chusMBp          # if hostname resolves
```

Logs on chusMBp:
- AI PM: `/tmp/ai-project-manager.log`, `/tmp/ai-project-manager.err`
- AI Learning: `/tmp/ai-learning-tool.log`, `/tmp/ai-learning-tool.err`
- Marketing: `/tmp/marketing-dev.log`, `/tmp/marketing-dev-error.log`
- Watchdog: `/tmp/watchdog.log`
