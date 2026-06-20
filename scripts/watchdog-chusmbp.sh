#!/bin/bash
# ⚠️ 版控鏡像：實際在跑的是 chusMBp 的 ~/watchdog.sh（com.chusmbp.watchdog LaunchAgent
# ProgramArguments 指向 /Users/chuchuchien0430/watchdog.sh，非本 repo 檔）。改行為要改 ~/watchdog.sh
# 並回鏡像到此。2026-06-20 同步：ROS HTTP-kill 檢查停用 + 自監控心跳 /tmp/watchdog-hb。
# chusMBp service watchdog — runs every 5 min via LaunchAgent
# Checks all 6 services, restarts dead ones, sends Telegram alert on action taken.

BOT_TOKEN="8696185476:AAHGPjhDQMkLIbP6XN4jgJiEqpa3Ce1UE2Y"
CHAT_ID="5108352229"

send_telegram() {
  curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
    -H 'Content-Type: application/json' \
    -d "{\"chat_id\":\"${CHAT_ID}\",\"text\":\"$1\",\"parse_mode\":\"Markdown\"}" > /dev/null
}

RESTARTED=()

# ── TLS cert guard ─────────────────────────────────────────────────────────────
# Node.js 20 on macOS Monterey doesn't trust GoDaddy G2 (used by api.telegram.org)
# unless NODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem is set. This env var must exist in
# each service plist's EnvironmentVariables. Check and auto-fix if missing.
NODE_CA_PLISTS=(com.relationship-os.dev com.ai-learning-tool.dev com.ai-project-manager.dev com.marketing-assistant.dev com.proxy.marketing)
CA_FIXED=0
for svc in "${NODE_CA_PLISTS[@]}"; do
  plist_file="$HOME/Library/LaunchAgents/${svc}.plist"
  current=$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:NODE_EXTRA_CA_CERTS" "$plist_file" 2>/dev/null)
  if [ "$current" != "/etc/ssl/cert.pem" ]; then
    echo "[watchdog] $(date): $svc missing NODE_EXTRA_CA_CERTS — applying fix"
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables dict" "$plist_file" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Delete :EnvironmentVariables:NODE_EXTRA_CA_CERTS" "$plist_file" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Add :EnvironmentVariables:NODE_EXTRA_CA_CERTS string /etc/ssl/cert.pem" "$plist_file"
    launchctl unload "$plist_file" 2>/dev/null || true
    launchctl load "$plist_file"
    CA_FIXED=1
    echo "[watchdog] $(date): reloaded $svc with NODE_EXTRA_CA_CERTS"
  fi
done
if [ "$CA_FIXED" = "1" ]; then
  launchctl setenv NODE_EXTRA_CA_CERTS /etc/ssl/cert.pem
  send_telegram "🔧 *chusMBp Auto-fixed: Node.js TLS cert*\n\nNODE_EXTRA_CA_CERTS=/etc/ssl/cert.pem re-applied to all service plists. Services reloaded."
  sleep 10  # give services time to restart before health checks
else
  echo "[watchdog] $(date): NODE_EXTRA_CA_CERTS OK in all plists"
fi

check_service() {
  local LABEL="$1"
  local URL="$2"
  local HTTP
  HTTP=$(curl -s --max-time 5 "$URL" -o /dev/null -w '%{http_code}')
  if [ "$HTTP" = "000" ] || [ -z "$HTTP" ]; then
    echo "[watchdog] $(date): $LABEL unreachable (HTTP $HTTP) — restarting"
    if ! launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null; then
      echo "[watchdog] $(date): $LABEL — kickstart failed, loading plist first"
      launchctl load ~/Library/LaunchAgents/$LABEL.plist 2>/dev/null || true
      sleep 2
      launchctl kickstart -k "gui/501/$LABEL" 2>/dev/null || true
    fi
    RESTARTED+=("$LABEL")
  else
    echo "[watchdog] $(date): $LABEL OK ($HTTP)"
  fi
}

check_service "com.ai-project-manager.dev"   "http://localhost:3004/pm/api/status"
check_service "com.ai-learning-tool.dev"      "http://localhost:3003/health"
check_service "com.marketing-assistant.dev"   "http://localhost:3001/health"
# 2026-06-20 停用: ROS Neon compute 配額耗盡→3000永不bind→此HTTP檢查每5分鐘殺活進程(339次)+洗版,且修不了外部Neon根因。plist KeepAlive管真crash,ROS會在Neon重置後自動serve。
# check_service "com.relationship-os.dev"       "http://localhost:3000/health"
check_service "com.proxy.marketing"           "http://localhost:3002/health"
check_service "com.voice-trainer"             "http://localhost:3005/health"

if [ ${#RESTARTED[@]} -gt 0 ]; then
  send_telegram "⚙️ *Watchdog auto-restarted*\n\n$(printf '• %s\n' "${RESTARTED[@]}")\n\n_chusMBp auto-healing triggered_"
  echo "[watchdog] alert sent: ${RESTARTED[*]}"
else
  echo "[watchdog] $(date): all services healthy"
fi

# Rotate ROS logs if > 5MB
for logfile in ~/relationship-os/logs/stdout.log ~/relationship-os/logs/stderr.log; do
  if [ -f "$logfile" ]; then
    size=$(stat -f%z "$logfile" 2>/dev/null || echo 0)
    if [ "$size" -gt 5242880 ]; then
      mv "$logfile" "${logfile}.bak"
      touch "$logfile"
      echo "[watchdog] rotated $logfile (${size} bytes)"
    fi
  fi
done


date +%s > /tmp/watchdog-hb 2>/dev/null   # 2026-06-20 自監控心跳：AI-PM 讀此檔新鮮度判 watchdog 是否還活著
exit 0
