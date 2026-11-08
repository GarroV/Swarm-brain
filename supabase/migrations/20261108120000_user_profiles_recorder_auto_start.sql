-- Авто-старт записи рекордером по календарю (#219): настройка человека в вебе и в меню рекордера,
-- рекордер читает её из meeting-current (`auto_start`). По умолчанию ВКЛЮЧЕНО: решение владельца
-- 18.09.2026 (docs/decisions/2026-09-18-autostart-by-call-detection.md) — плановый созвон из календаря
-- стартует сам, как у Granola; 5-секундный отсчёт с отменой остаётся (решение 03.09.2026). Выключить
-- может каждый. Существующие строки получают true вместе с колонкой.
alter table public.user_profiles add column if not exists recorder_auto_start boolean not null default true;

comment on column public.user_profiles.recorder_auto_start is
  'Рекордер сам начинает запись планового созвона из календаря после 5-секундного отсчёта (#219, решение 2026-09-18). Пишет человек в вебе (PATCH /me) или в меню рекордера (POST meeting-current/auto-start); читает рекордер через meeting-current.auto_start. По умолчанию true.';
