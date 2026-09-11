#!/bin/bash
# ⚠️ 版控鏡像（MIRROR ONLY — NOT EXECUTED）：實際在跑的是 ATung Mac 的 ~/watchdog.sh，
# 那是一個指向 ~/ops-scripts/watchdog.sh 的 symlink（com.atung.watchdog 的
# ProgramArguments 指向 $HOME/watchdog.sh，不是本 repo 的檔案）。要改行為請改
# ops-scripts 那份，再把變更同步回此鏡像；直接改此檔不會影響任何執行中的服務。
# 與 live 的唯一預期差異就是本段標頭——此外任何 diff 都代表鏡像落後了。
# 姊妹檔 scripts/watchdog-chusmbp.sh 早就有同樣的標頭；本檔一直沒有。
# ATung watchdog — checks Syncthing + chusMBp reachability every 5 min
# LaunchAgent: com.atung.watchdog
# When chusMBp services are down: auto-SSH and restart all services.
# Uses Syncthing heartbeat file to distinguish machine-offline vs service-crash.
# locale 護欄：launchd 繼承空 locale → 中文告警在 log 會 mojibake;固定 UTF-8(本檔無 set -u,故為顯示正確性非防崩)。
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8

# secrets: sourced from untracked ~/.watchdog-secrets (chmod 600, outside any Syncthing folder).
# rotate the token/key there, not here. exits loudly if missing so launchd surfaces it.
SECRETS_FILE="${WATCHDOG_SECRETS:-$HOME/.watchdog-secrets}"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "watchdog: missing $SECRETS_FILE (BOT_TOKEN/CHAT_ID/SYNCTHING_KEY)" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$SECRETS_FILE"
: "${BOT_TOKEN:?watchdog: BOT_TOKEN unset in $SECRETS_FILE}"
: "${CHAT_ID:?watchdog: CHAT_ID unset in $SECRETS_FILE}"
: "${SYNCTHING_KEY:?watchdog: SYNCTHING_KEY unset in $SECRETS_FILE}"
# Machine identity comes from the same untracked secrets file as the token — this repo
# is public, and a Tailscale address plus a username is a fingerprint of a private
# network. Same `:?` treatment as the credentials: absent means exit loudly rather than
# run against an empty host.
: "${CHUSMBP:?watchdog: CHUSMBP unset in $SECRETS_FILE}"
: "${CHUS_USER:?watchdog: CHUS_USER unset in $SECRETS_FILE}"
# Overridable for the same reason WATCHDOG_SECRETS is: 「機器在靜音期間提早回來」那條
# 告警路徑，只有在心跳是新的時候才會走到，正常情況下永遠碰不到。一個沒人看過它發射
# 的通知器，跟不會動的通知器在日誌裡長得一模一樣。
HB_FILE="${HB_FILE:-$HOME/CloudSync/ai-project-manager/data/heartbeat.json}"

CHUS_COOLDOWN_FILE="/tmp/watchdog-chus-cooldown"
CHUS_RESTART_COOLDOWN_FILE="/tmp/watchdog-chus-restart-cooldown"
CHUS_TRANSPORT_COOLDOWN_FILE="/tmp/watchdog-chus-transport-cooldown"
SYNCTHING_COOLDOWN_FILE="/tmp/watchdog-syncthing-cooldown"
CHUS_WOKE_COOLDOWN_FILE="/tmp/watchdog-chus-woke-cooldown"
# 倒數提醒的已發送紀錄。放在 snooze 檔旁邊而不是 /tmp：/tmp 會被系統定期清掉，
# 那會讓「已經提醒過」這件事失憶，於是同一個里程碑重複發。檔名綁著 snooze 檔，
# 內容綁著到期日——改了到期日就等於一次新的靜音，倒數自動重新開始。
CHUS_REMIND_MILESTONES="14 7 3 1"
COOLDOWN_SECS=1800

RESTART_CMD="for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.proxy.marketing com.voice-trainer com.chusmbp.watchdog; do launchctl kickstart -k gui/501/\$label 2>/dev/null; done"

is_in_cooldown() {
  local file="$1"
  if [ -f "$file" ]; then
    local last=$(cat "$file" 2>/dev/null || echo 0)
    local age=$(( $(date +%s) - last ))
    [ "$age" -lt "$COOLDOWN_SECS" ] && return 0
  fi
  return 1
}

set_cooldown() { date +%s > "$1"; }

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

