-- ============================================================
-- Swarm Brain — начальная схема БД
-- Применять первым на чистом Supabase-проекте.
-- ============================================================

-- ── Расширения ────────────────────────────────────────────────────────────────

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ── Воркспейсы (тенанты) ─────────────────────────────────────────────────────

create table if not exists workspaces (
  id         text primary key,
  name       text not null,
  created_at timestamptz default now()
);

-- ── Белый список пользователей ────────────────────────────────────────────────

create table if not exists allowed_users (
  id                    bigserial primary key,
  telegram_id           bigint unique,
  username              text,
  added_by              bigint not null,
  created_at            timestamptz not null default now(),
  is_admin              boolean not null default false,
  group_id              text references workspaces(id),
  claude_mcp_token_hash text,
  claude_mcp_token_expires_at timestamptz
);

create index if not exists allowed_users_mcp_token_hash_idx
  on allowed_users(claude_mcp_token_hash)
  where claude_mcp_token_hash is not null;

-- ── Профили пользователей ─────────────────────────────────────────────────────

create table if not exists user_profiles (
  telegram_id  bigint primary key references allowed_users(telegram_id) on delete cascade,
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

-- ── База знаний ───────────────────────────────────────────────────────────────

create table if not exists entries (
  id         uuid primary key default gen_random_uuid(),
  content    text not null,
  embedding  vector,
  added_by   text,
  source     text default 'manual',
  metadata   jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  summary    text,
  countries  text[] default '{}',
  entry_type text default 'note',
  entry_date date,
  group_id   text references workspaces(id),
  is_private boolean not null default false,
  owner_id   bigint references allowed_users(telegram_id)
);

create index if not exists entries_embedding_idx on entries using hnsw (embedding vector_cosine_ops);
create index if not exists entries_metadata_idx  on entries using gin  (metadata);
create index if not exists entries_owner_id_idx  on entries(owner_id);
create index if not exists idx_entries_countries on entries using gin  (countries);
create index if not exists idx_entries_date      on entries(entry_date desc);
create index if not exists idx_entries_group     on entries(group_id);
create index if not exists idx_entries_type      on entries(entry_type);

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger entries_updated_at
  before update on entries
  for each row execute function update_updated_at();

-- ── Семантический поиск (RPC) ─────────────────────────────────────────────────

create or replace function match_entries(
  query_embedding    text,
  match_threshold    float  default 0.3,
  match_count        int    default 15,
  requesting_user_id bigint default null
)
returns table (
  id         uuid,
  content    text,
  summary    text,
  source     text,
  metadata   jsonb,
  countries  text[],
  entry_type text,
  entry_date date,
  similarity float
)
language sql stable
set search_path to 'public', 'extensions'
as $$
  select
    e.id, e.content, e.summary, e.source, e.metadata,
    e.countries, e.entry_type, e.entry_date,
    1 - (e.embedding <=> query_embedding::vector) as similarity
  from entries e
  where
    1 - (e.embedding <=> query_embedding::vector) > match_threshold
    and (
      e.is_private = false
      or (requesting_user_id is not null and e.owner_id = requesting_user_id)
    )
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$$;

create or replace function search_entries_by_country(country_query text)
returns table (id uuid, content text, summary text, source text)
language sql stable as $$
  select id, content, summary, source
  from entries
  where exists (
    select 1 from unnest(countries) c
    where c ilike '%' || country_query || '%'
  )
  order by created_at desc
  limit 5;
$$;

-- ── Сессии бота ───────────────────────────────────────────────────────────────

create table if not exists sessions (
  chat_id    bigint primary key,
  action     text not null,
  created_at timestamptz not null default now(),
  context    text,
  updated_at timestamptz not null default now()
);

-- ── Задачи ────────────────────────────────────────────────────────────────────

create table if not exists tasks (
  id                    uuid primary key default gen_random_uuid(),
  title                 text not null,
  assignees             text[] default '{}',
  due_date              date,
  status                text not null default 'open',
  tags                  text[] default '{}',
  meeting_id            text,
  created_by            text not null default 'system',
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  url                   text,
  description           text,
  source                text not null default 'manual',
  country               text,
  task_role             text,
  assignee_telegram_ids bigint[] not null default '{}',
  group_id              text references workspaces(id)
);

create index if not exists idx_tasks_assignees on tasks using gin (assignees);
create index if not exists idx_tasks_due_date  on tasks(due_date);
create index if not exists idx_tasks_status    on tasks(status);
create index if not exists idx_tasks_tags      on tasks using gin (tags);

create table if not exists task_history (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks(id) on delete cascade,
  changed_by text not null,
  old_status text,
  new_status text,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_history_task_id on task_history(task_id);

create table if not exists task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null,
  content    text not null,
  added_by   text not null,
  created_at timestamptz default now()
);

-- ── Фидбек ────────────────────────────────────────────────────────────────────

create table if not exists feedback (
  id            uuid primary key default gen_random_uuid(),
  telegram_id   bigint not null,
  username      text,
  text          text not null,
  photo_file_id text,
  created_at    timestamptz not null default now()
);

-- ── Настройки приложения ──────────────────────────────────────────────────────

create table if not exists app_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ── OAuth (Read.ai) ───────────────────────────────────────────────────────────

create table if not exists oauth_tokens (
  service       text primary key,
  client_id     text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz default now()
);

create table if not exists oauth_state (
  state         text primary key,
  client_id     text not null,
  code_verifier text not null,
  created_at    timestamptz default now()
);

-- ── Интеграции пользователей (Granola и др.) ──────────────────────────────────

create table if not exists user_integrations (
  id               uuid primary key default gen_random_uuid(),
  telegram_id      bigint not null,
  service          text not null,
  api_key          text not null,
  last_polled_at   timestamptz,
  skipped_note_ids text[] not null default '{}',
  created_at       timestamptz not null default now(),
  unique(telegram_id, service)
);

-- ── MCP-токены ────────────────────────────────────────────────────────────────

create or replace function generate_mcp_token(p_telegram_id bigint)
returns text language plpgsql security definer as $$
declare
  v_token text;
begin
  v_token := 'smcp_' || gen_random_uuid()::text;
  update allowed_users
    set claude_mcp_token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        claude_mcp_token_expires_at = now() + interval '90 days'
    where telegram_id = p_telegram_id;
  if not found then
    raise exception 'User % not found in allowed_users', p_telegram_id;
  end if;
  return v_token;
end;
$$;

create or replace function generate_mcp_token(p_telegram_id integer)
returns text language sql security definer as $$
  select generate_mcp_token(p_telegram_id::bigint);
$$;

create or replace function revoke_mcp_token(p_telegram_id bigint)
returns void language sql security definer as $$
  update allowed_users
    set claude_mcp_token_hash = null,
        claude_mcp_token_expires_at = null
    where telegram_id = p_telegram_id;
$$;

create or replace function revoke_mcp_token(p_telegram_id integer)
returns void language sql security definer as $$
  select revoke_mcp_token(p_telegram_id::bigint);
$$;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Все таблицы закрыты — доступ только через service_role (Edge Functions).
-- anon/authenticated роли не имеют доступа.

alter table workspaces         enable row level security;
alter table allowed_users      enable row level security;
alter table user_profiles      enable row level security;
alter table entries             enable row level security;
alter table sessions            enable row level security;
alter table tasks               enable row level security;
alter table task_history        enable row level security;
alter table task_comments       enable row level security;
alter table feedback            enable row level security;
alter table app_settings        enable row level security;
alter table oauth_tokens        enable row level security;
alter table oauth_state         enable row level security;
alter table user_integrations   enable row level security;

create policy "service_role_all" on workspaces        for all to service_role using (true) with check (true);
create policy "service_role_all" on allowed_users     for all to service_role using (true) with check (true);
create policy "service_role_all" on user_profiles     for all to service_role using (true) with check (true);
create policy "service_role_all" on entries           for all to service_role using (true) with check (true);
create policy "service_role_all" on sessions          for all to service_role using (true) with check (true);
create policy "service_role_all" on tasks             for all to service_role using (true) with check (true);
create policy "service_role_all" on task_history      for all to service_role using (true) with check (true);
create policy "service_role_all" on task_comments     for all to service_role using (true) with check (true);
create policy "service_role_all" on feedback          for all to service_role using (true) with check (true);
create policy "service_role_all" on app_settings      for all to service_role using (true) with check (true);
create policy "service_role_all" on oauth_tokens      for all to service_role using (true) with check (true);
create policy "service_role_all" on oauth_state       for all to service_role using (true) with check (true);
create policy "service_role_all" on user_integrations for all to service_role using (true) with check (true);

grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
