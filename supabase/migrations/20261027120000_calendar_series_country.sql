-- Страна созвона: одна метка на серию события календаря, общая для всех участников
-- (экран страны во время созвона, GET/PUT /board/call; решение владельца 27.10.2026, #1072).
-- Только ADD: существующие таблицы не меняются. RLS включён, политик нет — внешний замок,
-- как у остальных таблиц public: ходит только service_role (swarm-api).

CREATE TABLE public.calendar_series_country (
  group_id text NOT NULL REFERENCES public.workspaces(id),
  -- identity_key встречи без хвоста :YYYY-MM-DD (seriesKeyOf, _shared/calendar-series.ts)
  series_key text NOT NULL,
  country text NOT NULL,
  set_by bigint NOT NULL,
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, series_key)
);

ALTER TABLE public.calendar_series_country ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_series_country TO service_role;