ssh_restart() {
  ssh -o ConnectTimeout=10 -o StrictHostKeyChecking=no \
    "${CHUS_USER}@${CHUSMBP}" "$RESTART_CMD" 2>&1
}

ALERTS=()

# --- 1. Syncthing ---
ST=$(curl -s --max-time 5 http://localhost:8384/rest/system/ping \
  -H "X-API-Key: $SYNCTHING_KEY" 2>/dev/null | grep -c 'pong')
if [ "$ST" -lt 1 ]; then
  echo "[watchdog] $(date): Syncthing down — restarting"
  brew services restart syncthing 2>/dev/null || launchctl kickstart -k "gui/$(id -u)/homebrew.mxcl.syncthing" 2>/dev/null
  if ! is_in_cooldown "$SYNCTHING_COOLDOWN_FILE"; then
    ALERTS+=("⚠️ *Syncthing* restarted on ATung")
    set_cooldown "$SYNCTHING_COOLDOWN_FILE"
  fi
else
  echo "[watchdog] $(date): Syncthing OK"
  rm -f "$SYNCTHING_COOLDOWN_FILE"
fi

# --- 2. chusMBp: read heartbeat (written by chusMBp watchdog, synced via Syncthing) ---
NOW=$(date +%s)
HB_TS=0
HB_AGE=99999
CHUS_STATUS="unknown"

if [ -f "$HB_FILE" ] && [ "$ST" -ge 1 ]; then
  HB_TS=$(python3 -c "import json; d=json.load(open('$HB_FILE')); print(d.get('ts',0))" 2>/dev/null || echo 0)
  HB_AGE=$(( NOW - HB_TS ))
  if [ "$HB_AGE" -lt 720 ]; then
    CHUS_STATUS="alive"
  else
    CHUS_STATUS="down"
  fi
fi

# --- 2a. chusMBp 監控靜音（有期限的計畫性停機）---
# 對一台「已知會離線一段時間」的機器，每 5 分鐘探測加發告警，除了把預期中的事變成告警
# 之外不產生任何資訊；而對預期發告警的 pager，人會學會整串滑掉——連同哪天真的壞掉的
# 那一則。所以這裡讓它可以被明確地、有期限地靜音，而不是把檢查刪掉。
#
# 判準外置在 ~/.chusmbp-snooze（audit-ground-truth.sh 讀同一個檔：同一件事若在兩處各靜音
# 一半，剩下那半會照樣每天 page）。格式：第一個 YYYY-MM-DD = 「恢復監控的第一天」，其後
# 空白隔開的文字為原因。**當下的事由寫在那個檔裡，不寫在這裡**——本檔進版控（且有一份
# 副本在公開 repo），寫在註解裡的現況會在機器回來之後繼續騙人。
#
# 四道 fail-safe，方向一律偏向「繼續監控」：
#   1. 檔案不存在／找不到合法的 YYYY-MM-DD → 不靜音
#   2. 日期解析不出來，或回寫後不等於原字串（2026-02-30 會被 date 滾成 03-02）→ 不靜音
#   3. 日期已到 → 不靜音，自己過期，不需要任何人記得回來解除
#   4. 距今超過 CHUS_SNOOZE_MAX_DAYS 天 → 不靜音。靜音必須會過期；一個手殘打成 2072 的
#      日期會讓「會過期」這個唯一的安全性質失效，而失效後看起來跟正常完全一樣。
CHUS_SNOOZE_FILE="${CHUS_SNOOZE_FILE:-$HOME/.chusmbp-snooze}"
CHUS_SNOOZE_MAX_DAYS=400
CHUS_REMIND_FILE="${CHUS_SNOOZE_FILE}.reminded"
CHUS_SNOOZED="no"; CHUS_SNOOZE_UNTIL=""; CHUS_SNOOZE_WHY=""
CHUS_SNOOZE_SKIP=""; CHUS_SNOOZE_BAD="no"
SNZ_NOW=$(date +%s); SNZ_EPOCH=""
if [ -f "$CHUS_SNOOZE_FILE" ]; then
  SNZ_LINE=$(grep -m1 -E '^[0-9]{4}-[0-9]{2}-[0-9]{2}([[:space:]]|$)' "$CHUS_SNOOZE_FILE" 2>/dev/null | tr -d '\r')
  CHUS_SNOOZE_UNTIL="${SNZ_LINE%%[[:space:]]*}"
  CHUS_SNOOZE_WHY=$(printf '%s' "${SNZ_LINE#"$CHUS_SNOOZE_UNTIL"}" | sed 's/^[[:space:]]*//')
  SNZ_EPOCH=$(date -j -f "%Y-%m-%d %H:%M:%S" "${CHUS_SNOOZE_UNTIL} 00:00:00" +%s 2>/dev/null || echo "")
  if [ -z "$CHUS_SNOOZE_UNTIL" ]; then
    CHUS_SNOOZE_SKIP="檔案裡沒有合法的 YYYY-MM-DD"; CHUS_SNOOZE_BAD="yes"
  elif [ -z "$SNZ_EPOCH" ] || [ "$(date -j -f %s "$SNZ_EPOCH" +%Y-%m-%d 2>/dev/null)" != "$CHUS_SNOOZE_UNTIL" ]; then
    CHUS_SNOOZE_SKIP="${CHUS_SNOOZE_UNTIL} 不是真實日期"; CHUS_SNOOZE_BAD="yes"
  elif [ "$SNZ_EPOCH" -le "$SNZ_NOW" ]; then
    CHUS_SNOOZE_SKIP="靜音已於 ${CHUS_SNOOZE_UNTIL} 到期"
  elif [ "$SNZ_EPOCH" -gt "$(( SNZ_NOW + CHUS_SNOOZE_MAX_DAYS * 86400 ))" ]; then
    CHUS_SNOOZE_SKIP="${CHUS_SNOOZE_UNTIL} 距今超過 ${CHUS_SNOOZE_MAX_DAYS} 天，視為誤植"; CHUS_SNOOZE_BAD="yes"
  else
    CHUS_SNOOZED="yes"
  fi
