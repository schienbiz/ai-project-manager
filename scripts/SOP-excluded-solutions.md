# 排除方案記錄 — 2026-06-14 chusMBp 全面下線事件

事件：chusMBp 睡眠導致 ngrok + Tailscale + bore 全死，無法監控、無法重啟。

## 套用的修正

| 修正 | 實作 | 原因 |
|------|------|------|
| caffeinate LaunchAgent | `scripts/com.chusmbp.caffeinate.plist` | 防止 chusMBp 睡眠（根本原因） |
| Syncthing 心跳 | `watchdog-chusmbp.sh` 末尾寫 `data/heartbeat.json` | 區分「機器下線」vs「僅 tunnel 斷」 |
| ATung watchdog 讀心跳 | `~/watchdog.sh` 重寫 | 減少誤報；tunnel transient 不觸發嚴重警報 |
| 移除「Restart All Services」按鈕 | ATung watchdog | 按鈕 callback 送回 chusMBp，機器下線時完全無效（false promise） |
| watchdog-chusmbp 加 ngrok/Tailscale 自動重連 | `watchdog-chusmbp.sh` | 若只是 process crash 而非 sleep，可自癒 |
| install-on-chusmbp.sh | `scripts/install-on-chusmbp.sh` | 一鍵安裝所有修正，chusMBp 回來後執行 |

---

## 排除方案（記錄原因，未來參考）

### 1. Wake-on-LAN（網路喚醒）
**為何排除**: 需要同一 LAN 上有另一台常時在線設備發送 WOL magic packet。
目前沒有這樣的設備。
**未來條件**: 若有 Raspberry Pi 或 NUC 在同一 LAN，可加入。

### 2. 雲端心跳 endpoint（Render/Fly）
**為何排除**: 需額外部署 Render service 只為了存一個 timestamp，過度工程。
Syncthing heartbeat 文件達到同樣效果，且不需要額外費用或服務。
**未來條件**: 若 Syncthing 本身也不穩定，再考慮。

### 3. 把所有服務遷移到 Render
**為何排除**: 工程量大（6 個服務）；Render free tier 有 spindown；成本問題。
**未來條件**: 若 chusMBp 本身不再可信（硬體老化），再評估。

### 4. ATung 上的 Telegram bot polling（接管 callback）
**為何排除**: 需要在 ATung 上跑一個持久 bot process，且必須搶在 chusMBp bot 前處理
callback，容易競爭衝突。複雜度不值得。
**實際解法**: ATung watchdog 直接 SSH 到 chusMBp 重啟服務（不需要 Telegram callback）。
每 5 min watchdog 循環會偵測到服務掛掉 → SSH → launchctl kickstart all。

### 5. pm2 取代 LaunchAgent
**為何排除**: LaunchAgent 已正常工作；pm2 需遷移所有服務；混用兩套管理工具更難維護。
**未來條件**: 若改用 Linux server，pm2 是首選。

### 6. ngrok 付費方案（teams / webhook）
**為何排除**: 靜態 domain 已免費可用；付費主要帶來團隊功能，個人用不上。
**未來條件**: 若需要多個靜態 domain 或 IP 白名單，再考慮。

### 7. 多台備援機器
**為何排除**: 成本 / 空間 / 管理複雜度。
**未來條件**: 若服務規模成長到需要 HA，再評估。

---

## Code Review 修正排除項（2026-06-14）

| 排除項 | 原因 |
|--------|------|
| 心跳改用 post-kickstart curl | 心跳只需判斷機器是否在線；pre-kickstart 狀態已足夠，不值得為了 accuracy 多等 15s |
| Tailscale 自我狀態 check 精確化 | `tailscale status \| head -3 \| grep -c active` 雖然脆弱，但 non-critical；精確化需 JSON parse，引入新依賴 |

---

## 2026-06-14 chusMBp 重開機事件後發現的新問題

### 問題 1：Tailscale 重開機後需要手動重新登入
**根因**: chusMBp 重開機後 Tailscale auth key 可能過期，`tailscale up` 需要互動式登入。
watchdog 裡的 `tailscale up` 只能重連，無法替代互動登入。
**症狀**: SSH via Tailscale 全程 timeout；bore/ngrok 是唯一 SSH 路徑。
**修復步驟**（下次可用 SSH 時執行）:
```bash
# 1. 產生 reusable auth key（Tailscale Admin Console → Settings → Keys）
# 2. 在 chusMBp 上跑：
sudo /Applications/Tailscale.app/Contents/MacOS/Tailscale up --auth-key=<REUSABLE_KEY>
# Reusable key 不會因重開機而失效
```
**排除方案**: 將 Tailscale 改為 System LaunchDaemon（root 層級）以在用戶登入前啟動 — 複雜度高，先記錄。

### 問題 2：Warehouse Scanner LaunchAgent 未安裝在 ATung Mac
**根因**: AI-PM `ATUNG_SERVICES` 設定了 `host: 'atungs-mp25', port: 3008`，但 ATung 上沒有對應 LaunchAgent。服務一直是 "no response"。
**修復**: 建立 `~/Library/LaunchAgents/com.warehouse-scanner.dev.plist` ✅ (2026-06-14)
**規則**: 新增到 ATUNG_SERVICES 時，必須同步確認 ATung LaunchAgent 已裝。

### 問題 3：ATung Syncthing "disconnected" 是暫時性的
**根因**: chusMBp 重開機後 Syncthing 需要 ~1-3 分鐘重建 peer 連線。顯示 disconnected 屬於正常現象。
**不需修復**: 自動恢復。

### 問題 4：background watcher 只走 Tailscale SSH，Tailscale 掛掉時完全無效
**根因**: `wait-and-install.sh` hardcode 用 `ssh chuchuchien0430@100.115.104.42`，但這個 IP 只能透過 Tailscale 到達。
**現有緩解**: bore SSH tunnel 會在 chusMBp 啟動時發 Telegram 通知，可手動 SSH。
**未來修復**: watcher 可以同時試 bore.pub（但 port 動態，需從 Telegram 通知中解析）— 暫排除，因為目前人工處理可接受。

---

## 重複錯誤預防規則（LESSON LEARNED）

1. **任何 alert 裡的 inline keyboard button，必須確認 callback handler 在 alert 觸發條件外運行。**
   當 chusMBp 下線時，寄 callback 給 chusMBp 上的 bot 是 dead code。

2. **watchdog 的「能否重啟」和「能否偵測」是不同問題。**
   偵測可以從 ATung 做（passive poll），重啟只能在 chusMBp 在線時做（SSH）或預防性做（caffeinate）。

3. **加任何新 alert 機制前，先問：「machine 完全下線時，這個機制還能工作嗎？」**
   - ngrok: ❌ tunnel 死了
   - Tailscale: ❌ process 死了
   - bore: ❌ process 死了
   - Syncthing heartbeat 文件: ✅ 已同步到 ATung，可離線讀

4. **caffeinate 是 macOS server 的必備設定，不是 optional。**
   MacBook 預設省電設計，沒有 caffeinate 就不能當 server 用。
