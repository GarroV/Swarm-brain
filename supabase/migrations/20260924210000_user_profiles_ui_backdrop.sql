-- Задник интерфейса — личная настройка пользователя (решение владельца 24.09.2026,
-- docs/decisions/2026-09-24-backdrop.md). NULL = значение по умолчанию (галактика).
-- Список допустимых значений держит код (swarm-api PATCH /me и miniapp/src/lib/backdrop.ts),
-- а не CHECK: новый вариант задника не должен требовать миграции.
alter table public.user_profiles add column if not exists ui_backdrop text;

comment on column public.user_profiles.ui_backdrop is
  'Фон веба: galaxy | none | dots | aurora | custom (своя картинка — в браузере, не на сервере); NULL = по умолчанию (galaxy). Проверяет swarm-api.';