fi

if [ "$CHUS_SNOOZED" = "yes" ]; then
  # 每次都印，而且帶到期日與原因：「攔下來了」和「這段根本沒跑到」在日誌裡必須長得不一樣。
  echo "[watchdog] $(date): chusMBp SNOOZED until ${CHUS_SNOOZE_UNTIL} — ${CHUS_SNOOZE_WHY:-(檔案未記錄原因)}"
  rm -f "$CHUS_COOLDOWN_FILE" "$CHUS_RESTART_COOLDOWN_FILE" "$CHUS_TRANSPORT_COOLDOWN_FILE"
  # 靜音的反向風險：機器提早回來了卻沒人在看它。心跳是 Syncthing 同步過來的本機檔案，
  # 不花任何網路，所以即使靜音也能免費偵測「它回來了」，並提醒把靜音解除。
  if [ "$CHUS_STATUS" = "alive" ]; then
    echo "[watchdog] $(date): chusMBp 心跳復活（${HB_AGE}s）但仍在 snooze 中"
    if ! is_in_cooldown "$CHUS_WOKE_COOLDOWN_FILE"; then
      ALERTS+=("🟢 *chusMBp 有心跳了* — 但監控仍靜音中（至 ${CHUS_SNOOZE_UNTIL}）\n心跳 $(( HB_AGE / 60 )) 分鐘前\n恢復監控：\n\`rm ~/.chusmbp-snooze\`")
      set_cooldown "$CHUS_WOKE_COOLDOWN_FILE"
    fi
  else
    rm -f "$CHUS_WOKE_COOLDOWN_FILE"
  fi

  # 到期倒數提醒。沒有這段的話，「提醒」就等於到期當天自動恢復探測——機器若仍關機，
  # 那是每 30 分鐘一則 OFFLINE，是一場告警風暴而不是一個可以回答的問題。
  # 遞減里程碑（14/7/3/1 天）而不是每天一則：連發十四天的倒數，換來的是被整串滑掉。
  # 兩層刻意都留著：這層優雅、可能被忽略；到期自動恢復那層吵、但不可能被忽略。
  SNZ_DAYS_LEFT=$(( (SNZ_EPOCH - SNZ_NOW) / 86400 ))
  REMIND_DONE=""
  if [ -f "$CHUS_REMIND_FILE" ]; then
    RF=$(cat "$CHUS_REMIND_FILE" 2>/dev/null)
    case "$RF" in
      "${CHUS_SNOOZE_UNTIL}:"*) REMIND_DONE="${RF#*:}" ;;
      *) : ;;   # 紀錄屬於另一個到期日 → 視為沒提醒過，倒數重新開始
    esac
  fi
  for M in $CHUS_REMIND_MILESTONES; do
    [ "$SNZ_DAYS_LEFT" -le "$M" ] || continue
    case " ${REMIND_DONE} " in *" ${M} "*) continue ;; esac
    echo "[watchdog] $(date): chusMBp 靜音倒數提醒 T-${M}（實際剩 ${SNZ_DAYS_LEFT} 天）"
    ALERTS+=("⏳ *chusMBp 監控靜音快到期* — 還剩 ${SNZ_DAYS_LEFT} 天（${CHUS_SNOOZE_UNTIL}）\n\n到期後 watchdog 會自動恢復探測。機器若仍關機，就會開始每 30 分鐘一則 OFFLINE 告警。\n\n延長：改 \`~/.chusmbp-snooze\` 第一行的日期（上限距今 ${CHUS_SNOOZE_MAX_DAYS} 天，再遠會被當成誤植而不生效）\n如期恢復：不用做任何事\n提早恢復：\`rm ~/.chusmbp-snooze\`")
    printf '%s:%s\n' "$CHUS_SNOOZE_UNTIL" "${REMIND_DONE:+$REMIND_DONE }$M" > "$CHUS_REMIND_FILE"
    break
  done
