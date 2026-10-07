-- Задание pg_cron для снимка календарей (issue #820).
--
-- Функцию meeting-calendar-snapshot раскатали 28.09.2026, а её cron по документации заводился
-- «вручную в проде» — и заведён не был. Таблица meeting_calendar_snapshot_runs пустая, поэтому
-- meeting-missed каждому отвечает checked=false, а рекордер пишет в меню «Календарь сегодня не сверен».
--
-- Секрет cron в git не кладём: он вписан в команды живых заданий. Берём команду meetings-process
-- (тот же X-Cron-Secret, тот же адрес проекта) и меняем в ней только функцию. Плюс запас по времени:
-- снимок ходит в Google за каждым человеком, а по умолчанию pg_net ждёт ответа 5 секунд.
--
-- Где задания meetings-process нет (локальный контур, CI) — задание не заводим: без секрета
-- вызов всё равно получил бы 403. Есть, но подмена не сработала — падаем, а не заводим
-- задание, молча вызывающее не ту функцию.
do $$
declare
  src text;
  cmd text;
begin
  if to_regclass('cron.job') is null then
    raise notice 'pg_cron нет — задание снимка календарей не заводим';
    return;
  end if;

  select command into src from cron.job where jobname = 'meetings-process';
  if src is null then
    raise notice 'задания meetings-process нет — снимок календарей не заводим (не прод)';
    return;
  end if;

  cmd := replace(src, '/functions/v1/meeting-process''', '/functions/v1/meeting-calendar-snapshot''');
  cmd := replace(cmd, 'body := ''{}''::jsonb,', 'body := ''{}''::jsonb,' || chr(10) || '    timeout_milliseconds := 120000,');
  if cmd not like '%/functions/v1/meeting-calendar-snapshot''%' or cmd not like '%timeout_milliseconds := 120000%' then
    raise exception 'команда meetings-process не того вида — задание снимка календарей не собрано';
  end if;

  -- Раз в час: какой час снимать (08/11/12 по Белграду), решает сама функция.
  perform cron.schedule('scriba-calendar-snapshot', '0 * * * *', cmd);
end
$$;
