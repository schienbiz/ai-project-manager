import { createContext, useContext } from 'react'

export const LangContext = createContext({ lang: 'en', setLang: () => {} })
export const useLang = () => useContext(LangContext)

export const T = {
  en: {
    // App / shared
    appName:      'AI Project Manager',
    loading:      'Loading…',
    langToggle:   '中文',
    dateLocale:   'en-US',

    // Sidebar
    dashboard:    'Dashboard',
    active:       'Active',
    other:        'Other',
    noProjects:   'No projects yet',
    newProject:   '+ New Project',

    // Dashboard stats
    activeProjects:    'Active Projects',
    tasksInProgress:   'Tasks In Progress',
    blocked:           'Blocked',
    overdue:           'Overdue',
    done:              'Done',
    completedProjects: 'Completed Projects',
    ofTotal:      (n) => `of ${n} total`,
    dueThisWeek:  'Due This Week',
    allProjects:  'All Projects',
    noProjectsMsg:'No projects yet. Create one to get started.',

    // Project / task counts
    taskCount:    (done, total, pct) => `${done}/${total} tasks · ${pct}%`,
    taskCountPlain:(n) => `${n} tasks`,
    pct:          (p) => `${p}%`,

    // Project form
    editProject:   'Edit Project',
    newProjectTitle:'New Project',
    projectNameLabel:'Project Name *',
    goalLabel:     'Goal',
    descriptionLabel:'Description',
    statusLabel:   'Status',
    priorityLabel: 'Priority',
    startDateLabel:'Start Date',
    dueDateLabel:  'Due Date',
    cancel:        'Cancel',
    saveChanges:   'Save Changes',
    createProject: 'Create Project',
    saving:        'Saving…',

    statusActive:    'Active',
    statusPaused:    'Paused',
    statusCompleted: 'Completed',
    statusArchived:  'Archived',

    priorityLow:    'Low',
    priorityMedium: 'Medium',
    priorityHigh:   'High',
    priorityUrgent: 'Urgent',

    projectNamePlaceholder: 'e.g. Mobile App Redesign',
    goalPlaceholder:        'What does success look like?',
    descPlaceholder:        'Brief description of the project…',

    // Task form
    editTask:  'Edit Task',
    newTask:   'New Task',
    titleLabel:'Title *',
    estHours:  'Estimated Hours',
    actHours:  'Actual Hours',
    assignee:  'Assignee',
    addTask:   'Add Task',

    statusTodo:       'To Do',
    statusInProgress: 'In Progress',
    statusReview:     'Review',
    statusDone:       'Done',
    statusBlocked:    'Blocked',

    taskTitlePlaceholder:'e.g. Design login screen',
    taskDescPlaceholder: 'Details, acceptance criteria, notes…',
    estHoursPlaceholder: 'e.g. 4',
    actHoursPlaceholder: 'filled when done',
    assigneePlaceholder: 'Name or @handle',

    // Project detail / Kanban
    aiAssistant:  '✨ AI Assistant',
    edit:         'Edit',
    delete:       'Delete',
    due:          'Due',
    addTaskBtn:   '+ Add task',
    deleteConfirm:'Delete this project and all its tasks?',

    colTodo:       'To Do',
    colInProgress: 'In Progress',
    colReview:     'Review',
    colDone:       'Done',
    colBlocked:    'Blocked',

    // AI panel
    aiPanelTitle:   (name) => `✨ AI Assistant — ${name}`,
    tabPlan:        '📋 Generate Plan',
    tabStandup:     '📣 Standup',
    tabRisks:       '⚠️ Risks',
    tabReport:      '📊 Weekly Report',
    tabNotes:       '📝 Parse Notes',
    teamSizeLabel:  'Team Size',
    dueDateLabel2:  'Due Date',
    run:            '▶ Run',
    thinking:       '⏳ Thinking…',
    pasteNotesLabel:'Paste Meeting Notes',
    standupInfo:    (done, ip, bl) => `Generates a standup based on current task status (${done} done, ${ip} in progress, ${bl} blocked).`,
    risksInfo:      (bl, od) => `Analyzes ${bl} blocked and ${od} overdue tasks to identify risks.`,
    tasksReady:     (n) => `✅ ${n} tasks ready to apply`,
    applyToBoard:   'Apply to Board',
    applying:       'Applying…',
    more:           (n) => `+${n} more`,
    poweredBy:      'Powered by Groq · Cerebras',
    close:          'Close',
    appliedMsg:     (n) => `\n\n✅ Applied ${n} tasks to the board.`,

    phPlan:    'AI will generate a full task breakdown for this project. Adjust team size and due date for better results.',
    phStandup: 'AI will write a daily standup based on your current task status.',
    phRisks:   'AI will analyze your blocked and overdue tasks to surface risks and recommend actions.',
    phReport:  'AI will generate a professional weekly status report covering all your projects.',
    phNotes:   'Paste meeting notes above and AI will extract all action items as tasks.',
    teamSizePlaceholder:  'e.g. 3 engineers',
    notesPastePlaceholder:'Paste your meeting notes here. AI will extract all action items as tasks.',
    allProjectsReportInfo: (n) => `Generating weekly report across all ${n} projects.`,

    // Task quick-done
    quickDoneLabel:   'Mark done',
    quickReopenLabel: 'Reopen',

    // AI Estimate
    aiEstimate:     'AI Estimate',
    estimating:     'Estimating…',
    acceptEstimate: 'Use',

    // Quick Start
    quickStartPlaceholder: '⚡ Quick start — type a project title and press Enter',
    quickStartGenerating:  '⏳ AI is building your plan…',
    quickStartDone:        (n) => `✅ Created with ${n} tasks — opening board`,
    quickStartFailed:      '❌ Failed — try again',
    aiError:               'Error: ',
    translateBtn:          '✨ Translate to English',

    // Global AI Insights (Dashboard)
    globalAiInsights:  'AI Insights',
    allProjectsReport: '📊 Weekly Report',
    allProjectsRisks:  '⚠️ Risk Scan',

    // Notes section
    notesTitle:       'Notes',
    notesPlaceholder: 'Write a note… (Shift+Enter for new line, Enter to save)',
    notesEmpty:       'No notes yet. Write something.',
    noteSave:         'Save',
    noteDelete:       'Delete',
  },

  ar: {
    // App / shared
    appName:      'مدير المشاريع الذكي',
    loading:      'جاري التحميل…',
    dateLocale:   'ar-AE',

    // Sidebar
    dashboard:  'لوحة التحكم',
    active:     'نشطة',
    other:      'أخرى',
    noProjects: 'لا توجد مشاريع بعد',
    newProject: '+ مشروع جديد',

    // Dashboard stats
    activeProjects:    'المشاريع النشطة',
    tasksInProgress:   'المهام الجارية',
    blocked:           'محجوب',
    overdue:           'متأخر',
    done:              'مكتمل',
    completedProjects: 'المشاريع المكتملة',
    ofTotal:      (n) => `من أصل ${n}`,
    dueThisWeek:  'مستحق هذا الأسبوع',
    allProjects:  'جميع المشاريع',
    noProjectsMsg:'لا توجد مشاريع بعد. أنشئ أولاً.',

    taskCount:    (done, total, pct) => `${done}/${total} مهام · ${pct}%`,
    taskCountPlain:(n) => `${n} مهام`,
    pct:          (p) => `${p}%`,

    // Project form
    editProject:    'تعديل المشروع',
    newProjectTitle:'مشروع جديد',
    projectNameLabel:'اسم المشروع *',
    goalLabel:      'الهدف',
    descriptionLabel:'الوصف',
    statusLabel:    'الحالة',
    priorityLabel:  'الأولوية',
    startDateLabel: 'تاريخ البدء',
    dueDateLabel:   'تاريخ الانتهاء',
    cancel:         'إلغاء',
    saveChanges:    'حفظ التغييرات',
    createProject:  'إنشاء المشروع',
    saving:         'جاري الحفظ…',

    statusActive:    'نشط',
    statusPaused:    'متوقف',
    statusCompleted: 'مكتمل',
    statusArchived:  'مؤرشف',

    priorityLow:    'منخفض',
    priorityMedium: 'متوسط',
    priorityHigh:   'مرتفع',
    priorityUrgent: 'عاجل',

    projectNamePlaceholder: 'مثال: تصميم التطبيق',
    goalPlaceholder:        'كيف يبدو النجاح؟',
    descPlaceholder:        'وصف موجز للمشروع…',

    // Task form
    editTask:  'تعديل المهمة',
    newTask:   'مهمة جديدة',
    titleLabel:'العنوان *',
    estHours:  'الساعات المقدرة',
    actHours:  'الساعات الفعلية',
    assignee:  'المسؤول',
    addTask:   'إضافة مهمة',

    statusTodo:       'قيد الانتظار',
    statusInProgress: 'جارٍ',
    statusReview:     'مراجعة',
    statusDone:       'مكتمل',
    statusBlocked:    'محجوب',

    taskTitlePlaceholder:'مثال: تصميم شاشة الدخول',
    taskDescPlaceholder: 'التفاصيل ومعايير القبول والملاحظات…',
    estHoursPlaceholder: 'مثال: 4',
    actHoursPlaceholder: 'يُملأ عند الإنجاز',
    assigneePlaceholder: 'الاسم أو @handle',

    // Project detail / Kanban
    aiAssistant:  '✨ المساعد الذكي',
    edit:         'تعديل',
    delete:       'حذف',
    due:          'الاستحقاق',
    addTaskBtn:   '+ إضافة مهمة',
    deleteConfirm:'هل تريد حذف هذا المشروع وجميع مهامه؟',

    colTodo:       'قيد الانتظار',
    colInProgress: 'جارٍ',
    colReview:     'مراجعة',
    colDone:       'مكتمل',
    colBlocked:    'محجوب',

    // AI panel
    aiPanelTitle:   (name) => `✨ المساعد الذكي — ${name}`,
    tabPlan:        '📋 إنشاء خطة',
    tabStandup:     '📣 الاجتماع اليومي',
    tabRisks:       '⚠️ المخاطر',
    tabReport:      '📊 التقرير الأسبوعي',
    tabNotes:       '📝 تحليل المحاضر',
    teamSizeLabel:  'حجم الفريق',
    dueDateLabel2:  'تاريخ الانتهاء',
    run:            '▶ تشغيل',
    thinking:       '⏳ جاري التفكير…',
    pasteNotesLabel:'الصق محاضر الاجتماع',
    standupInfo:    (done, ip, bl) => `يُنشئ اجتماع يومي بناءً على حالة المهام (${done} مكتمل، ${ip} جارٍ، ${bl} محجوب).`,
    risksInfo:      (bl, od) => `يحلل ${bl} مهمة محجوبة و${od} مهمة متأخرة لتحديد المخاطر.`,
    tasksReady:     (n) => `✅ ${n} مهام جاهزة للتطبيق`,
    applyToBoard:   'تطبيق على اللوحة',
    applying:       'جاري التطبيق…',
    more:           (n) => `+${n} المزيد`,
    poweredBy:      'مدعوم بـ Groq · Cerebras',
    close:          'إغلاق',
    appliedMsg:     (n) => `\n\n✅ تم تطبيق ${n} مهام على اللوحة.`,

    phPlan:    'سيُنشئ الذكاء الاصطناعي تقسيم مهام كامل لهذا المشروع. اضبط حجم الفريق وتاريخ الانتهاء للحصول على نتائج أفضل.',
    phStandup: 'سيكتب الذكاء الاصطناعي اجتماعاً يومياً بناءً على حالة مهامك الحالية.',
    phRisks:   'سيحلل الذكاء الاصطناعي المهام المحجوبة والمتأخرة للكشف عن المخاطر وتقديم التوصيات.',
    phReport:  'سيُنشئ الذكاء الاصطناعي تقريراً أسبوعياً احترافياً يشمل جميع مشاريعك.',
    phNotes:   'الصق محاضر الاجتماع أعلاه وسيستخرج الذكاء الاصطناعي جميع بنود العمل كمهام.',
    teamSizePlaceholder:  'مثال: 3 مهندسين',
    notesPastePlaceholder:'الصق محاضر اجتماعك هنا. سيستخرج الذكاء الاصطناعي جميع بنود العمل كمهام.',
    allProjectsReportInfo: (n) => `جاري إنشاء تقرير أسبوعي لجميع المشاريع الـ ${n}.`,

    // Task quick-done
    quickDoneLabel:   'تحديد كمكتمل',
    quickReopenLabel: 'إعادة فتح',

    // AI Estimate
    aiEstimate:     'تقدير ذكي',
    estimating:     'جاري التقدير…',
    acceptEstimate: 'استخدام',

    // Quick Start
    quickStartPlaceholder: '⚡ بداية سريعة — اكتب اسم المشروع واضغط Enter',
    quickStartGenerating:  '⏳ الذكاء الاصطناعي يبني خطتك…',
    quickStartDone:        (n) => `✅ تم الإنشاء بـ ${n} مهام — فتح اللوحة`,
    quickStartFailed:      '❌ فشل — حاول مجدداً',
    aiError:               'خطأ: ',
    translateBtn:          '✨ ترجمة إلى العربية',

    // Global AI Insights (Dashboard)
    globalAiInsights:  'رؤى الذكاء الاصطناعي',
    allProjectsReport: '📊 التقرير الأسبوعي',
    allProjectsRisks:  '⚠️ فحص المخاطر',

    // Notes section
    notesTitle:       'الملاحظات',
    notesPlaceholder: 'اكتب ملاحظة… (Shift+Enter للسطر الجديد، Enter للحفظ)',
    notesEmpty:       'لا توجد ملاحظات بعد. اكتب شيئاً.',
    noteSave:         'حفظ',
    noteDelete:       'حذف',
  },

  zh: {
    // App / shared
    appName:      'AI 專案管理',
    loading:      '載入中…',
    dateLocale:   'zh-TW',

    // Sidebar
    dashboard:  '儀表板',
    active:     '進行中',
    other:      '其他',
    noProjects: '尚無專案',
    newProject: '+ 新增專案',

    // Dashboard stats
    activeProjects:    '進行中專案',
    tasksInProgress:   '進行中任務',
    blocked:           '已阻塞',
    overdue:           '逾期',
    done:              '已完成',
    completedProjects: '已完成專案',
    ofTotal:      (n) => `共 ${n} 個`,
    dueThisWeek:  '本週到期',
    allProjects:  '所有專案',
    noProjectsMsg:'尚無專案，立即建立第一個吧。',

    taskCount:    (done, total, pct) => `${done}/${total} 個任務 · ${pct}%`,
    taskCountPlain:(n) => `${n} 個任務`,
    pct:          (p) => `${p}%`,

    // Project form
    editProject:    '編輯專案',
    newProjectTitle:'新增專案',
    projectNameLabel:'專案名稱 *',
    goalLabel:      '目標',
    descriptionLabel:'描述',
    statusLabel:    '狀態',
    priorityLabel:  '優先級',
    startDateLabel: '開始日期',
    dueDateLabel:   '截止日期',
    cancel:         '取消',
    saveChanges:    '儲存變更',
    createProject:  '建立專案',
    saving:         '儲存中…',

    statusActive:    '進行中',
    statusPaused:    '暫停',
    statusCompleted: '已完成',
    statusArchived:  '已封存',

    priorityLow:    '低',
    priorityMedium: '中',
    priorityHigh:   '高',
    priorityUrgent: '緊急',

    projectNamePlaceholder: '例如：行動應用改版',
    goalPlaceholder:        '成功的標準是什麼？',
    descPlaceholder:        '簡短描述本專案…',

    // Task form
    editTask:  '編輯任務',
    newTask:   '新增任務',
    titleLabel:'標題 *',
    estHours:  '預估時數',
    actHours:  '實際時數',
    assignee:  '負責人',
    addTask:   '新增任務',

    statusTodo:       '待辦',
    statusInProgress: '進行中',
    statusReview:     '審查中',
    statusDone:       '已完成',
    statusBlocked:    '已阻塞',

    taskTitlePlaceholder:'例如：設計登入畫面',
    taskDescPlaceholder: '詳情、驗收標準、備註…',
    estHoursPlaceholder: '例如：4',
    actHoursPlaceholder: '完成後填寫',
    assigneePlaceholder: '姓名或 @handle',

    // Project detail / Kanban
    aiAssistant:  '✨ AI 助手',
    edit:         '編輯',
    delete:       '刪除',
    due:          '截止',
    addTaskBtn:   '+ 新增任務',
    deleteConfirm:'確定刪除此專案及所有任務？',

    colTodo:       '待辦',
    colInProgress: '進行中',
    colReview:     '審查中',
    colDone:       '已完成',
    colBlocked:    '已阻塞',

    // AI panel
    aiPanelTitle:   (name) => `✨ AI 助手 — ${name}`,
    tabPlan:        '📋 生成計劃',
    tabStandup:     '📣 每日站會',
    tabRisks:       '⚠️ 風險分析',
    tabReport:      '📊 週報',
    tabNotes:       '📝 解析會議記錄',
    teamSizeLabel:  '團隊規模',
    dueDateLabel2:  '截止日期',
    run:            '▶ 執行',
    thinking:       '⏳ 思考中…',
    pasteNotesLabel:'貼上會議記錄',
    standupInfo:    (done, ip, bl) => `根據目前任務狀態生成站會摘要（已完成 ${done} 個、進行中 ${ip} 個、阻塞 ${bl} 個）。`,
    risksInfo:      (bl, od) => `分析 ${bl} 個阻塞任務和 ${od} 個逾期任務以識別風險。`,
    tasksReady:     (n) => `✅ ${n} 個任務已就緒`,
    applyToBoard:   '套用到看板',
    applying:       '套用中…',
    more:           (n) => `+${n} 更多`,
    poweredBy:      '由 Groq · Cerebras 提供支援',
    close:          '關閉',
    appliedMsg:     (n) => `\n\n✅ 已成功套用 ${n} 個任務到看板。`,

    phPlan:    'AI 將根據本專案生成完整任務分解。調整團隊規模和截止日期可獲得更佳結果。',
    phStandup: 'AI 將根據目前任務狀態生成每日站會摘要。',
    phRisks:   'AI 將分析阻塞和逾期任務，找出風險並提出行動建議。',
    phReport:  'AI 將生成涵蓋所有專案的專業週報。',
    phNotes:   '請在上方貼上會議記錄，AI 將提取所有行動項目並轉為任務。',
    teamSizePlaceholder:  '例如：3 位工程師',
    notesPastePlaceholder:'請在此貼上會議記錄，AI 將提取所有行動項目並轉為任務。',
    allProjectsReportInfo: (n) => `正在生成涵蓋全部 ${n} 個專案的週報。`,

    // Task quick-done
    quickDoneLabel:   '標記完成',
    quickReopenLabel: '重新開啟',

    // AI Estimate
    aiEstimate:     'AI 估算',
    estimating:     '估算中…',
    acceptEstimate: '採用',

    // Quick Start
    quickStartPlaceholder: '⚡ 快速建立 — 輸入專案名稱並按 Enter',
    quickStartGenerating:  '⏳ AI 正在生成計劃…',
    quickStartDone:        (n) => `✅ 已建立，共 ${n} 個任務 — 開啟看板`,
    quickStartFailed:      '❌ 建立失敗，請再試一次',
    aiError:               '錯誤：',
    translateBtn:          '✨ 翻譯為繁體中文',

    // Global AI Insights (Dashboard)
    globalAiInsights:  'AI 洞察',
    allProjectsReport: '📊 週報',
    allProjectsRisks:  '⚠️ 風險掃描',

    // Notes section
    notesTitle:       '筆記',
    notesPlaceholder: '記錄筆記… (Shift+Enter 換行，Enter 儲存)',
    notesEmpty:       '尚無筆記，立即記錄第一筆。',
    noteSave:         '儲存',
    noteDelete:       '刪除',
  },
}
