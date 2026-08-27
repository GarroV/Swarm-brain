// Колонки задачи, которые уезжают в браузер в СПИСОЧНОМ ответе GET /tasks.
// Тот же приём, что ENTRY_COLUMNS для записей (issue #102), но причина другая: у задач нет
// одной жирной колонки вроде embedding — вес строки во многом составляют ИМЕНА 35 полей JSON.
// Замеры на проде (188 задач): полная строка 1146 Б, эта проекция — 583 Б, то есть −49%.
//
// Что выброшено и почему (проверено grep'ом по всем экранам, кроме редактора):
//   description  — 307 Б на строку, 27% веса; НЕ рендерится ни в одной строке списка;
//   note, url    — в базе пусто (0 Б), клиент не читает;
//   tags, task_role, created_by, group_id, confirmed, owner_id, updated_at,
//   timeline_position, remind_set_by — списками не читаются (только фильтры на сервере,
//   оптимистичные литералы при создании и редактор).
//
// ⚠️ Экран, который открывает задачу ИЗ ОБЪЕКТА СПИСКА, обязан до-загрузить её по id
// (fetchTask). Иначе редактор покажет пустое описание и сохранит пустоту поверх реального
// текста — это потеря данных. Детальные экраны (TaskDetail, NewTask) и так грузят по id.
export const TASK_LIST_COLUMNS = [
  "id",
  "title",
  "status",
  "due_date",
  "start_date",
  "remind_date",
  "reminded_at",
  "priority",
  "country",
  "assignees",
  "assignee_telegram_ids",
  "label_ids",
  "project_id",
  "project_linked",
  "sprint_id",
  "parent_id",
  "tree_x",
  "tree_y",
  "meeting_id",
  "is_private",
  "created_at",
  // Цикличность: её читают строка задачи (бейдж ↻), смарт-список «Регулярные» и ФОРМА.
  // Без них TaskModal увидел бы recur_freq=undefined и при сохранении отправил null —
  // то есть молча снял бы повтор с каждой правленой задачи. Ровно та же потеря данных,
  // что описана выше про description, только тише.
  "recur_freq",
  "recur_anchor_dom",
  // нужен серверу для вычисляемого created_by_name, клиент читает уже имя
  "created_by_telegram_id",
].join(",");