else
  if [ -n "$CHUS_SNOOZE_SKIP" ]; then
    echo "[watchdog] $(date): chusMBp snooze 未生效（${CHUS_SNOOZE_SKIP}）— 照常監控"
  fi
  rm -f "$CHUS_REMIND_FILE"   # 沒在靜音 → 倒數紀錄沒有意義，清掉讓下次從頭算

  # Network checks
  # All three service probes go over Tailscale (${CHUSMBP} = Tailscale IP). The ngrok HTTP
  # tunnel (retired 2026-07-11) used to be the ONLY transport-independent probe; its role is
  # now filled by BORE_ALIVE — a direct TCP reach to chusMBp's bore.pub SSH tunnel, which
  # egresses to the public internet and works even when Tailscale is down. That's what lets us
  # distinguish "Tailscale transport down, machine alive" from "machine offline".
  # Single-service failure (e.g. AI-PM DB crash) must not trigger a full restart, so any of the
  # three Tailscale HTTP probes answering = services reachable.
  TAILSCALE_HTTP=$(curl -s --max-time 8 "http://${CHUSMBP}:3004/pm/api/status" -o /dev/null -w '%{http_code}')
  TAILSCALE_PROXY=$(curl -s --max-time 6 "http://${CHUSMBP}:3002/health" -o /dev/null -w '%{http_code}')
  TAILSCALE_VOICE=$(curl -s --max-time 6 "http://${CHUSMBP}:3005/health" -o /dev/null -w '%{http_code}')

  # Out-of-band liveness: probe chusMBp's bore.pub SSH tunnel port (published by
  # bore-ssh-tunnel.sh into the Syncthing-synced data dir). Independent of Tailscale.
  BORE_PORT=$(grep -oE '[0-9]+' "$HOME/CloudSync/ai-project-manager/data/bore-ssh-current.txt" 2>/dev/null | head -1)
  BORE_ALIVE="no"
  if [ -n "$BORE_PORT" ] && nc -z -w 5 bore.pub "$BORE_PORT" 2>/dev/null; then BORE_ALIVE="yes"; fi

  echo "[watchdog] $(date): heartbeat=${HB_AGE}s status=${CHUS_STATUS} bore=${BORE_ALIVE}(${BORE_PORT:-?}) aipm=${TAILSCALE_HTTP} proxy=${TAILSCALE_PROXY} voice=${TAILSCALE_VOICE}"

  if [ "$TAILSCALE_HTTP" = "200" ] || [ "$TAILSCALE_PROXY" = "200" ] || [ "$TAILSCALE_VOICE" = "200" ]; then
    # Services answer over Tailscale → machine up, transport healthy.
    echo "[watchdog] $(date): chusMBp reachable — OK"
    rm -f "$CHUS_COOLDOWN_FILE"
    rm -f "$CHUS_RESTART_COOLDOWN_FILE"
    rm -f "$CHUS_TRANSPORT_COOLDOWN_FILE"
  elif [ "$BORE_ALIVE" = "yes" ]; then
    # No Tailscale HTTP, but the machine's bore tunnel is up = machine alive with internet.
    # Try a Tailscale SSH restart: if it works, services had merely crashed; if SSH also fails,
    # Tailscale itself is down while the machine lives = transport degraded (network change).
    echo "[watchdog] $(date): no Tailscale HTTP but bore alive — attempting SSH restart"
    SSH_OUT=$(ssh_restart 2>&1)
    SSH_EXIT=$?
    if [ "$SSH_EXIT" -eq 0 ]; then
      echo "[watchdog] $(date): SSH restart succeeded (services were down)"
      rm -f "$CHUS_COOLDOWN_FILE"
      rm -f "$CHUS_TRANSPORT_COOLDOWN_FILE"
      if ! is_in_cooldown "$CHUS_RESTART_COOLDOWN_FILE"; then
        ALERTS+=("🔄 *chusMBp* services restarted via SSH from ATung\nbore: up:${BORE_PORT} | Tailscale 3004: ${TAILSCALE_HTTP}\n_Auto-recovered_")
        set_cooldown "$CHUS_RESTART_COOLDOWN_FILE"
      fi
    else
      echo "[watchdog] $(date): Tailscale SSH failed but bore up — transport degraded"
      if ! is_in_cooldown "$CHUS_TRANSPORT_COOLDOWN_FILE"; then
        ALERTS+=("🟠 *chusMBp transport degraded* — machine alive (bore SSH up on port ${BORE_PORT}) but Tailscale down\nSSH in via fallback:\n\`ssh -p ${BORE_PORT} ${CHUS_USER}@bore.pub\`\n_Check chusMBp WiFi + Tailscale app (network change?)_")
        set_cooldown "$CHUS_TRANSPORT_COOLDOWN_FILE"
      fi
    fi
  else
    # No Tailscale HTTP AND bore not reachable — machine likely offline. Last-ditch SSH restart.
    echo "[watchdog] $(date): chusMBp unreachable (bore down too) — attempting SSH restart"
    SSH_OUT=$(ssh_restart 2>&1)
    SSH_EXIT=$?

    if [ "$SSH_EXIT" -eq 0 ]; then
      # SSH worked → machine alive, services were down
      echo "[watchdog] $(date): SSH restart succeeded"
      rm -f "$CHUS_COOLDOWN_FILE"
      if ! is_in_cooldown "$CHUS_RESTART_COOLDOWN_FILE"; then
        ALERTS+=("🔄 *chusMBp* services restarted via SSH from ATung\nbore: down | Tailscale port 3004: ${TAILSCALE_HTTP}\n_Auto-recovered_")
        set_cooldown "$CHUS_RESTART_COOLDOWN_FILE"
      else
        echo "[watchdog] $(date): SSH restart alert suppressed (cooldown)"
      fi
    else
      # SSH failed → machine is offline
      echo "[watchdog] $(date): SSH failed (exit $SSH_EXIT) — machine likely offline"
      if ! is_in_cooldown "$CHUS_COOLDOWN_FILE"; then
        if [ "$CHUS_STATUS" = "down" ]; then
          AGE_MIN=$(( HB_AGE / 60 ))
          MSG="🔴 *chusMBp OFFLINE* — SSH + bore unreachable\nHeartbeat stale: ${AGE_MIN} min ago\nTailscale: ${TAILSCALE_HTTP} | bore: down\n\n_Machine may be asleep or powered off_"
        else
          MSG="🔴 *chusMBp* unreachable — SSH failed\nTailscale: ${TAILSCALE_HTTP} | bore: down\n\nSSH when Tailscale reconnects:\n\`ssh ${CHUS_USER}@${CHUSMBP}\`"
        fi
        ALERTS+=("$MSG")
        set_cooldown "$CHUS_COOLDOWN_FILE"
      else
        echo "[watchdog] $(date): chusMBp offline alert suppressed (cooldown)"
      fi
    fi
  fi
