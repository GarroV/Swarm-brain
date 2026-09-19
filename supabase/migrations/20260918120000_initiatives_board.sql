-- Доска инициатив: спринт как пространство большого кросс-командного проекта.
--
-- Канон решения — docs/decisions/2026-09-18-doska-iniciativ.md, схема и «почему» —
-- docs/superpowers/specs/2026-09-18-initiatives-board-design.md §5.
--
-- Всё здесь — только ADD COLUMN, индексы и триггер: ни одной колонки не снимается и не
-- переименовывается, поэтому старый код продолжает работать во время раскатки. Бэкфилла нет —
-- единственный живой спринт на проде владелец разрешил удалить отдельной операцией.
--
-- ⚠️ Напоминание, которое стоит денег: `sprints` — это ВКЛАДКИ доски проектов, а спринты лежат
-- в `sprint_cycles`. Поэтому `tab_id` ссылается на `sprints`, и это не опечатка.

-- ── Пространство и день сверки ────────────────────────────────────────────────────────────
alter table public.sprint_cycles add column if not exists tab_id uuid references public.sprints(id) on delete set null;
alter table public.sprint_cycles add column if not exists check_date date;

comment on column public.sprint_cycles.tab_id is 'Пространство (вкладка доски), внутри которого идёт спринт. NULL — спринт, заведённый до появления пространств, либо вкладку удалили: такие показываются в служебном «Без вкладки».';
comment on column public.sprint_cycles.check_date is 'День сверки — середина спринта, когда участники отмечают «идёт / риск / проблема». NULL — сверка не назначена.';

create index if not exists idx_sprint_cycles_tab on public.sprint_cycles(tab_id, start_date desc);

-- Один живой спринт на пространство. Частичный индекс, а не триггер: гонка двух одновременных
-- «Начать спринт» решается базой, а не порядком чтения. На NULL не распространяется — иначе
-- старые спринты без вкладки конфликтовали бы друг с другом.
create unique index if not exists uniq_sprint_cycles_live_per_tab
  on public.sprint_cycles(tab_id)
  where status in ('draft', 'active') and tab_id is not null;

-- ── Сверка, перенос, происхождение, упоминание удалённой ──────────────────────────────────
-- Всё это живёт в строке состава, а не в задаче: у каждого спринта своя сверка и свой перенос,
-- а после приёмки строка больше не меняется — снимок получается сам собой.
alter table public.sprint_items add column if not exists check_status text
  check (check_status in ('ok', 'risk', 'problem'));
alter table public.sprint_items add column if not exists check_note     text;
alter table public.sprint_items add column if not exists check_at       timestamptz;
alter table public.sprint_items add column if not exists check_by       text;

alter table public.sprint_items add column if not exists to_carry       boolean not null default false;
alter table public.sprint_items add column if not exists carry_reason   text;
alter table public.sprint_items add column if not exists carry_at       timestamptz;
alter table public.sprint_items add column if not exists carry_by       text;
alter table public.sprint_items add column if not exists carried_from   uuid references public.sprint_items(id) on delete set null;
alter table public.sprint_items add column if not exists carried_manual boolean;
alter table public.sprint_items add column if not exists carry_count    integer not null default 0;
alter table public.sprint_items add column if not exists frozen_due_date date;

alter table public.sprint_items add column if not exists removed_title      text;
alter table public.sprint_items add column if not exists removed_project_id uuid;
alter table public.sprint_items add column if not exists removed_at         timestamptz;

comment on column public.sprint_items.check_status is 'Отметка сверки: ok — идёт по плану, risk — есть риск, problem — не двигается. NULL — человек промолчал, и это отдельная цифра «не отмечено», а не «всё хорошо».';
comment on column public.sprint_items.to_carry is 'Человек сам пометил задачу к переносу. Незакрытая задача уедет в следующий спринт и без пометки — пометка отличает осознанный перенос от автоматического.';
comment on column public.sprint_items.carry_count is 'Сколько раз задача уже переезжала. Считается при переносе как предыдущее + 1, а не обходом carried_from: обход нужен на каждой отрисовке строки и стоит дороже.';
comment on column public.sprint_items.removed_at is 'Задача удалена: строка осталась упоминанием, чтобы история спринта не рвалась. Такая строка не считается ни сделанной, ни невыполненной и никуда не переносится.';

-- ── Ссылки у задачи ───────────────────────────────────────────────────────────────────────
-- Старое поле `url` не трогаем: его пишут встречи и бот. На строке задачи 🔗 считает оба.
alter table public.tasks add column if not exists links jsonb not null default '[]'::jsonb;

comment on column public.tasks.links is 'Список ссылок {title, url}. Схема проверяется в коде (только http/https): в базе достаточно убедиться, что это массив.';

