-- Справка «О проекте» (просьба владельца 27.09.2026): зачем проект ведётся, что это такое и
-- ссылки на его артефакты. Показывается всплывашкой у значка ⓘ в шапке проекта на доске.
-- Только ADD COLUMN — безопасно, старый код новых колонок просто не видит.
alter table public.projects add column if not exists goal        text;
alter table public.projects add column if not exists description text;
-- Ссылки: массив {title, url}. Проверка формы — в коде (swarm-api/project-fields.ts), здесь
-- только тип: пустой массив по умолчанию, чтобы читателю не разбирать null и [] как разное.
alter table public.projects add column if not exists links jsonb not null default '[]'::jsonb;

comment on column public.projects.goal is 'Зачем ведём проект — 1–3 строки (справка «О проекте»).';
comment on column public.projects.description is 'Что это за проект — свободный текст (справка «О проекте»).';
comment on column public.projects.links is 'Ссылки на артефакты проекта: [{title, url}], url только http(s).';
