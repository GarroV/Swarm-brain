-- ============================================================================
-- Swarm Brain — base schema (standalone bootstrap)
-- ============================================================================
-- The incremental files in supabase/migrations/ ALTER these tables but never
-- CREATE them — the foundational schema was originally built by hand in the
-- Supabase dashboard. This file reconstructs the full current schema so a fresh
-- project can be brought up from zero in one shot.
--
-- Usage on a brand-new project:
--   psql "$DATABASE_URL" -f supabase/schema/00_base_schema.sql
-- (or paste into the Supabase SQL editor). Run this BEFORE the incremental
-- migrations are not needed on a fresh DB — this file already reflects their
-- end state. Everything is idempotent (IF NOT EXISTS).
-- ============================================================================

create extension if not exists vector;

-- ── workspaces ──────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id              text primary key,
  name            text not null,
  created_at      timestamptz default now(),
  allowed_markets text[]
);

-- ── allowed_users ───────────────────────────────────────────────────────────
create table if not exists public.allowed_users (
  id                    bigserial primary key,
  telegram_id           bigint unique,
  username              text,
  email                 text,  -- ключ веб-входа через Google Sign-In (уникальный по lower ниже)
  added_by              bigint not null,
  created_at            timestamptz not null default now(),
  is_admin              boolean not null default false,
  group_id              text references public.workspaces(id),
  claude_mcp_token_hash text,
  claude_mcp_token_expires_at timestamptz
);
create unique index if not exists allowed_users_email_lower_uq
  on public.allowed_users (lower(email)) where email is not null;
create index if not exists allowed_users_mcp_token_hash_idx
  on public.allowed_users (claude_mcp_token_hash)
  where claude_mcp_token_hash is not null;

-- ── user_profiles ───────────────────────────────────────────────────────────
create table if not exists public.user_profiles (
  telegram_id  bigint primary key references public.allowed_users(telegram_id) on delete cascade,
  first_name   text,
  last_name    text,
  role         text,
  markets      text[] default '{}',
  phone        text,
  email        text,
  notes        text,
  updated_at   timestamptz default now(),
  name_aliases text[] not null default '{}'
);

