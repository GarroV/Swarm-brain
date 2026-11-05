-- Переезд человека в другое пространство (этап 3 решения docs/decisions/2026-11-05-second-workspace.md).
--
-- Владелец 05.11.2026: «все, что относится к личному, мы все перевозим. Все, что общее, где эти
-- люди присутствовали, значит, нужно открыть для их пространство в будущем тоже»; «задача
-- переезжает вместе. в этом и смысл»; токены — «сделать переход коллег максимально бесшовным».
--
-- Одна функция `move_member_to_workspace` делает весь переезд одной транзакцией. Пробный прогон
-- (p_dry_run) считает то же самое и ничего не пишет: админка показывает его до нажатия, а
-- выполнение сверяет свежий подсчёт с показанным (p_expected) и отказывает при расхождении.
-- Ничего не удаляется: строки меняют пространство, получают его в признак или остаются.
--
-- Решение по КАЖДОЙ таблице с колонкой group_id (32 штуки; список сверяет тест
-- member-move.db.test.ts — новая таблица с group_id без решения здесь валит его):
--
--   allowed_users            переезжает: group_id := новое, is_admin := false (права админа выданы
--                            в прежнем пространстве). Токены Claude/ChatGPT/OAuth НЕ гаснут —
--                            узкий обход триггеров отзыва (ниже), только на эту строку и только
--                            внутри этой функции.
--   people                   строку аккаунта переносит штатный триггер trg_people_sync_account.
--                            В новом пространстве уже есть живой человек с той же почтой →
--                            конфликт, переезд не выполняется (склейку людей делает человек).
--   entries                  личные (is_private, в т. ч. личные встречи) и общие НЕ-встречи
--                            владельца → переезжают. Личные пометки (metadata.kind=personal_notes)
--                            едут за своей встречей: карточка встречи читает их по дому встречи,
--                            поэтому пометки к общей встрече остаются рядом с ней (в ответе —
--                            other.personal_notes_kept). Общие встречи остаются дома и получают новое пространство
--                            в visible_group_ids — где человек владелец записи, участник по e-mail
--                            (allowed_users.email), записавший, совладелец или claim_owner черновика.
--   meetings                 версии переехавших личных встреч (entry_id) и черновики, где человек —
--                            единственный владелец (claim_owner, recorders, co_owners) → переезжают.
--                            Общие черновики остаются: до них участники доходят из любого пространства.
--   meeting_live_notes       идут за переехавшими строками meetings.
--   meeting_audio_backups    идут за переехавшими строками meetings.
--   tasks                    задачи, где человек автор/исполнитель/соисполнитель И нет другого
--                            участника из прежнего пространства (аккаунта или человека без входа) →
--                            переезжают. Смешанные остаются и перечисляются в ответе (tasks_mixed).
--                            Связь с родительской задачей, которая не едет, рвётся (parent_id :=
--                            null) с обеих сторон; чужие личные метки с переехавшей задачи снимаются.
--   task_history, task_files идут за переехавшими задачами.
--   notifications            уведомления самого человека и уведомления о переехавших задачах →
--                            переезжают (строки без пространства остаются как есть).
--   projects                 проект с подпроектами переезжает целиком, если едут ВСЕ его задачи
--                            (и архивные: иначе архивная задача ссылалась бы на чужое пространство),
--                            ни одна его задача не стоит в спринте прежнего пространства и ни
--                            владелец, ни автор проекта не из прежнего пространства. Переехавший
--                            проект снимается с доски прежнего пространства (sprint_id := null).
--                            Иначе проект остаётся, а уезжающие задачи отвязываются (tasks_detached).
--   project_history          идёт за переехавшими проектами.
--   task_labels              личные метки человека прежнего пространства → переезжают.
--   sprints, sprint_cycles   остаются (доска и спринты команды). Непринятая строка спринта с
--                            уехавшей задачей становится упоминанием (removed_*), как при архивации;
--                            принятый спринт не трогается — его снимок неизменен.
--   presence                 переезжает (текущее присутствие).
--   presence_log             остаётся: это история активности прежнего пространства.
--   short_links              ссылки человека → переезжают.
--   mcp_oauth_connections    подключения человека → переезжают (иначе mcp_oauth_resolve их не узнает).
--   board_stickers           остаются: доска команды.
--   calendar_series_country  остаётся: настройка пространства.
--   meeting_agent_grants, meeting_invites, meeting_calendar_jobs, meeting_calendar_misses,
--   meeting_calendar_snapshot_runs, meeting_calendar_snapshot_events
--                            остаются: короткоживущие пропуска бота и очередь расписания;
--                            расписание пересобирает задания по allowed_users.group_id уже в новом.
--   model_usage              остаётся: расход прежнего пространства (платил его ключ).
--   ai_key_health, workspace_secrets, service_agents
--                            остаются: принадлежат пространству, а не человеку.
--   telegram_outbox          остаётся: журнал доставки, group_id код не читает.
--
-- Архивные строки (archived_at) идут по тем же правилам.
--
-- Аддитивно: новая таблица журнала, новая функция; триггеры отзыва токенов и updated_at записи
-- получают узкое исключение. Повторный накат безопасен (create or replace / if not exists).

