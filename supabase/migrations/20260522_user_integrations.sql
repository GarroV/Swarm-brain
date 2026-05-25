create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),
  telegram_id bigint not null,
  service text not null,
  api_key text not null,
  last_polled_at timestamptz,
  skipped_note_ids text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique(telegram_id, service)
);
