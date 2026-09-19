-- Приватный бакет swarm_private и заполнение реестра по уже лежащим файлам.
--
-- Без этого раскатка функций ломает вложения: `GET /file/*` ищет строку в storage_files и без
-- неё отвечает 404 (swarm-api/file-access.ts), а загрузка пишет в бакет, которого ещё нет.
--
-- Файлы пока ОСТАЮТСЯ в swarm_drive — поэтому bucket в реестре указывается явно. Физический
-- перенос в swarm_private делает scripts/storage-migrate.ts: ему нужен service-role ключ,
-- которого нет ни в CI (решение 2026-08-28 — не класть его в секреты публичного репозитория),
-- ни в рабочем окружении. До переноса раздача идёт с проверкой доступа, но прежние публичные
-- ссылки на эти пять объектов продолжают работать в обход — см. #279.
--
-- recorder/ НЕ трогаем ни здесь, ни в скрипте: установщик и апдейтер тянут сборки анонимно.

insert into storage.buckets (id, name, public)
values ('swarm_private', 'swarm_private', false)
on conflict (id) do nothing;

-- Скрины фидбека: admin-only, записи-владельца у них нет.
insert into public.storage_files (path, bucket, owner_kind, entry_id)
select o.name, 'swarm_drive', 'feedback', null
from storage.objects o
where o.bucket_id = 'swarm_drive'
  and o.name like 'feedback/%'
on conflict (path) do nothing;

-- Вложения записей: владельца ищем по ссылке в metadata. Объект без записи (сирота или
-- служебный .emptyFolderPlaceholder) в реестр не попадает — иначе нарушится
-- storage_files_entry_link, требующий entry_id для owner_kind='entry'.
insert into public.storage_files (path, bucket, owner_kind, entry_id)
select o.name, 'swarm_drive', 'entry', e.id
from storage.objects o
join lateral (
  select e.id from public.entries e
  where e.metadata->>'file_url' like '%' || o.name || '%'
  limit 1
) e on true
where o.bucket_id = 'swarm_drive'
  and o.name not like 'recorder/%'
  and o.name not like 'feedback/%'
on conflict (path) do nothing;