-- 1. Журнал переездов: кто, кого, откуда, куда и что переехало. Только дописывается.
create table if not exists public.member_moves (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_telegram_id bigint not null,
  telegram_id bigint not null,
  from_workspace text not null,
  to_workspace text not null,
  result jsonb not null
);
create index if not exists member_moves_person_at on public.member_moves (telegram_id, at desc);

create or replace function public.member_moves_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'member_moves is append-only';
end;
$$;
revoke execute on function public.member_moves_append_only() from public, anon, authenticated;
grant execute on function public.member_moves_append_only() to service_role;

drop trigger if exists member_moves_no_change on public.member_moves;
create trigger member_moves_no_change
  before update or delete on public.member_moves
  for each row execute function public.member_moves_append_only();

-- Внешний замок, как у всех таблиц public: RLS без политик, пишет только функция переезда.
alter table public.member_moves enable row level security;
revoke all on public.member_moves from public, anon, authenticated;
grant select, insert on public.member_moves to service_role;

-- 2. Узкий обход отзыва токенов. Функция переезда ставит транзакционную настройку
--    swarm.member_move = telegram_id ровно на время обновления строки человека и сразу снимает.
--    Любая другая смена group_id/is_admin токены гасит, как раньше.
create or replace function public.revoke_mcp_token_on_access_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.telegram_id is not null and old.telegram_id = new.telegram_id
     and current_setting('swarm.member_move', true) = new.telegram_id::text then
    return new;
  end if;
  if new.claude_mcp_token_hash is not null
     and new.claude_mcp_token_hash is not distinct from old.claude_mcp_token_hash
     and (new.group_id is distinct from old.group_id or new.is_admin is distinct from old.is_admin) then
    new.claude_mcp_token_hash := null;
    new.claude_mcp_token_expires_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.revoke_chatgpt_mcp_on_access_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.telegram_id is not null and old.telegram_id = new.telegram_id
     and current_setting('swarm.member_move', true) = new.telegram_id::text then
    return new;
  end if;
  if new.group_id is distinct from old.group_id or new.is_admin is distinct from old.is_admin then
    new.chatgpt_mcp_token_hash := null;
    new.chatgpt_mcp_token_expires_at := null;
    new.chatgpt_mcp_last_seen_at := null;
  end if;
  return new;
end;
$$;

