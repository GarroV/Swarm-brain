-- Журнал уведомлений об отказе (блок `notices`): что бот `scriba` уже сказал человеку по этой
-- встрече. Он же — единственный источник правды о том, сколько уведомлений ушло.
--
-- Зачем таблица, а не поле в запросе. До неё потолок повтора считался по числу `attempt`, которое
-- присылал сам бот, — то есть потолка не было вовсе: зацикленный контейнер шлёт `attempt: 1`
-- сколько угодно раз, и человек получает поток сообщений в личку. Ограничение, которое держится
-- на добросовестности того, кого ограничивают, — не ограничение. Теперь счёт ведёт сервер, а
-- присланный `attempt` не принимается вообще.
--
-- Почему не колонка в `meetings`. Уведомление о двери приходит РАНЬШЕ, чем появляется строка
-- встречи: `meeting-current` отдаёт ключ из календаря, а строка `meetings` создаётся только на
-- `meeting-claim` — то есть после того, как бота впустили и он начал писать. Самый частый отказ
-- («не впустили») живёт именно в этом промежутке, и записывать его было бы некуда. Ключ здесь —
-- тот же `identity_key`, которым встреча опознаётся во всём продукте, поэтому журнал сходится с
-- `meetings`, когда строка появится.
--
-- Дополнять журнал — только вставкой: он одновременно ответ на вопрос «что человеку уже сказали».
-- Поэтому у `service_role` здесь нет `update`/`delete`: не задел на будущее, а запрет переписывать
-- историю уведомлений. Понадобится чистка по сроку — это отдельная миграция с отдельным грантом.
--
-- Обратимость: миграция только СОЗДАЁТ новый объект, существующего не трогает. Старый код о
-- таблице не знает и работает как раньше. Откат — `drop table public.meeting_notices;` (после
-- того, как код перестанет её читать: порядок «сначала код, потом схема», CLAUDE.md).

create table if not exists public.meeting_notices (
  id           bigserial primary key,
  -- Ключ встречи: '<iCalUID>:<YYYY-MM-DD>' | 'meet:<code>' | 'manual:<uuid>' — тот же, что
  -- meetings.identity_key. Без внешнего ключа намеренно: строки встречи в этот момент ещё нет.
  meeting_key  text not null,
  -- Кому ушло. ВСЕГДА человек (identity.telegramId из resolveActingIdentity), не бот.
  recipient_id bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- Вид отказа: door_waiting | door_denied | captcha | no_conference_link | no_owner |
  -- no_audio | recording_lost | container_died | join_failed (_shared/notices.ts, NOTICE_KINDS).
  kind         text not null,
  sent_at      timestamptz not null default now()
);

comment on table public.meeting_notices is
  'Журнал уведомлений бота scriba об отказе записи. Источник правды для потолка повторов: счёт ведёт сервер, а не бот.';
comment on column public.meeting_notices.meeting_key is
  'meetings.identity_key встречи. Без FK: уведомление о двери приходит раньше, чем создаётся строка встречи (claim).';
comment on column public.meeting_notices.recipient_id is
  'Кому ушло сообщение — всегда человек, за которого действует бот.';

-- Счёт всегда по паре «встреча + получатель»: ровно этот запрос делает meeting-notice на каждом
-- вызове, и он обязан оставаться дешёвым при растущем журнале.
create index if not exists meeting_notices_key_recipient_idx
  on public.meeting_notices (meeting_key, recipient_id);

-- Data API: без явного гранта запросы service_role вернут 42501 после раскатки Supabase 30.10.2026
-- (см. supabase/migrations/_template_new_table.sql). update/delete не выдаются осознанно — см. шапку.
grant select, insert on public.meeting_notices to service_role;
grant usage, select on sequence public.meeting_notices_id_seq to service_role;

-- RLS как внешний замок: включён, политик нет → anon/authenticated (anon-ключ публичен по дизайну)
-- не получают ни одной строки. Приложение ходит service_role'ом, у которого rolbypassrls.
alter table public.meeting_notices enable row level security;
