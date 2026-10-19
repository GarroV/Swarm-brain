-- Здоровье ключа к нейронке (#233): сигнал «ключ перестал работать» админам пространства и баннер.
-- Миграция только создаёт новую таблицу; поведение для команды не меняет — пока код не пишет в неё,
-- она пуста. Состояние на (пространство, чей ключ обслуживал вызов): счёт подряд идущих сбоев,
-- идёт ли тревога, когда последний раз слали письмо (не чаще раза в сутки). Логика — _shared/ai-health.ts.
--
-- group_id = '' — вызов без пространства (ночные задачи): состояние ведём, слать письмо некому.
-- Внешнего ключа на workspaces нет намеренно: пустая строка — не пространство.
--
-- Обратимость: `drop table public.ai_key_health;` после того, как код перестанет её читать.

create table if not exists public.ai_key_health (
  group_id             text not null,
  source               text not null check (source in ('workspace', 'server')),
  failing              boolean not null default false,
  reason               text check (reason in ('rejected', 'quota', 'errors')),
  consecutive_failures integer not null default 0,
  first_failure_at     timestamptz,
  last_failure_at      timestamptz,
  last_success_at      timestamptz,
  last_alert_at        timestamptz,
  primary key (group_id, source)
);

comment on table public.ai_key_health is
  'Состояние ключа к нейронке по (пространство, свой/серверный ключ): идёт ли тревога, причина, когда слали письмо. Пишет _shared/ai-health.ts, читает админка. #233.';

-- Data API: явный грант service_role (supabase/migrations/_template_new_table.sql).
grant select, insert, update, delete on public.ai_key_health to service_role;

-- Внешний замок: RLS без политик. Грант на PUBLIC наследуется в anon, поэтому снимаем и с него.
alter table public.ai_key_health enable row level security;
revoke all on public.ai_key_health from public, anon, authenticated;