fi

# --- 3. ATung local agents (self-heal: re-bootstrap if booted out of domain) ---
# 破口(2026-07-09 定位)：此 watchdog 原本只顧 chusMBp；ATung 本機 agent 被 bootout
# 後無人 re-bootstrap → 靜默消失(warehouse 7/9 正是此態)。KeepAlive 只在「已載入」時
# 管 crash，不管「被移出 domain」。此段補上：未註冊→bootstrap；已註冊但 port 死→kickstart。
# 每筆 "label port"（port=0 表示無 HTTP 只驗註冊）。bash 3.2 相容(無 declare -A)。
UID_NUM=$(id -u)
LOCAL_AGENT_COOLDOWN_FILE="/tmp/watchdog-local-agent-cooldown"
LOCAL_RECOVERED=()
for entry in \
  "com.intelligence-journal.dev 3000" \
  "com.voice-trainer.dev 3005" \
  "com.warehouse-scanner.dev 3008"; do
  label="${entry%% *}"; port="${entry##* }"
  plist="$HOME/Library/LaunchAgents/${label}.plist"
  [ -f "$plist" ] || continue   # plist 不存在 = 刻意沒這個 agent，跳過
  if ! launchctl print "gui/${UID_NUM}/${label}" >/dev/null 2>&1; then
    echo "[watchdog] $(date): local agent $label NOT loaded — bootstrapping"
    if launchctl bootstrap "gui/${UID_NUM}" "$plist" 2>/dev/null; then
      LOCAL_RECOVERED+=("$label (re-bootstrap)")
    else
      LOCAL_RECOVERED+=("$label (bootstrap FAILED — 手動查)")
    fi
  elif [ "$port" != "0" ]; then
    # 已載入但 port 不通 → 給 KeepAlive 幾秒，仍不通才 kickstart
    if ! nc -z -w 3 localhost "$port" >/dev/null 2>&1; then
      sleep 5
      if ! nc -z -w 3 localhost "$port" >/dev/null 2>&1; then
        echo "[watchdog] $(date): local agent $label loaded but :$port dead — kickstart"
        launchctl kickstart -k "gui/${UID_NUM}/${label}" 2>/dev/null
        LOCAL_RECOVERED+=("$label (:$port dead → kickstart)")
      fi
    fi
  fi