create or replace function public.mcp_oauth_revoke_on_access_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.telegram_id is not null and old.telegram_id = new.telegram_id
     and current_setting('swarm.member_move', true) = new.telegram_id::text then
    return new;
  end if;
  if new.group_id is distinct from old.group_id or new.is_admin is distinct from old.is_admin then
    update public.mcp_oauth_connections set revoked_at = coalesce(revoked_at, now())
     where telegram_id = old.telegram_id and revoked_at is null;
  end if;
  return new;
end;
$$;

-- 3. Переезд — не правка записи: updated_at переехавших записей не сдвигается (иначе старые
--    заметки всплыли бы «свежими»). Настройку ставит только функция переезда.
drop trigger if exists entries_updated_at on public.entries;
create trigger entries_updated_at
  before update on public.entries
  for each row
  when (coalesce(current_setting('swarm.keep_updated_at', true), '') <> 'on')
  execute function public.update_updated_at();

-- 4. Сам переезд.
create or replace function public.move_member_to_workspace(
  p_telegram_id bigint,
  p_to text,
  p_actor bigint,
  p_dry_run boolean,
  p_expected jsonb default null
)
returns jsonb
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_user public.allowed_users;
  v_from text;
  v_email text;
  v_pid uuid;
  v_pemail text;
  v_others bigint[];
  v_cand uuid[];
  v_mixed_ids uuid[];
  v_mixed jsonb;
  v_tasks uuid[];
  v_projects uuid[];
  v_projects_json jsonb;
  v_detached uuid[];
  v_detached_json jsonb;
  v_sprint_items uuid[];
  v_parent_cut uuid[];
  v_label_strip uuid[];
  v_labels uuid[];
  v_notes uuid[];
  v_notes_kept bigint;
  v_private uuid[];
  v_plain uuid[];
  v_moving uuid[];
  v_shared uuid[];
  v_versions uuid[];
  v_drafts uuid[];
  v_meeting_rows uuid[];
  v_notifs uuid[];
  v_conflicts text[] := '{}';
  v_other jsonb;
  v_counts jsonb;
  v_tokens jsonb;
  v_result jsonb;
  v_after public.allowed_users;
