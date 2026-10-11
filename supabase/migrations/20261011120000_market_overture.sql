-- Второй машинный источник точек — Overture Maps (рядом с OSM). Только расширение списка.
alter table public.mkt_locations drop constraint mkt_locations_source_kind_check;
alter table public.mkt_locations add constraint mkt_locations_source_kind_check
  check (source_kind in ('snapshot','dodo','osm','overture','manual'));
