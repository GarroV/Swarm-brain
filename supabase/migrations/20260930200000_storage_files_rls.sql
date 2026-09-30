-- RLS на реестре файлов Storage, как на всех таблицах public (issue #41): внешний замок без
-- политик — anon/authenticated не видят ни строки, service_role и postgres обходят RLS.
alter table public.storage_files enable row level security;