done
if [ ${#LOCAL_RECOVERED[@]} -gt 0 ]; then
  echo "[watchdog] $(date): local agents recovered: ${LOCAL_RECOVERED[*]}"
  if ! is_in_cooldown "$LOCAL_AGENT_COOLDOWN_FILE"; then
    ALERTS+=("🩺 *ATung 本機 agent 自癒*\n$(printf '%s\n' "${LOCAL_RECOVERED[@]}")")
    set_cooldown "$LOCAL_AGENT_COOLDOWN_FILE"
  fi
else
  echo "[watchdog] $(date): local agents all loaded & healthy"
  rm -f "$LOCAL_AGENT_COOLDOWN_FILE"
fi

# --- audit dead-man's switch ---
# com.atung.audit runs audit-ground-truth.sh daily and pages on FAIL. But a scheduled
# check that stops running is silent in exactly the way the audit's own date gates were
# silent for months: §9 was written to catch an overdue claims ledger and never fired,
# because nothing ran the script that contained it. So something OUTSIDE that schedule
# has to notice, and this watchdog — every 5 minutes, already wired to Telegram — is the
# cheapest thing that already exists.
#
# 48h, not 24h: the audit is daily and this laptop sleeps. One missed day is ordinary;
# two means the schedule itself is broken. A threshold that cries on the ordinary is a
# threshold that gets muted.
AUDIT_HB="$HOME/.audit-last-run"
AUDIT_STALE_SECS=172800
AUDIT_COOLDOWN_FILE="/tmp/watchdog-audit-cooldown"
if [ -f "$AUDIT_HB" ]; then
  AUDIT_AGE=$(( $(date +%s) - $(cat "$AUDIT_HB" 2>/dev/null || echo 0) ))
else
  AUDIT_AGE=$AUDIT_STALE_SECS
fi
if [ "$AUDIT_AGE" -ge "$AUDIT_STALE_SECS" ]; then
  echo "[watchdog] $(date): audit heartbeat stale (${AUDIT_AGE}s)"
  if ! is_in_cooldown "$AUDIT_COOLDOWN_FILE"; then
    ALERTS+=("🕰️ *audit 排程沒在跑* — 心跳已 $(( AUDIT_AGE / 3600 ))h 未更新\ncom.atung.audit 應每日 09:30 執行\n\`launchctl print gui/501/com.atung.audit\`")
    set_cooldown "$AUDIT_COOLDOWN_FILE"
  fi
else
  rm -f "$AUDIT_COOLDOWN_FILE"
fi

if [ ${#ALERTS[@]} -gt 0 ]; then
  MSG="⚙️ *ATung Watchdog*\n\n$(printf '%s\n' "${ALERTS[@]}")"
  send_telegram "$MSG"
  echo "[watchdog] alert sent: ${ALERTS[*]}"
fi