-- NOT VALID берёт тяжёлую блокировку на мгновение и не сканирует таблицу; VALIDATE сканирует
-- под лёгкой и не мешает чтениям и записям. Порядок важен именно этим.
do $$
begin
  alter table public.tasks add constraint tasks_links_is_array check (jsonb_typeof(links) = 'array') not valid;
exception
  when duplicate_object then null;
end $$;
alter table public.tasks validate constraint tasks_links_is_array;

-- ── Ответственный и сроки направления/инициативы ──────────────────────────────────────────
alter table public.projects add column if not exists owner_telegram_id bigint;
alter table public.projects add column if not exists start_date date;
alter table public.projects add column if not exists end_date   date;

comment on column public.projects.owner_telegram_id is 'Ответственный за направление или инициативу. Отдельного поля «ответственный» у задач не заводим — там работает существующий исполнитель.';

-- ── Гранты ────────────────────────────────────────────────────────────────────────────────
-- Явно, без опоры на автогранты Supabase: с 30.10.2026 они снимаются во всех существующих
-- проектах (https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically).
-- anon и authenticated доступа не получают: у них deny-all по RLS, и грант здесь был бы
-- ровно тем, что уже один раз стоило дыры (GHSA-vxrp-599j-46hv).
grant select, insert, update, delete on public.sprint_cycles to service_role;
grant select, insert, update, delete on public.sprint_items  to service_role;

-- ── Упоминание удалённой задачи ───────────────────────────────────────────────────────────
-- Почему триггер, а не код: задачи удаляются не только через deleteTask в swarm-api, но и
-- напрямую — бот при работе со встречей (swarm-bot/handlers/meetings.ts). Код такой путь
-- пропустил бы молча, и строка состава осталась бы с пустым task_id и без имени: в отчёте
-- спринта появилась бы дыра, которую нечем объяснить.
--
-- BEFORE, а не AFTER: внешний ключ sprint_items.task_id объявлен ON DELETE SET NULL, и к
-- моменту AFTER связь уже разорвана — найти строки состава будет не по чему. Проверено на
-- локальной базе: в BEFORE строки ещё видны.
create or replace function public.sprint_items_keep_removed_task()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  update public.sprint_items
     set removed_title      = old.title,
         removed_project_id = old.project_id,
         removed_at         = now()
   where task_id = old.id
     -- Принятый спринт не трогаем: его снимок сделан и обязан остаться таким, каким его
     -- прочитали в день приёмки.
     and frozen_at is null
     and removed_at is null;
  return old;
end;
$$;

comment on function public.sprint_items_keep_removed_task() is 'Удаление задачи оставляет в составе непринятых спринтов упоминание: имя, направление и время. Без него строка теряет и связь, и смысл.';

drop trigger if exists trg_tasks_keep_removed_in_sprints on public.tasks;
create trigger trg_tasks_keep_removed_in_sprints
  before delete on public.tasks
  for each row execute function public.sprint_items_keep_removed_task();

-- Функция вызывается триггером от имени того, кто удаляет задачу (service_role), и снаружи
-- дёргать её незачем: снимаем право у всех и не выдаём никому.
revoke all on function public.sprint_items_keep_removed_task() from public;

