-- Кому бот сообщает, что не смог записать встречу (решение владельца 12.11.2026,
-- docs/decisions/2026-11-12-bot-notices-to-all-participants.md): запустившему и остальным участникам
-- из Swarm, которые ПРИНЯЛИ встречу в календаре. Принятие видно только в Google-событии при обходе
-- календаря (`meetings.attendees` статуса ответа не хранит), поэтому список считается там же и
-- сохраняется вместе с заданием. meeting-notice читает его на сервере по ключу пропуска бота,
-- не из тела запроса.
--
-- Обратимость: только ADD COLUMN со значением по умолчанию; старый код колонку не знает. Откат —
-- `alter table public.meeting_calendar_jobs drop column notice_recipients;` после того, как код
-- перестанет её читать.

alter table public.meeting_calendar_jobs
  add column if not exists notice_recipients bigint[] not null default '{}';

comment on column public.meeting_calendar_jobs.notice_recipients is
  'telegram_id участников воркспейса, принявших встречу (accepted в Google-событии), кроме обязательного запустившего: им meeting-notice тоже шлёт нотисы бота. Пусто — только запустившему.';
