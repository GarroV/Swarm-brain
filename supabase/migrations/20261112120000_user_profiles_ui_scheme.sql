-- Цветовая схема оформления — личная настройка пользователя (решение владельца 12.11.2026,
-- docs/decisions/2026-11-12-color-themes.md). NULL = схема по умолчанию («swarm», прежняя тема).
-- Список допустимых значений держит код (swarm-api PATCH /me, miniapp/src/lib/scheme.ts), а не
-- CHECK: новая схема не должна требовать миграции. Аддитивно: одна nullable-колонка, существующие
-- строки и другие таблицы не затрагиваются.
alter table public.user_profiles add column if not exists ui_scheme text;

comment on column public.user_profiles.ui_scheme is
  'Цветовая схема веба: swarm | redakciya | nuar | grafit | slivki | kontrast | laguna | sumerki | terminal | blyuprint | shveyc; NULL = по умолчанию (swarm). Режим светлая/тёмная — отдельно, в браузере. Проверяет swarm-api.';
