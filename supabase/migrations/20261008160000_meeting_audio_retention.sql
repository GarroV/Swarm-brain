-- Аудио встреч хранится неделю после обработки (решение владельца 08.10.2026,
-- docs/decisions/2026-10-08-meeting-audio-week.md): раньше части удалялись сразу по готовности,
-- и проверить обрезку тишины или модель распознавания было не на чем. Чистит тик meeting-process
-- (_shared/meeting-audio-retention.ts) по списку отсюда: удалять строки storage.objects SQL-ем
-- нельзя — файл остался бы в хранилище, удаление идёт через Storage API.
create or replace function public.meeting_audio_expired(p_days integer, p_limit integer)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  -- Срок не короче суток: ошибочный 0 или минус в вызове не должен снести всё аудио разом.
  -- Части встречи, которая ещё в обработке, и ждущая очередь второй записи не трогаются при любом
  -- возрасте: без них обработка упала бы на скачивании.
  select o.name
  from storage.objects o
  where o.bucket_id = 'meeting-audio'
    and o.created_at < now() - make_interval(days => greatest(p_days, 1))
    and o.name not like '%/queued/%'
    and not exists (
      select 1 from public.meetings m
      where m.id::text = split_part(o.name, '/', 1)
        and m.summary_status = 'processing'
    )
  order by o.created_at
  limit greatest(p_limit, 0);
$$;

comment on function public.meeting_audio_expired(integer, integer) is
  'Пути частей аудио встреч старше p_days дней (бакет meeting-audio). Зовёт meeting-process раз в час.';

-- Грант на PUBLIC наследуется в anon/authenticated: снимать именно с PUBLIC.
revoke all on function public.meeting_audio_expired(integer, integer) from public, anon, authenticated;
grant execute on function public.meeting_audio_expired(integer, integer) to service_role;
