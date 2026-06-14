#!/bin/bash
# Run once on chusMBp after it comes back online.
# Installs caffeinate LaunchAgent + updated watchdog.

set -e
SCRIPTS="$HOME/CloudSync/ai-project-manager/scripts"

echo "=== Installing caffeinate (prevent sleep) ==="
cp "$SCRIPTS/com.chusmbp.caffeinate.plist" ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.chusmbp.caffeinate.plist 2>/dev/null || true
launchctl load ~/Library/LaunchAgents/com.chusmbp.caffeinate.plist
echo "caffeinate loaded — chusMBp will no longer sleep"

echo "=== Updating chusMBp watchdog ==="
cp "$SCRIPTS/watchdog-chusmbp.sh" ~/watchdog.sh
chmod +x ~/watchdog.sh
# Trigger watchdog immediately to write first heartbeat
bash ~/watchdog.sh
echo "Watchdog updated and triggered"

echo "=== Reloading all LaunchAgents ==="
for label in com.ai-project-manager.dev com.ai-learning-tool.dev com.marketing-assistant.dev \
             com.relationship-os.dev com.proxy.marketing com.voice-trainer com.chusmbp.watchdog; do
  launchctl kickstart -k "gui/$(id -u)/$label" 2>/dev/null && echo "  ✅ $label" || echo "  ⚠️ $label (may not be loaded)"
done

echo ""
echo "Done. Verify:"
echo "  pgrep caffeinate && echo 'caffeinate running'"
echo "  cat ~/CloudSync/ai-project-manager/data/heartbeat.json"
