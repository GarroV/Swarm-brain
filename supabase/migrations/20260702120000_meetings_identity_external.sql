-- Единый контракт транскрибаторов, этап 1: Granola пишет встречи в приёмную `meetings`.
-- Расширяем identity_kind — добавляем 'external' для источников, пишущих встречу напрямую
-- с готовыми тезисами (Granola, будущие webhook-источники), без device-транскрибации.
-- 'external' участвует в unique-дедупе (как calendar/room; исключён только 'manual').
--
-- Безопасно на prod: только замена CHECK-констрейнта на более широкий (существующие строки
-- 'calendar'/'room'/'manual' валидны и под новым правилом). Данные не трогаем.

alter table public.meetings drop constraint if exists meetings_identity_kind_check;
alter table public.meetings add constraint meetings_identity_kind_check
  check (identity_kind in ('calendar', 'room', 'manual', 'external'));
