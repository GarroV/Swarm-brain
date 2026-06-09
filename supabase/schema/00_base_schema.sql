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
  added_by              bigint not null,
  created_at            timestamptz not null default now(),
  is_admin              boolean not null default false,
  group_id              text references public.workspaces(id),
  claude_mcp_token_hash text
);
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
  owner_id   bigint references public.allowed_users(telegram_id)
);
create index if not exists entries_embedding_idx on public.entries using hnsw (embedding vector_cosine_ops);
create index if not exists entries_metadata_idx  on public.entries using gin (metadata);
create index if not exists entries_owner_id_idx   on public.entries (owner_id);
create index if not exists idx_entries_countries  on public.entries using gin (countries);
create index if not exists idx_entries_date        on public.entries (entry_date desc);
create index if not exists idx_entries_group       on public.entries (group_id);
create index if not exists idx_entries_type        on public.entries (entry_type);

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
  created_by_telegram_id bigint
);
create index if not exists idx_tasks_assignees on public.tasks using gin (assignees);
create index if not exists idx_tasks_due_date  on public.tasks (due_date);
create index if not exists idx_tasks_status    on public.tasks (status);
create index if not exists idx_tasks_tags      on public.tasks using gin (tags);

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
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  content    text not null,
  added_by   text not null,
  created_at timestamptz default now()
);

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
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null,
  username      text,
  text          text not null,
  photo_file_id text,
  created_at    timestamptz not null default now()
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

-- ── match_entries RPC (semantic search) ─────────────────────────────────────
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
