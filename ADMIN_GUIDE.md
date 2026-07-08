# System Admin 使用說明

AI PM 內建的 **System Admin**(⚙️)是整個個人基礎設施的監控中心 — 一頁看完
chusMBp / ATung Mac 本機服務、Render 外部服務、AI Provider、用量配額、API Key
金庫、Watchdog 與每日 Digest。本文說明每個面板的意義與可執行的操作。

> 資料權威來源:此頁大量欄位直接來自 Render API、Neon/CockroachDB SQL、Cloudinary
> API 與 launchd,**不是人工記錄**。當畫面與你的印象不符時,以此頁為準。

---

## 1. 進入與登入

- 入口:AI PM 側邊欄 → **⚙️ System Admin**。
- 登入:第一次進入會出現 🔐 **Admin Token** 鎖。輸入伺服器的 `ADMIN_TOKEN`
  環境變數值即可解鎖。
- Token 存在瀏覽器 `sessionStorage`(關掉分頁即失效,**不寫進 bundle**),每個
  請求以 `x-admin-token` 標頭送出。
- 若 token 錯誤或過期,任何面板回 401 時會自動登出並重新要求輸入。

---

## 2. 頂部健康條(Health Strip)

登入後標題列下方的一排藥丸(pill)是全域速覽:

| 藥丸 | 意義 |
|------|------|
| **Local x/y** | chusMBp 本機服務健康數 |
| **ATung x/y** | ATung Mac 服務健康數(經 Tailscale 探測) |
| **Render x/y** | Render 外部服務健康數 |
| **AI x/y** | 未進入冷卻的 AI Provider 數 |
| **avg local / avg render …ms** | 健康服務的平均延遲 |
| **✓ All nominal / ⚠ Issues detected** | 全綠才顯示 nominal |

- 自動每 **10 秒**刷新一次;按鍵盤 **`R`** 立即刷新(游標不在輸入框時)。
- 右上 **↺ Refresh** 按鈕同樣立即刷新。標題列會顯示「updated Xs ago」。

**延遲顏色**:`<100ms` 綠 · `100–400ms` 黃 · `>400ms` 紅。數字旁的
`↑ / ↓` 是與上次相比變化超過 10ms 的趨勢箭頭。

---

## 3. Local Services(chusMBp)

chusMBp 上以 launchd 常駐的 5 個服務(Relationship OS、Proxy、AI Learning、
AI PM、Voice Trainer)。每張卡顯示:狀態燈、`:port`、HTTP 狀態、延遲+趨勢。

- **Restart**:點 Restart → 出現「Sure?」二次確認 → ✓ 才真的重啟
  (`launchctl kickstart`)。只有白名單內的 5 個 label 可被重啟。重啟後 2 秒自動刷新。
- **ATung Syncthing** 卡:顯示與 ATung Mac 的同步狀態(connected / 完成百分比 /
  待同步 MB)。斷線時提示「check ATung watchdog」。

> 狀態燈:🟢 healthy(<400 回應)· 🔴 unhealthy / 無回應 · 🔵 查詢中。

---

## 4. ATung Mac Services

ATung Mac 上、經 Tailscale 探測的服務(如 Warehouse Scanner)。唯讀,不提供重啟
按鈕(跨機重啟請 SSH 進 ATung Mac)。右側 **ATung** 標記來源。

---

## 5. Render Services(外部)

8 個 Render 外部服務。整張卡可點擊 → 於新分頁開啟該服務。

- 右側 **UP ↗ / DOWN** 徽章來自即時探測。
- **⚠ N deploy 失敗**:來自 Render API 的**權威部署狀態**(非探測),只有真的有
  failed/canceled 部署時才紅字顯示,滑鼠移上去看是哪些服務。
- **cached Xs ago · auto-refresh 60s**:探測結果有快取,最多每 60 秒向上游打一次
  (避免變成 24/7 keepalive 燒 Render 免費時數)。**↺ Now** 可強制立即刷新。
- 授權/停權等權威狀態每 **5 分鐘**由 Render API 背景更新。

---

## 6. Render 用量(月配額)

Render 免費方案的真實天花板是 **每帳號(workspace)每月 750 小時**,由該帳號下
所有「醒著」的服務共用 — 不是每服務各自 750h。

- 每張卡 = 一個 workspace:已用時數 / 配額 · 百分比,含進度條與各服務時數 chip。
- 顏色分級:綠(安全)→ 黃 → 紅,門檻預設 **70 / 85 / 95%**,跨門檻會發 Telegram 告警。
- 時數來自 Render API metrics 累積的**真實醒著秒數**(24/7 背景累積,零 keepalive)。
- **⚙ 設定**:可調整每帳號月配額(h)與告警門檻(%,逗號分隔),即時儲存生效。

---

## 7. 外部資源用量(DB / 圖庫)

各專案的資料庫儲存量與 Cloudinary 額度。

- **DB**:Neon / CockroachDB。顯示已用 / 上限 · 百分比。特別狀態:
  - `未設定` — 該 DB 的 `DATABASE_URL` 尚未入 Vault。
  - `N/A` — CockroachDB 無法用 SQL 查 size。
  - `compute 耗盡` — Neon 月 compute 配額用光,**app 連不上 DB(非儲存問題)**。
  - `讀取失敗` — 連線錯誤(滑鼠移上看訊息)。
