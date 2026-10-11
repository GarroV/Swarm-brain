-- Стикеры-задания на главной (v1).
-- Канон: docs/decisions/2026-10-08-people-stickers-ratings-mail.md, раздел 2.
--
-- Владелец 08.10: «на стикер… тыкаешь, он разворачивается… И в нем видно, какие коллеги… к этому
-- стикеру подключены, и видно, выполнил он эту задачу или нет… при заведении стикера у каждого
-- из этих людей формируется задача с дедлайном, с описанием».
--
-- Модель:
--   board_stickers        — сам стикер воркспейса. kind: 'task' (каждому адресату заводится задача)
--                           или 'notice' (объявление: адресат отмечает «Понятно»).
--   board_sticker_people  — адресаты. task_id — задача, заведённая этому человеку (только у 'task'),
--                           acked_at — отметка «Понятно» (только у 'notice').
-- Задача адресата — обычная строка tasks с source = 'board_sticker'. Ограничения на tasks.source
-- в базе нет (колонка свободная), поэтому tasks здесь не меняется.
-- Ничего не удаляется физически: стикер уходит в архив (archived_at), задачи не трогаются.
-- Рассылок нет: создание стикера никому ничего не отправляет.

CREATE TABLE IF NOT EXISTS public.board_stickers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    text NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('task', 'notice')),
  title       text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT '' CHECK (char_length(body) <= 2000),
  due_at      timestamptz,
  tone        text NOT NULL DEFAULT 'yellow' CHECK (tone IN ('yellow', 'pink', 'blue', 'green', 'paper')),
  -- Только http(s) или путь внутри приложения: `javascript:` и `//host` база не пропустит.
  link        text CHECK (
    link IS NULL OR (
      char_length(link) <= 500
      AND link !~ '\s'
      AND link !~ '^//'
      AND link ~ '^(https?://|/)'
    )
  ),
  created_by  bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE INDEX IF NOT EXISTS board_stickers_group_idx
  ON public.board_stickers (group_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS public.board_sticker_people (
  sticker_id uuid NOT NULL REFERENCES public.board_stickers(id) ON DELETE CASCADE,
  person_id  uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  task_id    uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  acked_at   timestamptz,
  PRIMARY KEY (sticker_id, person_id)
);

CREATE INDEX IF NOT EXISTS board_sticker_people_person_idx ON public.board_sticker_people (person_id);

-- Внешний замок, как у всех таблиц public (#41): политик нет, ходит только service_role.
-- Права выдаём явно: на свежем контуре Supabase CLI их нет (см. миграцию справочника людей).
ALTER TABLE public.board_stickers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.board_sticker_people ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.board_stickers FROM anon, authenticated;
REVOKE ALL ON public.board_sticker_people FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_stickers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.board_sticker_people TO service_role;

COMMENT ON TABLE public.board_stickers IS
  'Стикеры на главной: задание (каждому адресату — задача) или объявление («Понятно»). Архивируются, не удаляются.';
COMMENT ON TABLE public.board_sticker_people IS
  'Адресаты стикера: task_id — заведённая им задача, acked_at — «Понятно» на объявлении.';
