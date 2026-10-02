-- Короткие ссылки: название и комментарий (issue #770, решение владельца 03.10.2026).
-- Только ADD COLUMN — безопасно. Название в базе допускает null (ссылки, созданные до этой
-- миграции), обязательность держит API (short-links-core.ts normalizeLinkMeta); длины — те же.
alter table public.short_links
  add column if not exists title text check (title is null or char_length(title) between 1 and 120),
  add column if not exists note text check (note is null or char_length(note) between 1 and 500);

comment on column public.short_links.title is 'Название ссылки для списка «Полезности»; обязательно при создании через API.';
comment on column public.short_links.note is 'Комментарий к ссылке, необязательный.';

-- Список пространства: все живые ссылки воркспейса, новые сверху.
create index if not exists short_links_group_created_idx
  on public.short_links (group_id, created_at desc)
  where archived_at is null;
