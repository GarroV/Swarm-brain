-- Еженедельная рассылка дайджеста бота снята (решение владельца 14.11.2026, docs/decisions/2026-10-15-weekly-digest-not-needed.md).
-- Задание и так никому ничего не отправляло: выборка шла по несуществующей колонке. Идемпотентно.
do $$
begin
  -- Без pg_cron (CI, локальный контур) снимать нечего: выходим до обращения к cron.job.
  if to_regclass('cron.job') is null then
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'weekly-digest') then
    perform cron.unschedule('weekly-digest');
  end if;
end $$;