-- ── entries (knowledge base) ────────────────────────────────────────────────
create table if not exists public.entries (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  embedding  vector(1536),
  added_by   text,
  source     text default 'manual',
  metadata   jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  summary    text,
  countries  text[] default '{}',
  entry_type text default 'note',
  entry_date date,
  group_id   text references public.workspaces(id),
  is_private boolean not null default false,
  owner_id   bigint references public.allowed_users(telegram_id),
  -- Полнотекстовый вектор (русская конфигурация) для гибридного поиска (см. match_entries_hybrid).
  fts        tsvector generated always as (to_tsvector('russian', coalesce(content, ''))) stored
);
-- ANN-индекс семантического поиска. hnsw требует pgvector >= 0.5.0; локальный образ Supabase CLI
-- может тянуть более старый pgvector без hnsw → reset падал (issue #11). Оборачиваем в try/catch:
-- на старом pgvector индекс не создаётся (семантика работает full-scan'ом — для локали достаточно),
-- прод (новый pgvector) уже имеет hnsw-индекс, `if not exists` там = no-op.
do $$
begin
  create index if not exists entries_embedding_idx on public.entries using hnsw (embedding vector_cosine_ops);
exception when others then
  raise notice 'entries_embedding_idx (hnsw) skipped: % — likely pgvector < 0.5.0 (local image)', sqlerrm;
end $$;
create index if not exists entries_metadata_idx  on public.entries using gin (metadata);
create index if not exists entries_owner_id_idx   on public.entries (owner_id);
create index if not exists idx_entries_countries  on public.entries using gin (countries);
create index if not exists idx_entries_date        on public.entries (entry_date desc);
create index if not exists idx_entries_group       on public.entries (group_id);
create index if not exists idx_entries_type        on public.entries (entry_type);
create index if not exists idx_entries_fts          on public.entries using gin (fts);

-- ── sprints (объявляется до tasks: tasks.sprint_id ссылается сюда) ────────────
create table if not exists public.sprints (
  id         uuid primary key default gen_random_uuid(),
  group_id   text not null references public.workspaces(id) on delete cascade,
  name       text not null,
  start_date date not null,
  end_date   date not null,
  status     text not null default 'planned' check (status in ('planned','active','completed')),
  created_at timestamptz default now(),
  constraint sprint_dates check (start_date <= end_date)
);
create index if not exists idx_sprints_group on public.sprints (group_id, status);
grant select, insert, update, delete on public.sprints to service_role;

-- ── tasks ───────────────────────────────────────────────────────────────────
create table if not exists public.tasks (
  id                     uuid primary key default gen_random_uuid(),
  title                  text not null,
  assignees              text[] default '{}',
  due_date               date,
  status                 text not null default 'open',
  tags                   text[] default '{}',
  meeting_id             text,
  created_by             text not null default 'system',
  note                   text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  url                    text,
  description            text,
  source                 text not null default 'manual',
  country                text,
  task_role              text check (task_role = any (array['marketing','bd','rnd'])),
  assignee_telegram_ids  bigint[] not null default '{}',
  group_id               text references public.workspaces(id),
  confirmed              boolean not null default false,
  created_by_telegram_id bigint,
  is_private             boolean not null default false,
  owner_id               bigint references public.allowed_users(telegram_id),
  start_date             date,
  timeline_position      integer,
  sprint_id              uuid references public.sprints(id) on delete set null,
  label_ids              uuid[] not null default '{}'
);
create index if not exists idx_tasks_assignees on public.tasks using gin (assignees);
create index if not exists idx_tasks_due_date  on public.tasks (due_date);
create index if not exists idx_tasks_status    on public.tasks (status);
create index if not exists idx_tasks_tags      on public.tasks using gin (tags);
create index if not exists idx_tasks_owner_id  on public.tasks (owner_id) where is_private = true;
create index if not exists idx_tasks_dates     on public.tasks (start_date, due_date) where start_date is not null;
create index if not exists idx_tasks_sprint    on public.tasks (sprint_id) where sprint_id is not null;
create index if not exists idx_tasks_label_ids on public.tasks using gin (label_ids);

-- ── task_labels ──────────────────────────────────────────────────────────────
-- Персональные смарт-метки задач. owner_id NOT NULL = всегда чьи-то личные;
-- group_id зарезервирован под будущие общие списки (тогда owner_id станет nullable).
create table if not exists public.task_labels (
  id         uuid primary key default gen_random_uuid(),
  group_id   text references public.workspaces(id),
  owner_id   bigint not null references public.allowed_users(telegram_id),
  name       text not null,
  icon       text not null default 'tag',
  color      text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_labels_owner on public.task_labels(owner_id);

-- ── task_history ────────────────────────────────────────────────────────────
create table if not exists public.task_history (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  changed_by text not null,
  old_status text,
  new_status text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists idx_task_history_task_id on public.task_history (task_id);

-- ── task_comments ───────────────────────────────────────────────────────────
create table if not exists public.task_comments (
  id                   uuid primary key default gen_random_uuid(),
  task_id              uuid not null references public.tasks(id) on delete cascade,
  content              text not null,
  added_by             text,
  added_by_telegram_id bigint,
  created_at           timestamptz default now()
);
create index if not exists idx_task_comments_task_id on public.task_comments (task_id);

-- ── task_dependencies (blocks / relates_to / duplicates) ─────────────────────
create table if not exists public.task_dependencies (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  depends_on_id   uuid not null references public.tasks(id) on delete cascade,
  dependency_type text not null default 'blocks'
                  check (dependency_type in ('blocks','relates_to','duplicates')),
  created_at      timestamptz default now(),
  unique (task_id, depends_on_id),
  constraint no_self_dependency check (task_id <> depends_on_id)
);
create index if not exists idx_deps_task       on public.task_dependencies (task_id);
create index if not exists idx_deps_depends_on on public.task_dependencies (depends_on_id);
grant select, insert, update, delete on public.task_dependencies to service_role;

create or replace function public.get_all_dependencies(root_id uuid)
returns table(id uuid)
language sql stable
set search_path = public
as $$
  with recursive deps as (
    select depends_on_id as id from public.task_dependencies where task_id = root_id
    union
    select td.depends_on_id from public.task_dependencies td inner join deps d on td.task_id = d.id
  )
  select id from deps;
$$;

-- ── sessions (bot conversation state) ───────────────────────────────────────
create table if not exists public.sessions (
  chat_id    bigint primary key,
  action     text not null,
  created_at timestamptz not null default now(),
  context    text,
  updated_at timestamptz not null default now()
);

-- ── app_settings ────────────────────────────────────────────────────────────
create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── feedback ────────────────────────────────────────────────────────────────
create table if not exists public.feedback (
  id             uuid primary key default gen_random_uuid(),
  telegram_id    bigint not null,
  username       text,
  text           text not null,
  photo_file_id  text,
  screenshot_url text,                                      -- durable URL в swarm_drive (канон скрина)
  status         text not null default 'new',               -- new → triaged → done / wontfix
  category       text not null default 'other',             -- recorder|meetings|search|tasks|knowledge|digest|auth|integrations|claude|ui|other
  source         text not null default 'bot',               -- bot | web
  task_id        uuid,                                      -- если превращён в задачу
  resolved_at    timestamptz,
  created_at     timestamptz not null default now()
);

-- ── user_integrations (Granola etc.) ────────────────────────────────────────
create table if not exists public.user_integrations (
  id               uuid primary key default gen_random_uuid(),
  telegram_id      bigint not null,
  service          text not null,
  api_key          text not null,
  last_polled_at   timestamptz,
  skipped_note_ids text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique (telegram_id, service)
);

-- ── oauth_state / oauth_tokens (Read.ai) ────────────────────────────────────
create table if not exists public.oauth_state (
  state         text primary key,
  client_id     text not null,
  code_verifier text not null,
  created_at    timestamptz default now()
);
create table if not exists public.oauth_tokens (
  service       text primary key,
  client_id     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz default now()
);

-- ── match_entries RPC (чистая семантика) ────────────────────────────────────
-- LEGACY / fallback. Основной путь поиска — match_entries_hybrid (ниже). Оставлен для отката.
-- Returns group_id so consumers can enforce workspace isolation.
create or replace function public.match_entries(
  query_embedding text,
  match_threshold double precision default 0.3,
  match_count integer default 15,
  requesting_user_id bigint default null::bigint
)
returns table(
  id uuid, content text, summary text, source text, metadata jsonb,
  countries text[], entry_type text, entry_date date, group_id text,
  similarity double precision
)
language sql stable
set search_path to 'public', 'extensions'
as $function$
  select e.id, e.content, e.summary, e.source, e.metadata, e.countries,
         e.entry_type, e.entry_date, e.group_id,
         1 - (e.embedding <=> query_embedding::vector) as similarity
  from entries e
  where 1 - (e.embedding <=> query_embedding::vector) > match_threshold
    and (e.is_private = false
         or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$function$;

-- ── match_entries_hybrid RPC (основной поиск: full-text + семантика через RRF) ──
-- Мотив: чистая семантика на однотипных встречах коллапсирует (все тезисы в узкой полосе
-- cos ~0.29–0.67 → выдача «вразнобой»). Гибрид: full-text (русский tsvector) отделяет по
-- точному слову, семантика ловит смысл/переформулировку, RRF сливает; буст по стране (тег
-- countries — линза, не стена) и свежести (entry_date). query_text=null → чистая семантика.
create or replace function public.match_entries_hybrid(
  query_embedding text,
  query_text text default null,
  match_count int default 15,
  requesting_user_id bigint default null,
  filter_group_id text default null,
  filter_country text default null,
  filter_source text default null,
  full_text_weight float default 1.0,
  semantic_weight float default 1.0,
  country_weight float default 1.5,
  recency_weight float default 1.0,
  rrf_k int default 50,
  fresh_days int default 14,
  min_fresh int default 5
)
returns table(
  id uuid, content text, summary text, source text, metadata jsonb,
  countries text[], entry_type text, entry_date date, group_id text,
  similarity double precision
)
language sql stable
set search_path to 'public', 'extensions'
as $function$
with params as (
  select query_embedding::vector as qe, nullif(btrim(query_text), '') as qt
),
full_text as (
  select e.id,
    row_number() over (
      order by ts_rank_cd(e.fts, websearch_to_tsquery('russian', (select qt from params))) desc
    ) as rank_ix
  from public.entries e, params
  where params.qt is not null
    and e.fts @@ websearch_to_tsquery('russian', params.qt)
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by rank_ix
  limit least(match_count, 30) * 2
),
semantic as (
  select e.id,
    row_number() over (order by e.embedding <=> (select qe from params)) as rank_ix
  from public.entries e
  where e.embedding is not null
    and (filter_group_id is null or e.group_id = filter_group_id)
    and (filter_source is null or e.source = filter_source)
    and (e.is_private = false or (requesting_user_id is not null and e.owner_id = requesting_user_id))
  order by e.embedding <=> (select qe from params)
  limit least(match_count, 30) * 2
),
fused as (
  select
    e.id, e.content, e.summary, e.source, e.metadata, e.countries, e.entry_type, e.entry_date, e.group_id,
    (1 - (e.embedding <=> (select qe from params)))::double precision as similarity,
    coalesce(1.0 / (rrf_k + full_text.rank_ix), 0.0) * full_text_weight
    + coalesce(1.0 / (rrf_k + semantic.rank_ix), 0.0) * semantic_weight
    + (case when filter_country is not null and e.countries && array[filter_country]
            then country_weight / rrf_k else 0.0 end) as base_score,
    -- Ступенчатый буст свежести: чем свежее — тем больше (сильный скачок в окне fresh_days).
    (recency_weight / rrf_k) * (case
      when e.entry_date is null then 0.0
      when e.entry_date >= current_date - fresh_days     then 3.0
      when e.entry_date >= current_date - fresh_days * 2 then 1.5
      when e.entry_date >= current_date - fresh_days * 6 then 0.6
      else 0.0 end) as recency_bonus,
    (e.entry_date is not null and e.entry_date >= current_date - fresh_days) as is_fresh
  from full_text
  full outer join semantic on full_text.id = semantic.id
  join public.entries e on e.id = coalesce(full_text.id, semantic.id)
),
flagged as (
  select *, count(*) filter (where is_fresh) over () as fresh_count from fused
)
select id, content, summary, source, metadata, countries, entry_type, entry_date, group_id, similarity
from flagged
-- Окно свежести: если в окне fresh_days есть ≥ min_fresh кандидатов — только они; иначе добираем и старые.
where (fresh_count >= min_fresh and is_fresh) or (fresh_count < min_fresh)
order by base_score + recency_bonus desc
limit least(match_count, 30);
$function$;

-- ── default workspaces ──────────────────────────────────────────────────────
insert into public.workspaces (id, name) values
  ('cee',   'CEE'),
  ('other', 'Other Markets')
on conflict (id) do nothing;

-- ── storage bucket ──────────────────────────────────────────────────────────
-- Files attached to entries live in the `swarm_drive` bucket. Public-read by
-- design (see CLAUDE.md known risks). Create via dashboard or:
insert into storage.buckets (id, name, public)
values ('swarm_drive', 'swarm_drive', true)
on conflict (id) do nothing;
