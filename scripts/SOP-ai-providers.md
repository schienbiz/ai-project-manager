# SOP — AI Provider Health & Auto-Healing

Covers all 4 projects: AI Project Manager, Marketing Assistant, AI Learning Tool, Relationship OS.

---

## Auto-Healing Built In (No Action Needed)

| Symptom | Auto-Fix | Log to Watch |
|---------|----------|--------------|
| Provider 429 (rate limit) | Circuit breaker skips provider for **60s**, auto-recovers | `[circuit] <name> rate-limited (429)` |
| OpenRouter/any 402 (payment) | Circuit breaker skips for **24h** (credits won't self-heal) | `[circuit] <host> payment required (402)` |
| Qwen3 413 (context too large) | AI PM auto-truncates message 50%, retries once | `[ai] Qwen3 413 — retrying with truncated context` |
| Provider timeout | Parallel gather still uses other providers, sequential fallback next | `[ai] <name> timed out after Xms` |
| All providers failed | Sequential fallback exhausted → task marked `error`, retry button in UI | `[agent-bg] error: All AI providers failed` |
| Background agent error | Click ⚠️ badge in Kanban → calls `/api/tasks/:id/agent/retry` | `[agent-bg] unhandled:` |
| LLM provider 429 (Rel. OS) | `llm.ts` circuit breaker skips label for 60s | `[llm] <label> rate-limited (429)` |
| Blindspot agent missing key | Cerebras fills in automatically (no Grok key needed) | `[llm] provider=cerebras` |
| Service crash | KeepAlive in plist auto-restarts | Telegram: 🟢 started |
| Service hung | Watchdog detects in 5 min, kickstart | `/tmp/watchdog.log` |

---

## When to Manually Intervene

### 1. All 3 AI PM providers cooling simultaneously
Cause: rapid burst (e.g. 8 background agents at once) tripped all circuit breakers.

```bash
# Check admin dashboard
open https://cancel-aneurism-uneven.ngrok-free.dev/pm/admin

# Or SSH and restart service (clears all in-memory cooldowns)
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

Prevention: Background agents trigger one at a time as tasks move to In Progress. Avoid dragging 5+ tasks at once.

### 2. 402 on a provider (credits exhausted)
Cause: OpenRouter, or any free-tier provider that requires payment.

```bash
# Learning Tool: verify circuit is tripped for 24h (not retrying every hour)
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "grep 'payment required' /tmp/ai-learning-tool.err | tail -3"
```

Fix: Top up credits at the provider dashboard. After adding credits, restart the service to clear the circuit:
```bash
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "launchctl kickstart -k gui/501/com.ai-learning-tool.dev"
```

### 3. Groq API key revoked (Groq free-tier keys can expire)
Symptom: All Groq calls fail with 401, not 429.

```bash
# Renew key at console.groq.com, then update .env on chusMBp
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "sed -i '' 's/GROQ_API_KEY=.*/GROQ_API_KEY=gsk_NEW_KEY/' \
  ~/CloudSync/ai-project-manager/.env \
  ~/CloudSync/ai-learning-tool/.env \
  ~/CloudSync/marketing-assistant/.env \
  ~/relationship-os/.env"

# Restart all services
for label in com.ai-project-manager.dev com.ai-learning-tool.dev \
             com.marketing-assistant.dev com.relationship-os.dev; do
  ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
    "launchctl kickstart -k gui/501/$label"
done
```

### 4. Neon-style database quota exceeded (any future DB)
Symptom: `Error querying the database: ... quota exceeded` in stderr.

```bash
# Relationship OS: verify current DB is Supabase (not Neon)
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "grep 'DATABASE_URL' ~/relationship-os/.env | sed 's/:.*@/:***@/'"
# Should show: aws-1-us-east-2.pooler.supabase.com (not neon.tech)
```

Fix: Migrate to a provider with no compute quota (Supabase free tier has none). See `project_relationship_os.md` for migration SOP.

---

## Circuit Breaker Reference by Project

| Project | Lib | 429 Cooldown | 402 Cooldown | Log Prefix |
|---------|-----|-------------|-------------|------------|
| AI Project Manager | `multiGenerate()` | 60s | — | `[circuit]` |
| Marketing Assistant | `multiGenerate()` | 60s | — | `[circuit]` |
| AI Learning Tool | `callModelJSON()` | 60s | 24h | `[circuit]` |
| Relationship OS (llm.ts) | `chatCompletion()` | 60s | — | `[llm]` |
| Relationship OS (orchestrator) | `withTimeout()` | — (10s hard timeout) | — | agent timed out |

---

## Watchdog Coverage

| Check | Frequency | Action on Failure |
|-------|-----------|------------------|
| chusMBp HTTP health (all 5 services) | Every 5 min | kickstart + Telegram |
| Plist unloaded | Every 5 min | launchctl load + kickstart |
| ATung Syncthing | Every 5 min | Telegram alert |
| ATung → chusMBp reachability | Every 5 min | Telegram alert |
| bore SSH tunnel | Continuous (KeepAlive) | Auto-restart, Telegram every 30 min |

Log paths:
- chusMBp watchdog: `/tmp/watchdog.log`
- ATung watchdog: `/tmp/atung-watchdog.log`
- bore tunnel: `/tmp/bore-ssh-output.log`

---

## Adding a New AI Provider

1. Add API key to `.env` on chusMBp for the relevant project
2. Add provider entry to `PROVIDERS` array (AI PM / Marketing) or `buildModels` (Learning Tool)
3. Set a realistic `timeout` (Groq: 8s, Cerebras: 10-12s, NVIDIA: 10-30s)
4. Circuit breaker is automatic — no extra code needed
5. Restart the service: `launchctl kickstart -k gui/501/<label>`
6. Verify in System Admin (`/pm/admin`) that the new provider appears

For Relationship OS: add the provider to `llm.ts`'s fallback chain. Circuit breaker is already in `tryProvider`.

---

## Key Log Commands

```bash
# Live tail all logs
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "tail -f /tmp/ai-project-manager.log /tmp/ai-learning-tool.log /tmp/marketing-dev.log"

# Check AI PM circuit breaker state via admin API
curl https://cancel-aneurism-uneven.ngrok-free.dev/pm/api/admin/status | \
  python3 -c "import sys,json; d=json.load(sys.stdin); [print(p['name'],p.get('cooling','?')) for p in d['providers']]"

# Check learning tool for 402 / 429 events
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "grep '\[circuit\]' /tmp/ai-learning-tool.err | tail -10"

# Check Relationship OS LLM cooldowns
ssh chuchuchien0430@chus-macbook-pro-3.tailb03d65.ts.net \
  "grep '\[llm\].*rate-limit\|cooling' /Users/chuchuchien0430/relationship-os/logs/stderr.log | tail -10"
```
