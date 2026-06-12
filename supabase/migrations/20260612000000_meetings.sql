-- supabase/migrations/20260612000000_meetings.sql
-- Swarm Meetings (замена Read.ai/Granola): источник истины о встрече.
--
-- Модель (см. transcribator/10-REVISED-DESIGN.md):
--   meetings — операционная запись встречи (транскрипт, черновик тезисов, claim).
--   entries  — тезисы как искомый артефакт, СОЗДАЁТСЯ ТОЛЬКО ПРИ ПУБЛИКАЦИИ
--              (status → in_base). До публикации черновик живёт в meetings.draft_notes_md
--              и в поиск/базу знаний не попадает.
--   Личные пометки участников — приватные entries (is_private, owner_id) с
--              metadata.meeting_id; отдельной таблицы НЕ заводим (переиспользуем
--              личное хранилище и поиск «своё+общее»).
--
-- Additive — безопасно на prod (CREATE TABLE + indexes, существующие таблицы не трогаем).

create table if not exists public.meetings (
  id               uuid primary key default gen_random_uuid(),
  source           text not null default 'desktop-agent',  -- продюсер: desktop-agent | будущие
  -- Идентичность реальной встречи (для дедупа нескольких записавших):
  --   calendar → '<iCalUID>:<YYYY-MM-DD>' (с датой экземпляра для повторов)
  --   room     → 'meet:<code>' | 'kontur:<room>' (id комнаты из URL звонка)
  --   manual   → 'manual:<uuid>' (Telegram/кнопка — без авто-дедупа)
  identity_kind    text not null check (identity_kind in ('calendar','room','manual')),
  identity_key     text not null,
  title            text,
  started_at       timestamptz,
  ended_at         timestamptz,
  attendees        jsonb not null default '[]',   -- из календаря, если есть
  recorders        jsonb not null default '[]',   -- [{telegram_id, claimed_at, role}] — кто реально записал
  claim_owner      bigint references public.allowed_users(telegram_id),  -- кто транскрибирует
  lease_expires_at timestamptz,                    -- TTL claim'а (для перехвата, если claimer сорвался)
  transcript       jsonb,                          -- {language, model, segments:[{start,end,text}]}
  draft_notes_md   text,                           -- сгенерированные тезисы (черновик до публикации)
  notes_edited_at  timestamptz,                    -- человек правил черновик → не перегенерировать
  entry_id         uuid references public.entries(id) on delete set null,  -- запись в базе (при публикации)
  group_id         text references public.workspaces(id),  -- резолвится из токена владельца, НЕ из payload
  status           text not null default 'awaiting_review'
                   check (status in ('awaiting_review','in_base')),
  agent_version    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Дедуп реальной встречи: один экземпляр на ключ. manual исключаем (он уникален сам и
-- авто-дедупу не подлежит — для Telegram/кнопки дубли ловятся ручным «объединить» в вебе).
create unique index if not exists meetings_identity_key_uq
  on public.meetings (identity_key)
  where identity_kind <> 'manual';

create index if not exists idx_meetings_status    on public.meetings (status);
create index if not exists idx_meetings_group     on public.meetings (group_id);
create index if not exists idx_meetings_entry     on public.meetings (entry_id) where entry_id is not null;
create index if not exists idx_meetings_recorders on public.meetings using gin (recorders);

-- Required: explicit grant for Data API access (PostgREST / supabase-js с service_role).
grant select, insert, update, delete on public.meetings to service_role;
