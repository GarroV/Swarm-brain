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
-- Решение «отправлять или хватит» принимает БАЗА, функцией meeting_notice_reserve (ниже): она
-- под блокировкой получателя считает журнал, решает и заводит строку — одной транзакцией.
-- Иначе потолки на встречу и на сутки обходились параллельными вызовами по разным встречам или
-- разным видам: каждый вызов видел журнал до вставок соседей. Уникальный индекс остаётся
-- страховкой от одинакового кортежа. Строка заводится ДО отправки (`sending`), после — `sent`
-- или `failed`. Недоставленная не занимает номер (индексы частичные), поэтому сбой Telegram не
-- съедает единственный повтор; `sending`, зависшая дольше порога (функция упала между резервом
-- и отметкой), считается недоставленной.
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

-- ── Резерв отправки: посчитать → решить → вставить атомарно ─────────────────────────────────
--
-- Порядок проверок и величины потолков — те же, что описаны в _shared/notices.ts; величины
-- приходят оттуда параметром p_limits, чтобы у числа был один дом. Возврат:
--   {"id": <строка журнала>, "attempt": <номер>}  — слот занят, можно слать;
--   {"refused": "<причина>"}                        — потолок, слать нельзя.
-- Блокировка — транзакционная advisory по получателю: вызовы одного человека выстраиваются в
-- очередь, разных людей друг друга не ждут. Снимается сама на конце транзакции (вызова RPC).
create or replace function public.meeting_notice_reserve(
  p_recipient   bigint,
  p_meeting_id  uuid,
  p_meeting_key text,
  p_kind        text,
  p_limits      jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_door_max        int := (p_limits->>'door_max')::int;
  v_per_kind        int := (p_limits->>'per_kind')::int;
  v_per_meeting     int := (p_limits->>'per_meeting')::int;
  v_per_day         int := (p_limits->>'per_day')::int;
  v_unbound_per_day int := (p_limits->>'unbound_per_day')::int;
  v_day             interval := make_interval(secs => (p_limits->>'day_seconds')::int);
  v_stale           interval := make_interval(secs => (p_limits->>'stale_seconds')::int);
  v_kind_count int;
  v_total      int;
  v_day_count  int;
  v_unbound    int;
  v_attempt    int;
  v_id         bigint;
begin
  if (p_meeting_id is null) = (p_meeting_key is null) then
    raise exception 'meeting_notice_reserve: exactly one of meeting_id / meeting_key is required';
  end if;
  if v_door_max is null or v_per_kind is null or v_per_meeting is null or v_per_day is null
     or v_unbound_per_day is null or v_day is null or v_stale is null then
    raise exception 'meeting_notice_reserve: p_limits is incomplete: %', p_limits;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('meeting_notices:' || p_recipient::text, 0));

  -- Зависшая отправка: функция упала между резервом и отметкой. Дольше порога — не доставлено.
  update public.meeting_notices
     set status = 'failed'
   where recipient_id = p_recipient and status = 'sending' and sent_at < now() - v_stale;

  select count(*) filter (where kind = p_kind), count(*)
    into v_kind_count, v_total
    from public.meeting_notices
   where recipient_id = p_recipient and status <> 'failed'
     and (meeting_id = p_meeting_id or meeting_key = p_meeting_key);

  select count(*), count(*) filter (where meeting_id is null)
    into v_day_count, v_unbound
    from public.meeting_notices
   where recipient_id = p_recipient and status <> 'failed' and sent_at > now() - v_day;

  if v_day_count >= v_per_day then
    return jsonb_build_object('refused',
      format('daily notice limit reached for this person: %s of %s in 24h', v_day_count, v_per_day));
  end if;
  if p_meeting_id is null and v_unbound >= v_unbound_per_day then
    return jsonb_build_object('refused',
      format('daily limit for pre-meeting notices reached: %s of %s in 24h', v_unbound, v_unbound_per_day));
  end if;
  if v_total >= v_per_meeting then
    return jsonb_build_object('refused',
      format('notice limit reached for this meeting: %s of %s already sent — the bot must leave', v_total, v_per_meeting));
  end if;
  if p_kind = 'door_waiting' then
    v_attempt := v_kind_count + 1;
    if v_attempt > v_door_max then
      return jsonb_build_object('refused',
        format('door notice limit reached: one reminder only (%s already sent) — the bot must leave', v_kind_count));
    end if;
  elsif v_kind_count >= v_per_kind then
    return jsonb_build_object('refused',
      format('already notified about «%s» for this meeting — repeating it adds nothing', p_kind));
  else
    v_attempt := 1;
  end if;

  insert into public.meeting_notices (meeting_id, meeting_key, recipient_id, kind, attempt, status)
  values (p_meeting_id, p_meeting_key, p_recipient, p_kind, v_attempt, 'sending')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'attempt', v_attempt);
end;
$$;

comment on function public.meeting_notice_reserve(bigint, uuid, text, text, jsonb) is
  'Резерв уведомления scriba: под блокировкой получателя считает журнал, решает по потолкам и заводит строку sending. Одна транзакция — параллельные вызовы потолок не обходят.';

-- EXECUTE — только service_role. Грант на PUBLIC наследуют anon и authenticated, и один
-- REVOKE FROM anon его не снимает — поэтому снимается с PUBLIC явно.
revoke all on function public.meeting_notice_reserve(bigint, uuid, text, text, jsonb) from public;
revoke all on function public.meeting_notice_reserve(bigint, uuid, text, text, jsonb) from anon, authenticated;
grant execute on function public.meeting_notice_reserve(bigint, uuid, text, text, jsonb) to service_role;
