-- Служебные агенты: боты, которые ходят на сервер своим токеном и действуют ОТ ИМЕНИ человека.
-- Первый жилец — `scriba`, бот-участник видеовстреч.
--
-- Почему отдельная таблица, а не строка в allowed_users (решение D007).
-- allowed_users — таблица ЛЮДЕЙ. По ней считается команда: рассылки, дайджест, выборки «кто у нас
-- есть», watchdog рекордеров, права в боте. Служебная строка в ней молча сделала бы бота
-- сотрудником во всех этих местах сразу, и заметили бы это не на ревью, а в отчёте, где у команды
-- прибавился человек. Отдельная таблица делает разницу структурной, а не договорной.
--
-- Токен агента САМ ПО СЕБЕ не даёт прав (constitution.md, «Правила безопасности»): он обязан
-- указать, за кого действует (заголовок X-On-Behalf-Of), и указанный человек обязан быть в том же
-- воркспейсе, что и агент. Проверка — _shared/agent-auth.ts, resolveActingIdentity.
--
-- Обратимость: миграция только СОЗДАЁТ новый объект, ничего существующего не трогает. Старый код
-- о таблице не знает и работает как раньше. Откат — `drop table public.service_agents;`
-- (после того, как код перестанет её читать: порядок «сначала код, потом схема», CLAUDE.md).

create table if not exists public.service_agents (
  id               text primary key,                              -- слаг агента: 'scriba'
  name             text not null,                                 -- как агент зовётся для человека
  group_id         text references public.workspaces(id),          -- воркспейс, который агент обслуживает
  token_hash       text unique,                                   -- sha256-hex токена (сам токен не храним)
  token_expires_at timestamptz,                                   -- NULL = бессрочный
  is_active        boolean not null default true,                 -- выключатель без удаления строки
  created_at       timestamptz not null default now(),
  -- Heartbeat агента — в СВОЮ строку, не в allowed_users (D007): иначе watchdog checkRecorderHealth
  -- увидел бы у человека живой рекордер, которого нет, и погасил бы настоящий сигнал «запись оборвалась».
  last_seen_at     timestamptz,
  last_recording   boolean,
  last_version     integer,
  last_meeting_key text
);

comment on table public.service_agents is
  'Служебные агенты (боты), приходящие на сервер своим токеном и действующие от имени человека. Не люди: в выборках команды не участвуют.';
comment on column public.service_agents.token_hash is
  'sha256-hex токена агента. Сам токен живёт в секретах контейнера агента и в базу не попадает.';
comment on column public.service_agents.group_id is
  'Воркспейс агента. Агент может действовать только за человека ИЗ ЭТОГО воркспейса; без воркспейса прав нет.';
comment on column public.service_agents.is_active is
  'Выключатель: false — токен перестаёт приниматься, строка и история остаются.';
comment on column public.service_agents.last_seen_at is
  'Heartbeat агента. Отдельно от allowed_users.recorder_last_seen, чтобы watchdog не принял бота за рекордер человека.';

-- Отдельного индекса по token_hash НЕ заводим: `unique` уже создаёт service_agents_token_hash_key,
-- и поиск по равенству в agent-auth идёт по нему. Второй индекс на ту же колонку — только лишняя
-- работа на записи. (Проверено на локальном контуре: pg_indexes показывает оба, план берёт unique.)

-- Data API: без явного гранта запросы service_role вернут 42501 после раскатки Supabase 30.10.2026
-- (см. supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.service_agents to service_role;

-- RLS как внешний замок: включён, политик нет → anon/authenticated (anon-ключ публичен по дизайну)
-- не получают ни одной строки. Приложение ходит service_role'ом, у которого rolbypassrls.
alter table public.service_agents enable row level security;
