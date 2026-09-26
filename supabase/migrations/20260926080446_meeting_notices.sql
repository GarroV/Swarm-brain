-- Журнал уведомлений об отказе (блок `notices`): что бот `scriba` уже сказал человеку.
-- Он же — единственный источник правды о том, сколько уведомлений ушло.
--
-- Зачем таблица, а не поле в запросе. До неё потолок повтора считался по числу `attempt`, которое
-- присылал сам бот, — то есть потолка не было вовсе: зацикленный контейнер шлёт `attempt: 1`
-- сколько угодно раз, и человек получает поток сообщений в личку. Ограничение, которое держится
-- на добросовестности того, кого ограничивают, — не ограничение. Теперь счёт ведёт сервер, а
-- присланный `attempt` не принимается вообще.
--
-- К чему привязана строка. Встречные отказы (дверь, капча, звук, потеря записи…) — к
-- `meeting_id`: бот к этому моменту прошёл meeting-claim, строка встречи есть, и сервер сверяет,
-- что она из воркспейса агента и что уведомляемый — её владелец. До-встречные отказы
-- (`no_conference_link`, `no_owner`) случаются раньше claim, строки встречи ещё нет — они
-- привязаны к ключу календаря (`meeting_key`, тот же формат, что meetings.identity_key). Ровно
-- одно из двух — это держит check-ограничение.
--
-- Гонка «два вызова одновременно» закрыта уникальным индексом: номер отправки считает сервер,
-- и второй вызов с тем же номером упирается в индекс, а не уходит человеку вторым сообщением.
-- Строка заводится ДО отправки (`sending`), после — `sent` или `failed`. Недоставленная не
-- занимает номер (индексы частичные), поэтому сбой Telegram не съедает единственный повтор.
--
-- Удаления у service_role нет: журнал — ответ на вопрос «что человеку уже сказали», историю не
-- переписывают. Меняется только статус. Чистка по сроку — отдельная миграция с отдельным грантом.
--
-- Обратимость: миграция только СОЗДАЁТ новый объект, существующего не трогает. Старый код о
-- таблице не знает и работает как раньше. Откат — `drop table public.meeting_notices;` (после
-- того, как код перестанет её читать: порядок «сначала код, потом схема», CLAUDE.md).

create table if not exists public.meeting_notices (
  id           bigserial primary key,
  -- Встреча встречного отказа. Встречи не удаляют (архивация), но журнал уходит вместе с ней.
  meeting_id   uuid references public.meetings(id) on delete cascade,
  -- Ключ календаря до-встречного отказа: '<iCalUID>:<YYYY-MM-DD>' из meeting-current —
  -- meetings.identity_key. Без внешнего ключа намеренно: строки встречи в этот момент ещё нет.
  meeting_key  text,
  -- Кому ушло. ВСЕГДА человек (identity.telegramId из resolveActingIdentity), не бот.
  recipient_id bigint not null references public.allowed_users(telegram_id) on delete cascade,
  -- Вид отказа: door_waiting | door_denied | captcha | no_conference_link | no_owner |
  -- no_audio | recording_lost | container_died | join_failed (_shared/notices.ts, NOTICE_KINDS).
  kind         text not null,
  -- Какая по счёту отправка этого вида. Для двери 1 — первое, 2 — единственный повтор.
  attempt      smallint not null check (attempt between 1 and 2),
  status       text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  sent_at      timestamptz not null default now(),
  constraint meeting_notices_one_scope check ((meeting_id is null) <> (meeting_key is null))
);

comment on table public.meeting_notices is
  'Журнал уведомлений бота scriba об отказе записи. Источник правды для потолка повторов: счёт ведёт сервер, а не бот.';
comment on column public.meeting_notices.meeting_id is
  'Встреча встречного отказа; сервер проверил воркспейс и владельца. NULL — у до-встречных видов.';
comment on column public.meeting_notices.meeting_key is
  'Ключ календаря до-встречного отказа (no_conference_link, no_owner): строки встречи ещё нет, FK нет.';
comment on column public.meeting_notices.recipient_id is
  'Кому ушло сообщение — всегда человек, за которого действует бот.';
comment on column public.meeting_notices.status is
  'sending — заведено до отправки; sent — Telegram ответил ok:true; failed — не доставлено, номер не занят.';

-- Один номер отправки одного вида — одна строка на встречу и человека. Недоставленные не в счёт.
create unique index if not exists meeting_notices_meeting_slot_uq
  on public.meeting_notices (meeting_id, recipient_id, kind, attempt)
  where meeting_id is not null and status <> 'failed';
create unique index if not exists meeting_notices_key_slot_uq
  on public.meeting_notices (meeting_key, recipient_id, kind, attempt)
  where meeting_key is not null and status <> 'failed';

-- Суточный счёт по человеку — на каждом вызове, обязан оставаться дешёвым при растущем журнале.
create index if not exists meeting_notices_recipient_sent_idx
  on public.meeting_notices (recipient_id, sent_at);

-- Data API: без явного гранта запросы service_role вернут 42501 после раскатки Supabase 30.10.2026
-- (см. supabase/migrations/_template_new_table.sql). delete не выдаётся осознанно — см. шапку.
grant select, insert, update on public.meeting_notices to service_role;
grant usage, select on sequence public.meeting_notices_id_seq to service_role;

-- RLS как внешний замок: включён, политик нет → anon/authenticated (anon-ключ публичен по дизайну)
-- не получают ни одной строки. Приложение ходит service_role'ом, у которого rolbypassrls.
alter table public.meeting_notices enable row level security;