- **Cloudinary**:warehouse 圖庫的 credits / storage / bandwidth。
- 門檻同 Render 設定;每 **6 小時**輪詢一次,**↺ Now** 可強制刷新。

---

## 8. 專案總覽

所有非封存專案的卡片(名稱、Render UP/DOWN、狀態徽章、描述、使用手冊摘要),
方便一眼對照哪個專案對應哪個線上服務。

---

## 9. AI Providers

各 AI Provider(Groq / Cerebras / NVIDIA / Mistral / OpenRouter / Qwen3…)的狀態:

- 🟢 ready / 🟡 cooling — 冷卻中會顯示「cooling until HH:MM:SS」(429 或錯誤後
  預設冷卻 60 秒)。
- 成功/失敗統計 `12✓ 1✗`,以及最後使用時間。
- 目前使用的 model ID(monospace 顯示)。

---

## 10. API Key Vault

集中管理所有專案的 API Key,支援加密儲存。

- **加密**:設定 `VAULT_KEY` 環境變數後值會加密;未設定會顯示
  「⚠️ VAULT_KEY 未設定,值不加密」。
- **搜尋 / 篩選**:可依 Key 名稱、說明搜尋,或按專案篩選。Key 依專案分組、可折疊。
- **每列操作**:
  - `⎘` 複製值到剪貼簿 · `○/●` 顯示/隱藏值 · **編輯** · **刪除**(二次確認)。
- **到期提醒**:設了到期日的 Key 會依剩餘天數上色 — 過期(紅)/ ≤3天 / ≤7天 /
  ≤30天,整列也會變色提示輪換。
- **+ 新增 Key**:名稱、說明、專案、到期日(選填)、值(選填,編輯時留空=不變)。

### 🤖 分析更新 → ⚡ 自動優化(AI 自動化)

1. 點 **🤖 分析更新**:AI Agent 串流分析各 AI 服務目前用的 model 是否該升級。
2. 分析完出現 **⚡ 自動優化**:AI 產出建議變更清單(service / provider /
   舊 model → 新 model / 原因)。
3. **預覽確認**:清單只是預覽,按 **✅ 確認套用**才真的改對應專案的原始碼並重啟;
   若改到的是 AI PM 自己,會自我重啟。可隨時 **✗ 取消**。

> 這是會實際改動其他專案程式碼的操作 — 套用前務必看清楚 preview。

---

## 11. Watchdog(chusMBp)

顯示 chusMBp watchdog 最近 3 行日誌(最新在上、較舊淡化),每行含台北時間與相對時間。

- 右上 **心跳 Xm 前**:watchdog.sh 每輪寫入的自監控心跳。超過 **12 分鐘**沒更新
  會 🔴 紅字 — 代表 watchdog 本身可能掛了,需人工介入。

---

## 12. Morning Digest

每日 **09:00(台北)**自動發送的晨間摘要。

- 顯示下次發送倒數與上次發送時間(台北時間)。
- **↑ Now**:立即發送一次(用於測試或補發)。

---

## 13. 全系統稽核

點 **▶ 執行稽核**,串流執行全系統稽核腳本(`audit.sh`),即時顯示步驟與輸出 —
用於一次性檢查所有服務/密鑰/部署的健全性。

---

## 附錄 A — 刷新節奏一覽

| 資料 | 節奏 | 手動強制 |
|------|------|----------|
| 服務健康 / 本頁整體 | 每 10s(或按 `R`) | ↺ Refresh |
| Render 探測快取 | ≤ 1 次/60s | ↺ Now |
| Render 權威狀態(停權/部署/用量) | 每 5 分鐘 | — |
| DB 用量 | 每 6 小時 | ↺ Now |
| Cloudinary 用量 | 每 1 小時 | ↺ Now |
| Morning Digest | 每日 09:00 台北 | ↑ Now |

## 附錄 B — 顏色速查

- **狀態燈**:🟢 健康 · 🔴 異常/無回應 · 🟡 冷卻/警告 · 🔵 查詢中。
- **延遲**:綠 `<100ms` · 黃 `100–400ms` · 紅 `>400ms`。
- **用量分級**:綠(<70%)· 黃(70–95%)· 紅(≥95%,或 compute/讀取異常)。
- **Key 到期**:過期紅 · ≤3天 危險 · ≤7天 警告 · ≤30天 提醒。

## 附錄 C — 常見狀況

| 現象 | 可能原因 / 處置 |
|------|----------------|
| 整頁要求重新輸入 token | session 過期或 token 改了 → 重新輸入 `ADMIN_TOKEN` |
| 某本機服務 🔴 | 點 Restart(二次確認);仍紅則 SSH 進 chusMBp 查 log |
| Render 顯示 cached 很久以前 | 面板剛打開/閒置後屬正常,按 ↺ Now 強制刷新 |
| DB 顯示「compute 耗盡」 | Neon 月配額用光,是連線問題非儲存問題,需等月重置或升級 |
| Watchdog 心跳 🔴 | watchdog.sh 可能掛了 → SSH 進 chusMBp 重啟 watchdog |
| 「⚠ deploy 失敗」 | 到對應 Render dashboard 看該服務的部署日誌 |

---

*本說明對應 System Admin 現行版本;面板為即時資料驅動,實際數字以畫面為準。*
