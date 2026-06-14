# AI Project Manager — User Manual
# AI 專案管理 — 使用手冊
# مدير المشاريع الذكي — دليل المستخدم

**Version:** 2026-05-20 (rev 3)
**URL:** https://cancel-aneurism-uneven.ngrok-free.dev/pm
**Tailscale (local):** http://chus-macbook-pro-4.tailb03d65.ts.net:3004/

---

## Table of Contents / 目錄

1. [Overview 概覽](#overview)
2. [Quick Start ⚡ 快速建立](#quick-start)
3. [Dashboard 儀表板](#dashboard)
4. [Creating a Project 建立專案](#creating-a-project)
5. [Kanban Board 看板](#kanban-board)
6. [AI Assistant ✨](#ai-assistant)
7. [Morning Digest 早安摘要](#morning-digest)
8. [Notes 筆記](#notes)
9. [Language Selector 語言切換 / اختيار اللغة](#language)
10. [Tips & Shortcuts 技巧](#tips)
11. [SOP & Troubleshooting](#sop)

---

## Overview

AI Project Manager is a personal project + task management tool with deep AI integration. Manage multiple projects on a drag-and-drop Kanban board and use 5 AI tools (plan generation, standup, risk analysis, weekly report, meeting notes parsing) powered by 3 parallel models. Every morning at 09:00 Taipei time a digest is automatically sent to your Telegram.

AI 專案管理是個人專案與任務管理工具，深度整合 AI。可在拖曳式看板上管理多個專案，並使用 5 種 AI 工具，每天早上 09:00 自動發送 Telegram 摘要。

مدير المشاريع الذكي هو أداة شخصية لإدارة المشاريع والمهام مع تكامل عميق مع الذكاء الاصطناعي. أدِر مشاريع متعددة على لوحة Kanban بالسحب والإفلات، واستخدم 5 أدوات ذكاء اصطناعي مدعومة بـ 3 نماذج متوازية. يُرسَل ملخص يومي إلى Telegram كل صباح الساعة 09:00 بتوقيت تايبيه.

---

## Quick Start

> **⚡ The fastest way to create a project with a full AI-generated task plan.**

### Steps / 步驟

1. Go to the **Dashboard** 前往儀表板
2. Find the Quick Start bar below the Dashboard title
3. Type your project title 輸入專案名稱
4. Press **Enter** 按 Enter

That's it. AI will:
- Create the project
- Generate 8–15 tasks covering the full project lifecycle
- Bulk-add all tasks to the Kanban board
- Redirect you directly to the board

**Status messages / 狀態訊息:**
| Message | Meaning |
|---------|---------|
| `⏳ AI is building your plan…` | AI generating tasks (10–30s) |
| `✅ Created with N tasks — opening board` | Done, redirecting |
| `❌ Failed — try again` | Network or AI error, try again |

**Tips:**
- Be specific: `"iOS App — User Authentication Flow"` gets better tasks than `"App"`
- Generated tasks land in **To Do** column, ordered by project lifecycle

---

## Dashboard

The home screen. Shows a live overview of all your projects.

### Stats Cards / 統計卡片

| Card | What it shows |
|------|--------------|
| Active Projects | Projects with status = Active |
| Tasks In Progress | Tasks currently being worked on |
| Blocked | Tasks marked as Blocked |
| Overdue | Tasks past their due date (not done) |
| Done | Completed tasks across all projects |
| Completed Projects | Projects with status = Completed |

### Due This Week / 本週到期

Projects with a due date within the next 7 days appear here as a quick-glance list.

### AI Insights (Global) / 全域 AI 洞察

Two buttons that analyze **all** projects at once:
- **📊 Weekly Report** — Generates a professional status report across every project
- **⚠️ Risk Scan** — Surfaces blocked/overdue tasks and recommends actions

---

## Creating a Project

### Option A: Quick Start ⚡ (Recommended)
Type a title in the Quick Start bar → press Enter.

### Option B: Full Form (More control)

Click **+ New Project** (top-right of dashboard or sidebar).

| Field | Required | Notes |
|-------|----------|-------|
| Project Name | ✅ | Short, descriptive name |
| Goal | — | Used by AI for better plan generation |
| Description | — | Free-form context |
| Status | — | Active / Paused / Completed / Archived |
| Priority | — | Low / Medium / High / Urgent |
| Start Date | — | |
| Due Date | — | Used in AI plans and Overdue tracking |

**Tip:** Fill in **Goal** and **Due Date** before using Generate Plan — the AI uses both.

---

## Kanban Board

Five columns:

| Column | Status | Meaning |
|--------|--------|---------|
| To Do | `todo` | Not started |
| In Progress | `in_progress` | Actively being worked on |
| Review | `review` | Waiting for review/QA |
| Done | `done` | Completed |
| Blocked | `blocked` | Waiting on something external |

### Drag & Drop
Drag any task card between columns to update its status instantly.

### Quick-Done Checkbox ☑
Each task card has a circle checkbox in the top-left corner:
- Click once → marks as **Done** (strikethrough + dimmed)
- Click again → returns to **To Do**

### Task Card Fields

| Field | Notes |
|-------|-------|
| Title | Action-verb summary |
| Priority | 🔴 Urgent 🟠 High 🟡 Medium ⚪ Low |
| Estimated hours | Shows `Xh` on card |
| Actual hours | Shows `Xh ✓` (green) when task is Done |
| Due date | Shown on card if set |
| Assignee | Name or @handle |

### Adding a Task Manually

Click **+ Add task** below any column → fill in the Task Form → click **+ Add Task**.

### AI Estimate 🤖

Inside the Task Form, click **AI Estimate** to get:
- Estimated hours + confidence level + rationale + suggested subtasks
- Click **Use** to apply the estimate

---

## AI Assistant

Click **✨ AI Assistant** (top-right of any project). Five tabs:

### 📋 Generate Plan

Generates 8–15 tasks as a JSON plan. Optional: Team Size, Due Date.

Click **▶ Run** → preview tasks → **Apply to Board** to add them all.

> **Note:** Quick Start does this automatically. Use Generate Plan when you want to preview before applying, or regenerate a better plan.

### 📣 Standup

One click → AI writes a daily standup:
- ✅ Yesterday (done tasks)
- 🔄 Today (in-progress tasks)
- 🚧 Blockers
- Overall status: On Track / At Risk / Delayed

Copy and paste directly to Slack, Telegram, email, etc.

### ⚠️ Risk Analysis

AI analyzes blocked/overdue tasks and outputs:
- Risk Level (Low / Medium / High / Critical)
- Top 3 specific risks with impact
- Immediate actions (3–5 concrete steps)
- Timeline assessment

### 📊 Weekly Report

Generates a professional status report for **this project**. For all projects, use the global AI Insights on the Dashboard.

### 📝 Parse Notes

Paste raw meeting notes → AI extracts all action items as tasks.

1. Paste meeting notes in the text area
2. Click **▶ Run**
3. AI identifies action items → task list with count badge
4. Click **Apply to Board** → tasks added to Kanban

The original notes are also saved as a Note entry.

---

## Morning Digest

Every day at **09:00 Taipei time**, a project digest is automatically sent to your Telegram.

### What's included

- One section per active project (max 3 bullets each)
- ⚠️ prefix for blocked items, 🔴 for overdue
- A single "🎯 Today's focus:" line across all projects

### Manual trigger

If you want an immediate digest (e.g., to test or catch up):
```
ssh chusMBp "curl http://localhost:3004/pm/api/ai/digest/now"
```

### Fallback behavior

If all 3 AI providers are unavailable, the digest still sends — using a plain bullet summary of task counts instead of AI-generated text. You always get something.

### Check last digest time

```
curl http://localhost:3004/pm/api/status
```
Returns `lastDigestAt` with the ISO timestamp of the last successful send.

---

## Notes

At the bottom of each project page. Free-form text — meeting summaries, decisions, links.

- Type in the notes box
- Press **Enter** to save (Shift+Enter for a new line)

Notes created by Parse Notes automatically include extracted action items in their metadata.

---

## Language Selector

Bottom of the sidebar: three-button selector — **EN | 繁中 | ع** — switches the entire UI instantly. Preference saved to localStorage and restored on next visit.

| Button | Language | Direction |
|--------|----------|-----------|
| **EN** | English | LTR |
| **繁中** | Traditional Chinese (Taiwan) | LTR |
| **ع** | Arabic (UAE) | RTL — full right-to-left layout |

The active language is highlighted in blue. Arabic mode automatically flips the layout to RTL (`dir="rtl"`) so the sidebar appears on the right and text flows naturally.

底部語言選擇器：**EN \| 繁中 \| ع** 三個按鈕，點擊即切換整個介面，偏好儲存於 localStorage。

زر اختيار اللغة في أسفل الشريط الجانبي: **EN \| 繁中 \| ع** — يُبدّل واجهة المستخدم بالكامل فوراً. تُحفظ التفضيلات في localStorage وتُستعاد عند الزيارة التالية. وضع العربية يقلب التخطيط تلقائياً إلى اليمين لليسار.

---

## Tips

### Getting better AI plans
- Specific titles: `"React Dashboard — Data Visualization Module"` > `"Dashboard"`
- Fill in Goal: `"Ship MVP to 50 beta users by June 30"` gives AI concrete constraints
- Add Due Date: AI back-calculates per-task deadlines automatically

### Fastest workflow for a new project
```
Quick Start bar → type title → Enter → board opens → done
```
Total: ~20 seconds including AI generation time.

### Regenerating a plan
Open **✨ AI Assistant → 📋 Generate Plan**, adjust inputs, click Run, then Apply to Board. Old tasks stay; new ones are added.

### Keyboard shortcuts
| Key | Action |
|-----|--------|
| **Enter** in Quick Start bar | Submit |
| **Enter** in Notes | Save note |
| **Shift+Enter** | Newline within a note |
| **Escape** | Close task form / AI panel |

---

## AI Models

All AI features run 3 models in parallel. The best response is synthesized from whichever models reply within 13 seconds. Typically 2–3 models contribute.

| Model | Provider | Timeout |
|-------|----------|---------|
| Llama 3.3-70B | Groq LPU | 8s |
| GPT-OSS 120B | Cerebras wafer | 11s |
| Qwen3-32B | Groq LPU | 10s |

> NVIDIA NIM and OpenRouter removed — consistently timed out in practice.

---

## SOP & Troubleshooting

### Auto-healing (built-in, no action needed)

| What breaks | Auto-fix |
|-------------|----------|
| Service crashes | `KeepAlive: true` in LaunchAgent — auto-restarts |
| AI provider timeout | `multiGenerate()` races all 3, falls back sequentially |
| All AI providers fail | Morning digest sends plain bullet summary instead |
| JSON write interrupted | Atomic writes (`.tmp` → rename) — original file never corrupted |
| Async exception | `unhandledRejection` handler logs to error file — doesn't silently die |

### Manual SOP

**Service not responding:**
```bash
# Check log
ssh chusMBp "tail -50 /tmp/ai-project-manager.log"
ssh chusMBp "tail -20 /tmp/ai-project-manager.err"

# Restart
ssh chusMBp "launchctl kickstart -k gui/501/com.ai-project-manager.dev"
```

**Test AI is working:**
```bash
ssh chusMBp "curl http://localhost:3004/pm/api/status"
```

**Test digest manually:**
```bash
ssh chusMBp "curl http://localhost:3004/pm/api/ai/digest/now"
```

**Data file corrupted:**
```bash
# If projects.json is broken, restore from last atomic write:
ssh chusMBp "ls -la ~/CloudSync/ai-project-manager/data/"
# If *.tmp exists, the rename failed — copy .tmp → .json to recover
```

**Digest not arriving at 09:00:**
```bash
# Check schedule was logged at startup
ssh chusMBp "grep '\[digest\]' /tmp/ai-project-manager.log | tail -5"
# Expected: [digest] next run: 09:00 Taipei (in Xh Xm)
```

### Common symptoms

| Symptom | Cause | Fix |
|---------|-------|-----|
| Quick Start shows ❌ | Network error or AI timeout | Wait a few seconds and try again |
| Generate Plan produces no tasks | JSON parse error from AI | Retry; rephrase title if it keeps failing |
| Drag & drop doesn't work | Browser compatibility | Use Chrome or Safari |
| Page loads blank | Build cache issue | Hard refresh (Cmd+Shift+R) |
| AI panel shows "Error" | All providers timed out | Try again in 30s |
| No morning Telegram | BOT_TOKEN missing or all AI failed | Check `[digest]` lines in log |

---

*Updated 2026-05-20 rev 3 · AI Project Manager · Languages: EN / 繁中 / عربي*
