-- Невычитанная встреча больше не попадает в общий поиск (issue #70).
--
-- Проблема. match_entries фильтровала только приватность:
--     e.is_private = false OR (requesting_user_id is not null AND e.owner_id = requesting_user_id)
-- Про `metadata.confirmed` в ней не было ни слова. А `read-ai-webhook` создаёт встречу без
-- `is_private` (дефолт колонки — false) и с `confirmed: false`, поэтому сырой транскрипт и
-- тезисы находились поиском ВСЕЙ командой ещё до того, как автор их вычитал.
-- Воспроизведено на проде до правки: тестовая запись с confirmed=false возвращалась из
-- match_entries. Фикс очереди вычитки (#66) это не закрывал — поиск ходит мимо того гарда,
-- напрямую в эту функцию.
--
-- Решение владельца 2026-08-22, вариант 1: несогласованную встречу из поиска убрать совсем.
-- Черновику не место в общей базе знаний; тому, кто её вычитывает, она доступна в очереди
-- вычитки (GET /meetings?confirmed=false), а не через поиск.
--
-- Границы правила:
--   * касается ТОЛЬКО entry_type='meeting' — заметки, документы и прочее поля `confirmed`
--     не имеют и фильтроваться по нему не должны;
--   * `coalesce(..., 'false')` — fail-closed: встреча без поля считается невычитанной.
--     Проверено на проде: поле есть у всех 216 встреч (213 true + 3 false), то есть ни одна
--     существующая запись из поиска не выпадает, кроме трёх реально невычитанных.
--
-- Обратимо: вернуть прежнее поведение = убрать блок `and (... entry_type <> 'meeting' ...)`.

CREATE OR REPLACE FUNCTION public.match_entries(
  query_embedding text,
  match_threshold double precision DEFAULT 0.3,
  match_count integer DEFAULT 15,
  requesting_user_id bigint DEFAULT NULL::bigint
)
RETURNS TABLE(
  id uuid, content text, summary text, source text, metadata jsonb,
  countries text[], entry_type text, entry_date date, group_id text, similarity double precision
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions'
AS $function$
  select
    e.id,
    e.content,
    e.summary,
    e.source,
    e.metadata,
    e.countries,
    e.entry_type,
    e.entry_date,
    e.group_id,
    1 - (e.embedding <=> query_embedding::vector) as similarity
  from entries e
  where
    1 - (e.embedding <=> query_embedding::vector) > match_threshold
    and (
      e.is_private = false
      or (requesting_user_id is not null and e.owner_id = requesting_user_id)
    )
    -- Невычитанная встреча в поиск не попадает (issue #70).
    and (
      e.entry_type <> 'meeting'
      or coalesce(e.metadata->>'confirmed', 'false') = 'true'
    )
  order by e.embedding <=> query_embedding::vector
  limit match_count;
$function$;
