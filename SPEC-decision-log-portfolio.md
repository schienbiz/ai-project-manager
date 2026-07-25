# SPEC — Decision Log × Portfolio Domain (合併規格 v1)

> 把 AI PM 從「專案執行工具」變成「判斷力作業系統」的第一根槓桿。
> 範圍嚴格鎖定第 1 項（決策日誌持久化）+ 第 2 項（Life/Business 組合分野）。
> **不含** RAG、embeddings、模板引擎、知識庫——那是第 3-5 項,本規格刻意不碰。

---

## 0. 核心設計決定：`domain` 是脊椎

兩項功能能「合併」的唯一理由:它們共用同一個組合維度。

- `domain ENUM('life','business')` — 加在 **projects 和 decisions 兩張表**。
- `category TEXT` — 二級分類,自由文字但前端給預設:
  - life → 健康 / 家庭 / 學習 / 人脈
  - business → 餐飲 / 杜拜公司 / 美國市場 / 投資
- 一套分類法,兩個實體。結果:`SELECT * FROM decisions WHERE domain='business' AND category='投資'` →「我所有投資決策,以及它們後來怎麼了」。這句 SQL 就是整個願景的價值。

---

## 1. 資料模型

### 1a. projects 加兩欄（第 2 項）
```sql
ALTER TABLE projects ADD COLUMN IF NOT EXISTS domain   TEXT;  -- 'life' | 'business' | NULL(未分類)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT '';
```
- **NULL 是合法狀態**（現有 4 個專案不強迫歸類,行為完全不變）。
- 依現有慣例:idempotent `ADD COLUMN IF NOT EXISTS`,放進 `initDb()`。

### 1b. decisions 新表（第 1 項）
```sql
CREATE TABLE IF NOT EXISTS decisions (
  id            UUID PRIMARY KEY,
  project_id    UUID,                       -- NULLABLE：組合層/人生決策沒有專案
  domain        TEXT,                       -- 'life' | 'business' | NULL
  category      TEXT NOT NULL DEFAULT '',
  kind          TEXT NOT NULL,              -- 'decide' | 'frame'
  title         TEXT NOT NULL DEFAULT '',   -- 決策/請求原文（截斷 200 字當標題）
  input         TEXT NOT NULL DEFAULT '',   -- 完整輸入
  context       TEXT NOT NULL DEFAULT '',
  -- decide 三軸（原始分類,供日後校準,絕不能只存 markdown）
  impact        TEXT,                       -- high|medium|low
  reversibility TEXT,                       -- one-way|reversible
  urgency       TEXT,                       -- high|medium|low
  verdict       TEXT NOT NULL DEFAULT '',   -- 程式碼算出的判斷句
  assumptions   JSONB NOT NULL DEFAULT '[]',-- keyUnknowns（決策當下的假設 = 事後對帳的關鍵）
  analysis_md   TEXT NOT NULL DEFAULT '',   -- 完整 markdown（人看的）
  -- 學習迴圈（事後回填,整個功能的重點所在）
  outcome       TEXT,                       -- 'good' | 'bad' | 'mixed' | NULL(待驗)
  outcome_note  TEXT NOT NULL DEFAULT '',   -- 結果與學到什麼
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL,
  updated_at    TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS decisions_domain_idx  ON decisions (domain, category);
CREATE INDEX IF NOT EXISTS decisions_project_idx ON decisions (project_id);
CREATE INDEX IF NOT EXISTS decisions_outcome_idx ON decisions (outcome);
```

> ⚠️ 深審關鍵:**必須存原始三軸（impact/reversibility/urgency）與 assumptions,不能只存 analysis_md。** 只存 markdown = 一個更漂亮的 /decide,無法校準。存了三軸,v1.1 才能算「我判『不可逆+高影響』時後來對幾成」。

### 1c. row mapper
`rowToDecision(r)` 依現有 snake→camel 慣例新增。

---

## 2. 後端 endpoint 變更

### 2a. 改造 `/api/ai/decide` 與 `/api/ai/frame`
兩者現在 parse 出 `d` 物件 → 算 verdict → `streamPrebuilt`。在 stream **之前**插入一次 INSERT:

```js
// decide：JSON.parse 成功、算完 verdict 之後、streamPrebuilt 之前
const md = buildDecideMd(d, verdict, lang)
const decisionId = await persistDecision({
  projectId: req.body.projectId || null,
  domain:    req.body.domain || null,
  category:  req.body.category || '',
  kind: 'decide', title: decision.slice(0,200), input: decision, context: context||'',
  impact: d.impact, reversibility: d.reversibility, urgency: d.urgency,
  verdict, assumptions: d.keyUnknowns||[], analysisMd: md,
})   // await, 不 fire-and-forget（見 [[feedback_fire_and_forget_promise]]）
res.setHeader('X-Decision-Id', decisionId)   // stream body 不動,靠 header 回傳 id
return streamPrebuilt(res, md)
```
- **await 一次快速 INSERT**,不用 fire-and-forget;INSERT 失敗要看得見,不能靜默吞掉。
- id 走 response header,body 維持純 markdown stream（前端 `run()` 不用改解析邏輯）。
- frame 同理,存 kind='frame'、三軸留 NULL、verdict 存 recommendation。

