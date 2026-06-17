-- Таксономия: сводим entry_type к двум значениям {meeting, note}.
-- Файлы (по расширению source) → note даже при типе transcript/summary.
-- Исходный тип сохраняем в metadata.legacy_entry_type для обратимости.
UPDATE entries e
SET entry_type = sub.t,
    metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('legacy_entry_type', e.entry_type)
FROM (
  SELECT id,
    CASE
      WHEN source ~* '\.(pptx|xlsx|pdf|docx|doc|png|jpe?g|csv|txt)$' OR source IN ('pdf','image') THEN 'note'
      WHEN entry_type IN ('meeting','transcript')
        OR source IN ('granola','read_ai','desktop-agent','recorder')
        OR source ILIKE '%встреч%' OR source ILIKE '%transcript%' OR source ILIKE '%meeting%' THEN 'meeting'
      ELSE 'note'
    END AS t
  FROM entries
) sub
WHERE e.id = sub.id AND e.entry_type <> sub.t;
