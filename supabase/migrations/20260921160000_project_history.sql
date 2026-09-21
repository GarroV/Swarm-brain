-- Журнал изменений проекта (issue #426). Владелец 21.09.2026: «у проекта надо добавить
-- функционал переноса в другое пространство + логирование всего что происходит».
--
-- Повод. У задач журнал есть (`task_history`, #286), у проектов не было ничего — и это
-- выяснилось худшим способом: когда раздел «Проекты» опустел, восстанавливать раскладку
-- пришлось по косвенному следу (`created_by`), потому что о переездах проектов между
-- пространствами не сохранилось ни строки. Запись начинается с этой раскатки: прошлого
-- в журнале не будет, данные копятся только вперёд.
--
-- Устройство повторяет `task_history` намеренно: по строке на КАЖДОЕ изменившееся поле, плюс
-- события жизненного цикла (создан / в архив / возвращён) — тем же набором колонок, чтобы
-- читающий код и будущий общий экран истории не разбирали две разные формы.

create table if not exists public.project_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  group_id text,
  -- Что изменилось: имя колонки проекта (name, sprint_id → 'space', parent_id → 'parent', …)
  -- либо событие жизненного цикла: created | archived | restored.
  field text not null,
  old_value text,
  new_value text,
  -- Кто изменил. `changed_by` — человекочитаемое (имя или id строкой), как в `task_history`:
  -- NOT NULL там оказался миной (веб передавал только telegram_id, вставка падала, журнал
  -- молча не писался — issue #287), поэтому здесь значение всегда подставляет код.
  changed_by text not null,
  changed_by_telegram_id bigint,
  note text,
  created_at timestamptz not null default now()
);

-- Два способа чтения: история одного проекта и «все изменения за период» (как у задач).
create index if not exists idx_project_history_project_created
  on public.project_history (project_id, created_at desc);
create index if not exists idx_project_history_created
  on public.project_history (created_at desc);

comment on table public.project_history is
  'Журнал изменений проектов (#426): поле, с чего на что, кем. Пишется из _shared/tasks/projects.ts.';
comment on column public.project_history.field is
  'Колонка проекта (name, space, parent, is_private, owner, start_date, end_date, color, emoji) либо событие: created | archived | restored';
comment on column public.project_history.project_id is
  'ON DELETE CASCADE остаётся страховкой: с 21.09.2026 проекты не удаляются, а архивируются (#427), и журнал переживает архивацию.';

-- Доступ к таблице через Data API. Без явного гранта supabase-js под service_role получает
-- 42501 permission denied — поймано тестом сразу: журнал молча не писался, операция при этом
-- проходила успешно (ровно тот класс отказа, ради которого в коде стоит console.error).
grant select, insert, update, delete on public.project_history to service_role;

-- RLS как внешний замок (правило проекта, issue #41): политик НЕТ, поэтому anon/authenticated
-- не проходит ни одна строка, а приложение работает под service_role с rolbypassrls.
alter table public.project_history enable row level security;
