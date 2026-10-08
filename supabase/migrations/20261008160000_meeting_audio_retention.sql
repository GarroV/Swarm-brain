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
  select o.name
  from storage.objects o
  where o.bucket_id = 'meeting-audio'
    and o.created_at < now() - make_interval(days => p_days)
  order by o.created_at
  limit p_limit;
$$;

comment on function public.meeting_audio_expired(integer, integer) is
  'Пути частей аудио встреч старше p_days дней (бакет meeting-audio). Зовёт meeting-process раз в час.';

-- Грант на PUBLIC наследуется в anon/authenticated: снимать именно с PUBLIC.
revoke all on function public.meeting_audio_expired(integer, integer) from public, anon, authenticated;
grant execute on function public.meeting_audio_expired(integer, integer) to service_role;
