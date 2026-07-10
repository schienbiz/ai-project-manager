// In-app quick reference for System Admin. Full detail lives in ADMIN_GUIDE.md.
// Rendered as native JSX (no markdown dep) reusing existing admin CSS classes.

const PANELS = [
  ['Local Services (chusMBp)', 'chusMBp launchd 常駐服務。Restart 需二次確認才重啟。'],
  ['ATung Mac Services', 'ATung Mac 服務(Tailscale 探測),唯讀。'],
  ['Render Services', '外部服務,點卡開啟。⚠ deploy 失敗=權威部署狀態;↺ Now 強制刷新。'],
  ['Render 用量', '每帳號 750h/月共用池;⚙ 設定調配額與 70/85/95% 告警門檻。'],
  ['外部資源用量', 'Neon/CockroachDB 儲存 + Cloudinary 額度;每 6h 輪詢。'],
  ['專案總覽', '非封存專案卡,對照專案 ↔ 線上服務。'],
  ['AI Providers', '各 Provider 狀態;冷卻中顯示恢復時間(429 後預設 60s)。'],
  ['API Key Vault', '集中管理 Key;可搜尋/顯示/複製/編輯/刪除;到期自動上色。'],
  ['🤖 分析更新 → ⚡ 自動優化', 'AI 分析各服務 model 是否該升級;preview 後「確認套用」才改碼並重啟。'],
  ['Watchdog', 'chusMBp watchdog 日誌;心跳 >12min 沒更新=🔴 可能掛了。'],
  ['Morning Digest', '每日 09:00 台北自動發送;↑ Now 立即補發。'],
  ['全系統稽核', '執行 audit.sh,串流檢查全系統健全性。'],
]

const LEGEND = [
  ['狀態燈', '🟢 健康 · 🔴 異常/無回應 · 🟡 冷卻/警告 · 🔵 查詢中'],
  ['延遲', '綠 <100ms · 黃 100–400ms · 紅 >400ms'],
  ['用量分級', '綠 <70% · 黃 70–95% · 紅 ≥95% 或 compute/讀取異常'],
  ['Key 到期', '過期紅 · ≤3天危險 · ≤7天警告 · ≤30天提醒'],
]

const CADENCE = [
  ['本頁整體', '每 10s(隱藏分頁暫停;或按 R)'],
  ['Render 探測', '≤1 次/60s · 30min 無互動衰減至 20min · ↺ Now'],
  ['Render 權威狀態', '每 5 分鐘'],
  ['DB 用量', '每 6 小時 · ↺ Now'],
  ['Cloudinary', '每 1 小時 · ↺ Now'],
]

export default function AdminHelp({ onClose }) {
  return (
    <section className="admin-section admin-help">
      <div className="admin-section-hdr">
        <span className="admin-section-title">❓ System Admin 使用說明</span>
        <button className="btn btn-sm" onClick={onClose}>✕ 關閉</button>
      </div>

      <div className="admin-info-card admin-help-body">
        <p className="admin-help-lead">
          此頁是個人基礎設施的監控中心。資料多來自 Render API / DB / Cloudinary / launchd 等
          <strong>權威來源</strong> — 畫面與印象不符時以此頁為準。完整說明見專案根目錄
          <code>ADMIN_GUIDE.md</code>。
        </p>

        <div className="admin-help-grid">
          <div>
            <div className="admin-help-h">面板速覽</div>
            {PANELS.map(([t, d]) => (
              <div key={t} className="admin-help-row">
                <span className="admin-help-k">{t}</span>
                <span className="admin-help-v">{d}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="admin-help-h">顏色速查</div>
            {LEGEND.map(([t, d]) => (
              <div key={t} className="admin-help-row">
                <span className="admin-help-k">{t}</span>
                <span className="admin-help-v">{d}</span>
              </div>
            ))}

            <div className="admin-help-h" style={{ marginTop: 12 }}>刷新節奏</div>
            {CADENCE.map(([t, d]) => (
              <div key={t} className="admin-help-row">
                <span className="admin-help-k">{t}</span>
                <span className="admin-help-v">{d}</span>
              </div>
            ))}

            <div className="admin-help-h" style={{ marginTop: 12 }}>快速操作</div>
            <div className="admin-help-row"><span className="admin-help-k"><kbd>R</kbd></span><span className="admin-help-v">立即刷新(游標不在輸入框時)</span></div>
            <div className="admin-help-row"><span className="admin-help-k">↺ Now</span><span className="admin-help-v">各面板強制刷新該資料</span></div>
            <div className="admin-help-row"><span className="admin-help-k">Restart</span><span className="admin-help-v">點兩次(Sure?)才真的重啟</span></div>
          </div>
        </div>
      </div>
    </section>
  )
}
