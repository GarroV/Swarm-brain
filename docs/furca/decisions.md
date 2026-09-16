<!-- managed by furca: do not change the row format below — fabrica and cursus parse this file -->
# Decisions

<!-- id: Dnnn (D001, D002, ...). who: owner (the owner decided) | auto (decided autonomously by the dispatcher). -->

| id | date | decision | why | who |
|---|---|---|---|---|
| D001 | 2026-09-17 | Пакет документов FURCA для этой фичи ведётся на русском, а не на дефолтном `en` | Спека 28.08, оба решения владельца и вся dev-документация Swarm — на русском. Пакет на английском разошёлся бы со своим же входом, и владельцу пришлось бы читать два языка об одном предмете. CLAUDE.md проекта прямо разрешает русский для dev-доков | auto |
| D002 | 2026-09-17 | Стройка идёт в отдельной рабочей копии `~/Documents/workbench/worktrees/swarm-meeting-bot-build`, ветка `feat/meeting-bot` | Владелец подтвердил: окно параллельное. Главное дерево занято веткой security-hardening, ещё 6 копий заняты другими задачами — работа в общей папке затирает чужой незакоммиченный WIP | auto |
| D003 | 2026-09-17 | Ветка отведена от `origin/main`, спека принесена слиянием `feat/meeting-bot-spec` | Ветка спеки отставала от main на 175 коммитов — строить на ней значило бы строить на коде трёхнедельной давности. Вливать спеку в main нельзя: пуш в main пересобирает веб на Cloudflare Pages, то есть считается раскаткой | auto |
