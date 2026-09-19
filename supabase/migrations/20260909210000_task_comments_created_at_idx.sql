-- Индекс под get_recent_comments (issue #276): инструмент читает «все комментарии позже since»
-- с сортировкой по времени вниз, а единственный индекс таблицы был по task_id — то есть
-- основной запрос дайджеста шёл seq scan'ом по всей таблице.
--
-- Сейчас таблица маленькая (99 строк на 09.09.2026) и разницы не видно — именно поэтому индекс
-- ставится сейчас, а не когда дайджест начнёт тормозить у всей команды.
--
-- ADD-операция: ничего не удаляет и не переписывает, безопасна для отката (DROP INDEX).

create index if not exists idx_task_comments_created_at
  on public.task_comments (created_at desc);

comment on index public.idx_task_comments_created_at is
  'get_recent_comments (#276): выборка комментариев за период, свежие первыми';
