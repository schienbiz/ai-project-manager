# SOP: Auto-Healing Procedures for chusMBp Services

Services: ROS (3000), Marketing (3001), Proxy (3002), AI Learning (3003), AI PM (3004)

---

## Watchdog (Tier-0 Auto-Heal)

A watchdog script runs every 5 minutes via LaunchAgent. It checks all 5 services and
auto-restarts any that are unresponsive, then sends a Telegram alert.

- Script: `~/watchdog.sh`
- Log: `/tmp/watchdog.log`
- LaunchAgent: `com.chusmbp.watchdog`

**If watchdog itself is down:**
```bash
launchctl load ~/Library/LaunchAgents/com.chusmbp.watchdog.plist
launchctl start com.chusmbp.watchdog
cat /tmp/watchdog.log  # check last run
```

---

## Service Labels & Ports

| Service | LABEL | PORT | Health URL |
|---------|-------|------|------------|
| Relationship OS | com.relationship-os.dev | 3000 | /health |
| Marketing Assistant | com.marketing-assistant.dev | 3001 | / |
| Proxy | com.proxy.marketing | 3002 | / |
| AI Learning Tool | com.ai-learning-tool.dev | 3003 | /health |
| AI PM | com.ai-project-manager.dev | 3004 | /pm/api/status |
| Watchdog | com.chusmbp.watchdog | — | /tmp/watchdog.log |

---

## 1. Service Crashed / Unresponsive

**Auto-heal:** Watchdog restarts it within 5 min + sends Telegram alert. KeepAlive:true also restarts on crash instantly.

Watchdog restart logic (bash 3.2 compatible — no `declare -A`):
1. Try `launchctl kickstart -k gui/501/<LABEL>` — works when plist is loaded
2. If kickstart fails (plist was unloaded), run `launchctl load ~/Library/LaunchAgents/<LABEL>.plist` then kickstart again

**Manual fix if watchdog can't reach it:**
```bash
launchctl kickstart -k gui/501/<LABEL>
sleep 3
curl -s http://localhost:<PORT>/health | head
# If kickstart fails (plist unloaded):
launchctl load ~/Library/LaunchAgents/<LABEL>.plist
launchctl kickstart -k gui/501/<LABEL>
```

---

## 2. Service Running But Serving Stale Code (After Syncthing Sync)

**Fix:**
```bash
# 1. Verify Syncthing has synced latest source on chusMBp
ls -la ~/CloudSync/<project>/src/

# 2. Rebuild
cd ~/CloudSync/<project> && /usr/local/bin/npm run build

# 3. Restart
launchctl kickstart -k gui/501/<LABEL>
```

**Rule:** ALWAYS verify source file on chusMBp before rebuilding.

---

## 3. Browser Caching Old Bundle

**Fix (AI PM only):** Already resolved — `Cache-Control: no-store` in server/index.js.

**User fix:** Hard refresh: Cmd+Shift+R

---

## 4. Telegram BUTTON_DATA_INVALID

**Root cause:** Raw user strings in `callback_data` exceed 64 bytes.

**Fixed in:** `meetings.ts` (encodeCompany Map) + `importer.ts` (slice 50→40). Commit: 2e373be.

**Rule:** All `callback_data` must use fixed-length tokens ≤ 60 bytes. Never embed raw user input.

---

## 5. AI PM Morning Digest — Duplicate Send

**Fixed:** `lastDigestAt` now persists to `data/digest-state.json` and is restored on restart.
A `digestSentToday()` guard also prevents double-send at the scheduled 9AM window.

**If digest never arrives:**
```bash
curl -s http://localhost:3004/pm/api/ai/digest/now  # manual trigger
curl -s http://localhost:3004/pm/api/status | python3 -c 'import sys,json; print(json.load(sys.stdin)["lastDigestAt"])'
cat ~/CloudSync/ai-project-manager/data/digest-state.json
```

---

## 6. OpenRouter 429 Rate Limit

**Behavior:** Circuit breaker trips automatically, blocks OpenRouter 1h, auto-recovers.
App falls back to Groq/Cerebras/Nvidia — users unaffected.

**Log:** `[circuit] openrouter.ai rate-limited (429) — cooldown 1h until HH:MM:SS`

This is expected on free tier. Not an error requiring action.

---

## 7. AI Learning Tool — All Models Failing

**Check:**
```bash
tail -30 /tmp/ai-learning-tool.log | grep -E 'fail|circuit|429|timeout'
```

**Fix:** Usually self-heals. If Nvidia NIM is down, only Groq+Cerebras respond (still functional).

---

## 8. ngrok Tunnel Down

**Detect:** Public URL `https://cancel-aneurism-uneven.ngrok-free.dev` returns error.

**Fix:**
```bash
launchctl kickstart -k gui/501/com.relationship-os.ngrok
sleep 5
curl -s http://localhost:4040/api/tunnels | python3 -c 'import sys,json; [print(t["public_url"]) for t in json.load(sys.stdin)["tunnels"]]'
```

Note: Static ngrok domain never changes after restart.

---

## 9. AI PM Background Agent Error (⚠️ Badge)

**Detect:** Task card shows ⚠️ badge (agentStatus = 'error').

**Auto-heal:** Click the ⚠️ badge directly on the task card — it calls `POST /api/tasks/:id/agent/retry`, resets agentStatus to 'running', and re-runs the background agent. The ⏳ badge appears while it runs; on success it becomes 🤖 (saved).

**Root causes and manual check:**
```bash
# Check what error was logged
tail -30 /tmp/ai-project-manager.log | grep -A2 'agent-bg.*error'
```

Common causes: AI provider timeout (all 3 models busy), task has no title/description for the agent to work with.

**Prevention:** If all providers fail consistently, check API key validity in `.env` (GROQ_API_KEY, CEREBRAS_API_KEY).

---

## 10. Syncthing Conflict Files

**Detect:** `find ~/CloudSync -name "*.sync-conflict-*"`

**Fix:** Keep the newer version, delete the conflict file.

---

## Quick Full Status Check

```bash
echo "=== Service Health ==="; for svc in "3000:/health" "3001:/" "3003:/health" "3004:/pm/api/status"; do
  port=${svc%%:*}; path=${svc##*:}
  code=$(curl -s --max-time 3 "http://localhost:$port$path" -o /dev/null -w '%{http_code}')
  echo "Port $port ($path): $code"
done
echo "=== Watchdog last run ==="; tail -3 /tmp/watchdog.log
echo "=== AI PM digest state ==="; cat ~/CloudSync/ai-project-manager/data/digest-state.json 2>/dev/null || echo "not yet written"
```
