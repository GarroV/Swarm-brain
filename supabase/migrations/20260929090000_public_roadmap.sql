-- Публичная дорожная карта доски для хаба проектов (issue #562, просьба владельца 28.09.2026).
--
-- Хаб проектов на GitHub Pages забирает прямо в браузере, без токена, что сейчас в работе,
-- что запланировано и что выкатили. Отдаёт `GET /swarm-api/public/roadmap/:projectId`
-- (swarm-api/public-roadmap.ts). Выдача публичная по замыслу, поэтому два флага:
--
--   projects.public_roadmap — доска опубликована. По умолчанию false: ни одна доска не уходит
--                             наружу сама, публикация — осознанное действие.
--   tasks.hidden_from_hub   — задача доски не показывается на хабе, даже когда доска
--                             опубликована. По умолчанию false.
--
-- Только ADD COLUMN — безопасно: старый код новых колонок не видит.
alter table public.projects
  add column if not exists public_roadmap boolean not null default false;
alter table public.tasks
  add column if not exists hidden_from_hub boolean not null default false;

comment on column public.projects.public_roadmap is
  'Доска опубликована на хабе проектов: GET /swarm-api/public/roadmap/:id отдаёт её без авторизации (только название, задачи: title/state/due/shipped_at). false — 404. Issue #562.';
comment on column public.tasks.hidden_from_hub is
  'Не показывать задачу в публичной дорожной карте хаба, даже если доска опубликована. Issue #562.';

-- Первая опубликованная доска — «Vibe Coding»: её подпроекты и есть проекты хаба. Переключатель
-- в вебе — отдельная задача, до него флаг ставится здесь. На пустой базе (локальный контур, CI)
-- строки нет, и апдейт честно ничего не трогает.
update public.projects
   set public_roadmap = true
 where id = 'd8299ea3-6a8f-4e57-bbfb-4a9b0a53aea9';
