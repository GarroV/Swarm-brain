-- Учёт расхода OpenAI на нашей стороне (issue #311, владелец 02.10.2026: «очень надо. заведи это
-- все в админскую панель»). Строку пишет _shared/model-usage.ts из externalFetch на каждый
-- удачный вызов OpenAI; читает админка (swarm-api GET /admin/model-usage).

create table if not exists public.model_usage (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null check (kind in ('chat', 'embedding', 'transcription', 'other')),
  model text,
  purpose text not null default 'unlabeled',
  meeting_id uuid,
  entry_id uuid,
  group_id text,
  prompt_tokens integer,
  completion_tokens integer,
  reasoning_tokens integer,
  audio_seconds numeric,
  cost_usd numeric(14, 6)
);

create index if not exists model_usage_created_at_idx on public.model_usage (created_at desc);
create index if not exists model_usage_meeting_idx on public.model_usage (meeting_id) where meeting_id is not null;

-- Внешний замок, как у всех таблиц public (issue #41): RLS без политик, читают только service_role.
alter table public.model_usage enable row level security;
revoke all on public.model_usage from anon, authenticated;

comment on table public.model_usage is
  'Расход OpenAI: строка на удачный вызов (#311). Пишет _shared/model-usage.ts, читает админка.';
comment on column public.model_usage.purpose is
  'Зачем звали модель: meeting:tezisy, meeting:transcription, web:embedding… unlabeled — вызов без подписи.';
comment on column public.model_usage.cost_usd is
  'Стоимость по ценам из _shared/model-usage.ts на день вызова; NULL — цена модели не задана.';
comment on column public.model_usage.meeting_id is
  'Встреча, на обработку которой ушёл вызов (контекст withUsageLabel); NULL — вызов не про встречу.';
