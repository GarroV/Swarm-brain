-- Авто-старт записи рекордером по календарю (#219): настройка человека в вебе, рекордер читает её
-- из meeting-current (`auto_start`). По умолчанию ВЫКЛЮЧЕНО: включение — осознанное действие
-- сотрудника, и именно оно делает запись личных встреч его ответственностью (решение 03.09.2026).
alter table public.user_profiles add column if not exists recorder_auto_start boolean not null default false;

comment on column public.user_profiles.recorder_auto_start is
  'Рекордер сам начинает запись встречи по календарю после 5-секундного отсчёта (#219). Пишет человек в вебе (PATCH /me), читает рекордер через meeting-current.auto_start. По умолчанию false.';