### 2b. 新 CRUD endpoints
```
GET    /api/decisions?domain=&category=&outcome=&projectId=   列表（篩選）
GET    /api/decisions/:id                                     單筆
PUT    /api/decisions/:id/outcome  { outcome, outcomeNote }   回填結果（學習迴圈）
DELETE /api/decisions/:id
GET    /api/decisions/calibration?domain=                     v1.1 讀模型(見 §5)
```
- 沿用現有 admin auth middleware。
- `PUT .../outcome` 設 `reviewed_at = now()`。

---

## 3. 前端變更

### 3a. Project 分類（第 2 項)
`ProjectForm.jsx` 在 priority 附近加兩個 select:domain（人生/事業/未分類）、category（依 domain 動態換選項)。Dashboard/Sidebar 加 domain 分組或篩選 chip。

### 3b. 決策脫離專案（深審關鍵修正）
現在 decide/frame 只活在 `AIPanel.jsx`（專案內,吃 `project.goal`）。**組合層與人生決策沒有專案** → 新增頂層導覽 **「決策」** :
- 頂層開啟 → 顯示 domain/category 選擇器 + decide/frame 輸入,`projectId=null`。
- 專案內 AIPanel 開啟 → `projectId`、`domain`、`category` **自動繼承該專案**,使用者不必重填。
- 兩條路徑打同一組 endpoint。

### 3c. 決策日誌檢視
新頁 `DecisionLog.jsx`:
- 篩選列:domain / category / outcome(待驗/good/bad/mixed)。
- 卡片:標題、三軸標籤、verdict、建立日期、outcome 徽章。
- 展開:analysis_md + assumptions。
- **待驗超過 N 天** 的卡片高亮「該回填結果了」——這是驅動學習迴圈的推力(可接到既有 Telegram digest)。
- 卡片上「記錄結果」→ `PUT /outcome`。

---

## 4. 遷移與相容

1. `initDb()` 加三段 DDL,idempotent,不觸碰現有資料。
2. 現有 4 專案 domain=NULL,顯示為「未分類」,行為零變化。
3. 現有 decide/frame 使用者若不帶 domain/projectId → decisions 照存,domain=NULL。**功能只增不減。**
4. 無需 data 目錄 JSON 變更(decisions 純 DB)。

---

## 5. 學習迴圈 = 這功能存在的理由（v1.1 讀模型,schema 現在就備好）

`GET /api/decisions/calibration` 回:
```json
{
  "byReversibility": { "one-way": {"n":12,"good":9,"bad":2,"mixed":1},
                       "reversible": {"n":30,"good":25,"bad":3,"mixed":2} },
  "byImpact": { ... },
  "insight": "你在『不可逆』決策上命中率 75%，『可逆』83% — 慢一點的決策反而較差，可能是分析癱瘓。"
}
```
- 讀 outcome 已回填的決策 → 算命中率 → 這就是 meta 層的**系統思考**:不只做決策,還校準自己的決策器。
- v1 先把 schema 與回填流程做對;calibration 端點可留 v1.1,但**三軸欄位現在不存,以後就補不回來**。

---

## 6. 極致優化深入審視 — 這份規格必須守住的取捨

1. **只存 markdown = 失敗。** 必存原始三軸 + assumptions,否則永遠無法校準,退化成漂亮版 /decide。(§1b 已鎖)
2. **outcome 回填不是加分項,是主線。** 沒有結果追蹤的決策日誌只是唯讀歷史,達不到「累積決策資料庫」。回填的推力(§3c 高亮 + digest)要一起做,否則沒人會回填 → 迴圈斷。
3. **decide/frame 綁死專案是現有 bug 級限制。** 人生/投資/組合決策沒有專案;不修這點,決策日誌一開始就漏掉最重要的一半。(§3b)
4. **克制:不做 RAG/embedding/模板。** 一張表 + 3 endpoint + 2 前端頁。domain 是一個 nullable 欄位 + 一個 select。任何想順手做知識庫檢索的衝動,推到第 4 項。
5. **不可 fire-and-forget 那個 INSERT。** 一次同步 await,失敗要響;參 [[feedback_fire_and_forget_promise]]。
6. **id 走 header 不改 stream body。** 避免動到前端 `run()` 的串流解析,降風險。
7. **NULL 是一等公民。** 現有 4 專案、既有決策不強迫歸類;預設不改變任何現有行為 = 零回歸。

---

## 7. 工作量估計

| 項 | 檔案 | 估時 |
|---|---|---|
| 3 段 DDL + rowToDecision | server/index.js initDb | 0.5h |
| persistDecision + 改 decide/frame | server/index.js | 1h |
| decisions CRUD + outcome endpoints | server/index.js | 1.5h |
| ProjectForm domain/category | ProjectForm.jsx, i18n | 1h |
| 頂層「決策」入口 + AIPanel 繼承 | AIPanel.jsx, App.jsx | 1.5h |
| DecisionLog.jsx 檢視 + 回填 | 新檔, i18n | 2.5h |
| calibration 讀模型 (v1.1,可延) | server/index.js | 1h |
| **合計 v1(不含 calibration)** | | **~8h** |