-- ── Приёмка спринта одной транзакцией ─────────────────────────────────────────────────────
-- Приёмка необратима, и половинчатый результат недопустим: спринт принят, а хвосты не уехали —
-- это молча потерянная работа команды на две недели вперёд. У нынешней приёмки (#267) шаги идут
-- отдельными запросами, и обрыв между ними оставляет ровно такое состояние.
--
-- Что считается снаружи и приходит готовым: итоги (computeSprintStats) и параметры следующего
-- спринта (nextCycleDates) — обе под тестами. Здесь только то, что обязано быть атомарным.
--
-- Классификация «остаётся / вручную / автоматически / упоминание» повторяет planCarry
-- (_shared/tasks/sprint-carry.ts), и тест на локальной базе сверяет результат этой функции с
-- ней: два описания одного правила расходятся молча, поэтому их сверяют машинно.
create or replace function public.accept_sprint_cycle(
  p_cycle_id     uuid,
  p_group_id     text,
  p_accepted_by  text,
  p_summary      text,
  p_stats        jsonb,
  p_next_name    text,
  p_next_start   date,
  p_next_end     date,
  p_next_check   date
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_cycle   public.sprint_cycles%rowtype;
  v_next_id uuid;
  v_frozen  integer := 0;
  v_manual  integer := 0;
  v_auto    integer := 0;
  v_now     timestamptz := now();
begin
  -- Блокировка строки спринта: два одновременных нажатия «Принять» выстраиваются в очередь,
  -- и второе увидит уже принятый спринт, а не примет его второй раз.
  select * into v_cycle
    from public.sprint_cycles
   where id = p_cycle_id and group_id = p_group_id
     for update;

  if not found then
    raise exception 'Спринт не найден' using errcode = 'P0001';
  end if;
  if v_cycle.status <> 'active' then
    raise exception 'Принять можно только идущий спринт, а этот — %', v_cycle.status
      using errcode = 'P0001';
  end if;

  -- 1. Снимок состава. Упоминания удалённых задач не трогаем: у них нечего замораживать,
  -- removed_* уже написал триггер, и frozen_at на них сделал бы строку с пустым статусом.
  -- Отдельного условия на removed_at здесь нет и не нужно: удаление задачи обнуляет
  -- sprint_items.task_id внешним ключом, и упоминание отсекается самим соединением. Условие
  -- «на всякий случай» стояло и было снято порчей — оно не краснело ни на одной поломке,
  -- то есть не держало ничего, зато внушало, что без него строки потекут.
  update public.sprint_items si
     set frozen_at           = v_now,
         frozen_title        = t.title,
         frozen_status       = t.status,
         frozen_assignees    = t.assignees,
         frozen_project      = p.name,
         frozen_completed_at = t.completed_at,
         frozen_due_date     = t.due_date
    from public.tasks t
    left join public.projects p on p.id = t.project_id
   where si.cycle_id = p_cycle_id
     and si.task_id  = t.id
     and si.frozen_at is null;
  get diagnostics v_frozen = row_count;

  -- 2. Спринт принят. Ставится ДО создания следующего: уникальный индекс живого спринта
  -- считает живыми и черновик, и идущий, поэтому пока этот active, второй в пространстве не
  -- вставится. Итоги пишутся один раз и больше не пересчитываются — отчёт не должен меняться
  -- от дальнейшей жизни задач.
  update public.sprint_cycles
     set status      = 'accepted',
         accepted_at = v_now,
         accepted_by = p_accepted_by,
         summary     = coalesce(p_summary, summary),
         stats       = p_stats,
         updated_at  = v_now
   where id = p_cycle_id;

  -- 3. Следующий спринт — черновик в том же пространстве. Создаётся до переноса: хвостам
  -- нужно, куда ехать.
  insert into public.sprint_cycles (group_id, tab_id, name, start_date, end_date, check_date, status, created_by)
  values (p_group_id, v_cycle.tab_id, p_next_name, p_next_start, p_next_end, p_next_check, 'draft', p_accepted_by)
  returning id into v_next_id;

  -- 4. Хвосты. Условие повторяет planCarry: закрытая остаётся, остальные едут, и пометка
  -- человека отличает осознанный перенос от автоматического. Удалённая не едет сама собой —
  -- соединение с tasks её не находит (внешний ключ обнулил task_id); проверено тестом
  -- «упоминание удалённой задачи никуда не переносится».
  -- Приватную задачу не переносим: в новом спринте её состав увидит вся команда, а приватная
  -- задача видна только владельцу (то же условие стоит при добавлении в спринт).
  with moved as (
    insert into public.sprint_items (cycle_id, task_id, in_plan, added_by, carried_from, carried_manual, carry_count)
    select v_next_id, si.task_id, true, p_accepted_by, si.id, si.to_carry, si.carry_count + 1
      from public.sprint_items si
      join public.tasks t on t.id = si.task_id
     where si.cycle_id = p_cycle_id
       and t.status not in ('done', 'cancelled')
       and t.is_private = false
    returning carried_manual
  )
  select count(*) filter (where carried_manual),
         count(*) filter (where not carried_manual)
    into v_manual, v_auto
    from moved;

  return jsonb_build_object(
    'cycle_id',       p_cycle_id,
    'next_cycle_id',  v_next_id,
    'frozen',         v_frozen,
    'carried_manual', v_manual,
    'carried_auto',   v_auto
  );
end;
$$;

comment on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) is 'Приёмка спринта одной транзакцией: снимок состава, следующий черновик, перенос хвостов, статус и итоги. Итоги и даты считает TypeScript под тестами — здесь только то, что обязано быть неделимым.';

-- Урок GHSA-vxrp-599j-46hv: грант на PUBLIC наследуется в anon и authenticated, и обычный
-- REVOKE ... FROM anon его не снимает. Поэтому сначала снимаем со всех, потом выдаём одному.
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from public;
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from anon;
revoke all on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) from authenticated;
grant execute on function public.accept_sprint_cycle(uuid, text, text, text, jsonb, text, date, date, date) to service_role;