begin
  if p_telegram_id is null or p_to is null or p_dry_run is null then
    return jsonb_build_object('error', 'bad_input');
  end if;
  if p_dry_run then
    select * into v_user from public.allowed_users where telegram_id = p_telegram_id;
  else
    -- Два одновременных переезда одного человека выстраиваются в очередь на его строке.
    select * into v_user from public.allowed_users where telegram_id = p_telegram_id for update;
  end if;
  if not found then
    return jsonb_build_object('error', 'person_not_found');
  end if;
  if not exists (select 1 from public.workspaces where id = p_to) then
    return jsonb_build_object('error', 'workspace_not_found');
  end if;
  v_from := v_user.group_id;
  if v_from is null then
    return jsonb_build_object('error', 'person_without_workspace');
  end if;
  if v_from = p_to then
    return jsonb_build_object('error', 'same_workspace');
  end if;
  if not p_dry_run and p_actor is null then
    return jsonb_build_object('error', 'bad_input');
  end if;

  v_email := nullif(lower(btrim(v_user.email)), '');
  select id, email into v_pid, v_pemail from public.people where account_id = v_user.id;
  select coalesce(array_agg(telegram_id), '{}') into v_others
    from public.allowed_users
   where group_id = v_from and telegram_id is not null and telegram_id <> p_telegram_id;

  -- Конфликт: в новом пространстве уже есть живой человек с той же почтой (уникально в пространстве).
  if exists (
    select 1 from public.people q
     where q.group_id = p_to and q.archived_at is null and q.email is not null
       and q.email in (v_email, v_pemail) and q.id is distinct from v_pid
  ) then
    v_conflicts := v_conflicts || ('people_email_taken:' || coalesce(v_pemail, v_email));
  end if;

  -- ── Задачи ──────────────────────────────────────────────────────────────────────────────
  select coalesce(array_agg(t.id), '{}') into v_cand
    from public.tasks t
   where t.group_id = v_from
     and (t.created_by_telegram_id = p_telegram_id
          or p_telegram_id = any (t.assignee_telegram_ids)
          or p_telegram_id = any (t.coassignee_telegram_ids)
          or (v_pid is not null and (t.assignee_person_id = v_pid or v_pid = any (t.coassignee_person_ids))));

  -- Смешанная: в ней есть другой участник прежнего пространства — аккаунт или человек без входа.
  select coalesce(array_agg(t.id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title, t.id), '[]')
    into v_mixed_ids, v_mixed
    from public.tasks t
   where t.id = any (v_cand)
     and (t.created_by_telegram_id = any (v_others)
          or t.assignee_telegram_ids && v_others
          or t.coassignee_telegram_ids && v_others
          or exists (
            select 1 from public.people q
             where q.group_id = v_from and q.id is distinct from v_pid
               and (q.id = t.assignee_person_id or q.id = any (t.coassignee_person_ids))));

  v_tasks := array(select unnest(v_cand) except select unnest(v_mixed_ids));

  -- ── Проекты: дерево (корень + подпроекты) едет целиком или не едет ───────────────────────
  with roots as (
    select distinct coalesce(p.parent_id, p.id) as root
      from public.tasks t join public.projects p on p.id = t.project_id
     where t.id = any (v_tasks)
  ), tree as (
    select r.root, p.id, p.name
      from roots r join public.projects p on p.id = r.root or p.parent_id = r.root
  ), blocked as (
    select distinct tr.root from tree tr
     where exists (select 1 from public.tasks t where t.project_id = tr.id and not (t.id = any (v_tasks)))
        or exists (select 1 from public.projects p
                    where p.id = tr.id
                      and (p.group_id is distinct from v_from
                           or p.owner_telegram_id = any (v_others)
                           or p.created_by = any (v_others)))
        or exists (select 1 from public.sprint_items si
                     join public.sprint_cycles sc on sc.id = si.cycle_id
                     join public.tasks t on t.id = si.task_id
                    where sc.group_id = v_from and t.project_id = tr.id)
        or exists (select 1 from public.sprint_items si
                     join public.sprint_cycles sc on sc.id = si.cycle_id
                    where sc.group_id = v_from and si.removed_project_id = tr.id)
  )
  select coalesce(array_agg(tr.id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', tr.id, 'name', tr.name) order by tr.name, tr.id), '[]')
    into v_projects, v_projects_json
    from tree tr
   where not exists (select 1 from blocked b where b.root = tr.root);

  select coalesce(array_agg(t.id), '{}'),
         coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title) order by t.title, t.id), '[]')
    into v_detached, v_detached_json
    from public.tasks t
   where t.id = any (v_tasks) and t.project_id is not null and not (t.project_id = any (v_projects));

  -- Непринятые строки спринтов прежнего пространства с уезжающими задачами → упоминание.
  select coalesce(array_agg(si.id), '{}') into v_sprint_items
    from public.sprint_items si join public.sprint_cycles sc on sc.id = si.cycle_id
   where si.task_id = any (v_tasks) and sc.group_id = v_from
     and si.frozen_at is null and si.removed_at is null;

  -- Связь с родительской задачей через границу пространств рвётся с обеих сторон.
  select coalesce(array_agg(t.id), '{}') into v_parent_cut
    from public.tasks t
   where (t.id = any (v_tasks) and t.parent_id is not null and not (t.parent_id = any (v_tasks)))
      or (not (t.id = any (v_tasks)) and t.parent_id = any (v_tasks));

  -- Метки личные (owner_id): свои едут, чужие с переехавшей задачи снимаются.
  select coalesce(array_agg(l.id), '{}') into v_labels
    from public.task_labels l where l.owner_id = p_telegram_id and l.group_id = v_from;
  select coalesce(array_agg(t.id), '{}') into v_label_strip
    from public.tasks t
   where t.id = any (v_tasks)
     and exists (select 1 from unnest(t.label_ids) li join public.task_labels l on l.id = li
                  where l.owner_id <> p_telegram_id);

  -- ── Записи ──────────────────────────────────────────────────────────────────────────────
  select coalesce(array_agg(e.id) filter (where e.is_private), '{}'),
         coalesce(array_agg(e.id) filter (where not e.is_private and e.entry_type is distinct from 'meeting'), '{}')
    into v_private, v_plain
    from public.entries e
   where e.owner_id = p_telegram_id and e.group_id = v_from
     and e.metadata->>'kind' is distinct from 'personal_notes';

  -- Общие встречи, где человек был: открываются его новому пространству.
  select coalesce(array_agg(e.id), '{}') into v_shared
    from public.entries e
   where e.entry_type = 'meeting' and not e.is_private and e.group_id is not null
     and not (p_to = any (e.visible_group_ids))
     and (e.owner_id = p_telegram_id
          or (v_email is not null and jsonb_typeof(e.metadata->'attendees') = 'array'
              and exists (select 1 from jsonb_array_elements(e.metadata->'attendees') a
                           where jsonb_typeof(a) = 'object' and lower(btrim(a->>'email')) = v_email))
          or exists (select 1 from public.meetings m
                      where m.entry_id = e.id
                        and (m.claim_owner = p_telegram_id
                             or p_telegram_id = any (m.co_owners)
                             or m.recorders @> jsonb_build_array(jsonb_build_object('telegram_id', p_telegram_id)))));

  select coalesce(array_agg(m.id), '{}') into v_versions
    from public.meetings m where m.entry_id = any (v_private || v_plain);

  -- Черновик, где человек — единственный владелец.
  select coalesce(array_agg(m.id), '{}') into v_drafts
    from public.meetings m
   where m.group_id = v_from and m.status = 'awaiting_review' and m.entry_id is null
     and (m.claim_owner = p_telegram_id
          or p_telegram_id = any (m.co_owners)
          or m.recorders @> jsonb_build_array(jsonb_build_object('telegram_id', p_telegram_id)))
     and (m.claim_owner is null or m.claim_owner = p_telegram_id)
     and m.co_owners <@ array[p_telegram_id]
     and not exists (
       select 1 from jsonb_array_elements(case when jsonb_typeof(m.recorders) = 'array' then m.recorders else '[]' end) r
        where (r->>'telegram_id') is distinct from p_telegram_id::text);
  v_meeting_rows := v_versions || v_drafts;

  -- Личные пометки читаются карточкой встречи по ДОМУ встречи (swarm-api: group_id = дом строки
  -- meetings). Поэтому пометки едут вместе со своей встречей, а пометки к общей встрече, которая
  -- остаётся дома, остаются рядом с ней — иначе карточка общей встречи потеряла бы их.
  select coalesce(array_agg(e.id) filter (where e.metadata->>'meeting_id' = any (v_meeting_rows::text[])), '{}'),
         count(*) filter (where not coalesce(e.metadata->>'meeting_id' = any (v_meeting_rows::text[]), false))
    into v_notes, v_notes_kept
    from public.entries e
   where e.owner_id = p_telegram_id and e.group_id = v_from
     and e.metadata->>'kind' = 'personal_notes';
  v_moving := v_notes || v_private || v_plain;

  select coalesce(array_agg(n.id), '{}') into v_notifs
    from public.notifications n
   where n.group_id = v_from
     and (n.recipient_telegram_id = p_telegram_id or n.task_id = any (v_tasks));

  -- ── Ответ ───────────────────────────────────────────────────────────────────────────────
  v_other := jsonb_build_object(
    'task_history', (select count(*) from public.task_history where task_id = any (v_tasks) and group_id = v_from),
    'task_files', (select count(*) from public.task_files where task_id = any (v_tasks) and group_id = v_from),
    'task_parent_links', cardinality(v_parent_cut),
    'task_label_links', cardinality(v_label_strip),
    'sprint_items', cardinality(v_sprint_items),
    'project_history', (select count(*) from public.project_history where project_id = any (v_projects) and group_id = v_from),
    'meeting_versions', cardinality(v_versions),
    'personal_notes_kept', v_notes_kept,
    'meeting_live_notes', (select count(*) from public.meeting_live_notes where meeting_id = any (v_meeting_rows) and group_id = v_from),
    'meeting_audio_backups', (select count(*) from public.meeting_audio_backups where meeting_id = any (v_meeting_rows) and group_id = v_from),
    'people', (select count(*) from public.people where id = v_pid and group_id = v_from),
    'presence', (select count(*) from public.presence where telegram_id = p_telegram_id and group_id = v_from),
    'short_links', (select count(*) from public.short_links where owner_id = p_telegram_id and group_id = v_from),
    'mcp_oauth_connections', (select count(*) from public.mcp_oauth_connections where telegram_id = p_telegram_id and group_id = v_from)
  );
  v_counts := jsonb_build_object(
    'private_entries', cardinality(v_private),
    'entries', cardinality(v_plain),
    'personal_notes', cardinality(v_notes),
    'drafts', cardinality(v_drafts),
    'meetings_shared', cardinality(v_shared),
    'tasks', cardinality(v_tasks),
    'tasks_detached', cardinality(v_detached),
    'projects', cardinality(v_projects),
    'notifications', cardinality(v_notifs),
    'labels', cardinality(v_labels),
    'other', v_other
  );
  v_tokens := jsonb_build_object(
    'claude', v_user.claude_mcp_token_hash is not null
              and (v_user.claude_mcp_token_expires_at is null or v_user.claude_mcp_token_expires_at > now()),
    'chatgpt', v_user.chatgpt_mcp_token_hash is not null
               and (v_user.chatgpt_mcp_token_expires_at is null or v_user.chatgpt_mcp_token_expires_at > now()),
    'oauth', (select count(*) from public.mcp_oauth_connections
               where telegram_id = p_telegram_id and revoked_at is null and expires_at > now()),
    'recorder', v_user.recorder_token_hash is not null
  );
  v_result := jsonb_build_object(
    'person', jsonb_build_object('telegram_id', v_user.telegram_id, 'email', v_user.email),
    'from', v_from,
    'to', p_to,
    'counts', v_counts,
    'tasks_mixed', v_mixed,
    'tasks_detached', v_detached_json,
    'projects', v_projects_json,
    'tokens', v_tokens,
    'conflicts', to_jsonb(v_conflicts),
    'can_execute', cardinality(v_conflicts) = 0,
    'moved', false
  );

  if p_dry_run then
    return v_result;
  end if;
  if cardinality(v_conflicts) > 0 then
    return v_result || jsonb_build_object('error', 'conflicts');
  end if;
  -- Данные изменились между показом и нажатием — не выполняем то, чего админ не видел.
  if p_expected is not null and (
       (p_expected->>'tasks') is distinct from (v_counts->>'tasks')
       or (p_expected->>'entries') is distinct from (v_counts->>'entries')) then
    return v_result || jsonb_build_object('error', 'expected_mismatch');
  end if;

  -- ── Запись ──────────────────────────────────────────────────────────────────────────────
  update public.sprint_items si
     set removed_title = t.title, removed_project_id = t.project_id, removed_at = now()
    from public.tasks t
   where si.id = any (v_sprint_items) and t.id = si.task_id;

  update public.projects set group_id = p_to, sprint_id = null where id = any (v_projects);
  update public.project_history set group_id = p_to where project_id = any (v_projects) and group_id = v_from;

  update public.tasks t
     set group_id = p_to,
         project_id = case when t.project_id = any (v_projects) then t.project_id end,
         project_linked = case when t.project_id is null or t.project_id = any (v_projects) then t.project_linked else false end,
         parent_id = case when t.parent_id = any (v_tasks) then t.parent_id end,
         label_ids = array(
           select li from unnest(t.label_ids) with ordinality as x(li, ord)
            where not exists (select 1 from public.task_labels l where l.id = x.li and l.owner_id <> p_telegram_id)
            order by x.ord)
   where t.id = any (v_tasks);
  update public.tasks set parent_id = null where id = any (v_parent_cut) and not (id = any (v_tasks));
  update public.task_history set group_id = p_to where task_id = any (v_tasks) and group_id = v_from;
  update public.task_files set group_id = p_to where task_id = any (v_tasks) and group_id = v_from;
  update public.notifications set group_id = p_to where id = any (v_notifs);
  update public.task_labels set group_id = p_to where id = any (v_labels);

  perform set_config('swarm.keep_updated_at', 'on', true);
  update public.entries set group_id = p_to, visible_group_ids = array[p_to] where id = any (v_moving);
  update public.entries set visible_group_ids = visible_group_ids || p_to where id = any (v_shared);
  perform set_config('swarm.keep_updated_at', '', true);

  update public.meetings set group_id = p_to where id = any (v_meeting_rows);
  update public.meeting_live_notes set group_id = p_to where meeting_id = any (v_meeting_rows) and group_id = v_from;
  update public.meeting_audio_backups set group_id = p_to where meeting_id = any (v_meeting_rows) and group_id = v_from;

  -- Строка человека: токены живут (обход только на это обновление), людей переносит триггер.
  perform set_config('swarm.member_move', p_telegram_id::text, true);
  update public.allowed_users set group_id = p_to, is_admin = false where telegram_id = p_telegram_id;
  perform set_config('swarm.member_move', '', true);

  update public.presence set group_id = p_to where telegram_id = p_telegram_id and group_id = v_from;
  update public.short_links set group_id = p_to where owner_id = p_telegram_id and group_id = v_from;
  update public.mcp_oauth_connections set group_id = p_to where telegram_id = p_telegram_id and group_id = v_from;

  -- Самопроверка: токен потерян или человек не переехал — откатываем всё.
  select * into v_after from public.allowed_users where telegram_id = p_telegram_id;
  if v_after.group_id is distinct from p_to
     or v_after.claude_mcp_token_hash is distinct from v_user.claude_mcp_token_hash
     or v_after.chatgpt_mcp_token_hash is distinct from v_user.chatgpt_mcp_token_hash
     or v_after.recorder_token_hash is distinct from v_user.recorder_token_hash
     or (select count(*) from public.mcp_oauth_connections
          where telegram_id = p_telegram_id and revoked_at is null and expires_at > now())
        <> (v_tokens->>'oauth')::bigint
     or (v_pid is not null and not exists (select 1 from public.people where id = v_pid and group_id = p_to)) then
    raise exception 'move_member_to_workspace: самопроверка не прошла для %', p_telegram_id;
  end if;

  v_result := v_result || jsonb_build_object('moved', true);
  insert into public.member_moves (actor_telegram_id, telegram_id, from_workspace, to_workspace, result)
  values (p_actor, p_telegram_id, v_from, p_to, v_result);
  return v_result;
end;
$$;

comment on function public.move_member_to_workspace(bigint, text, bigint, boolean, jsonb) is
  'Переезд человека в другое пространство одной транзакцией (этап 3, решение 2026-11-05). p_dry_run — только подсчёт. Решения по таблицам — в шапке миграции 20261105200000.';

-- Урок GHSA-vxrp: функции по умолчанию исполняемы для PUBLIC, а грант на PUBLIC наследуют anon и
-- authenticated. Переезд зовёт только swarm-api под service_role.
revoke all on function public.move_member_to_workspace(bigint, text, bigint, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.move_member_to_workspace(bigint, text, bigint, boolean, jsonb) to service_role;
