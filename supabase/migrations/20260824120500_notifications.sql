-- ⚠️ Версия файла — 20260824120500, а НЕ 120000: под 120000 уже лежит
-- backfill_entry_owners, а Supabase CLI ведёт schema_migrations с PK по версии, и
-- вторая миграция с тем же номером роняла `supabase db reset` (issue #120) — контур
-- с нуля не собирался вообще. На прод миграции накатываются файлом напрямую
-- (docs/DEPLOY.md), поэтому смена номера там ничего не перезапускает; сам файл
-- идемпотентен (IF NOT EXISTS), повторный прогон безвреден.
--
-- Лента уведомлений: «к твоей задаче написали комментарий» (+ задел на назначения,
-- смены статуса и подписки — см. беклог). Аддитивно: новая таблица, ничего не меняется.
--
-- Почему таблица, а не вычислять ленту из task_comments на лету: следующие типы событий
-- разнородные (назначение, смена статуса, подписка) и одним запросом по комментариям не
-- собираются. `type` + nullable ссылки держат их в одной ленте без переделки схемы.
--
-- Уведомление живёт ровно столько, сколько его повод: удалили задачу или комментарий —
-- строка уходит каскадом, чинить сироты вручную не нужно.

CREATE TABLE IF NOT EXISTS public.notifications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_telegram_id bigint NOT NULL REFERENCES public.allowed_users(telegram_id) ON DELETE CASCADE,
  group_id              text REFERENCES public.workspaces(id),
  type                  text NOT NULL DEFAULT 'task_comment'
                        CHECK (type IN ('task_comment')),
  task_id               uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  comment_id            uuid REFERENCES public.task_comments(id) ON DELETE CASCADE,
  actor_telegram_id     bigint,
  read_at               timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now()
);

-- Основной запрос — «моя лента, новые сверху»; счётчик непрочитанных ходит тем же индексом
-- (read_at IS NULL — частичный индекс, чтобы не тащить прочитанный хвост).
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_telegram_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON public.notifications (recipient_telegram_id) WHERE read_at IS NULL;

-- Обязательный явный grant для Data API (см. migrations/_template_new_table.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO service_role;

-- RLS как внешний замок (issue #41): политик нет → anon/authenticated получают deny-all,
-- приложение не задето, т.к. ходит service_role (rolbypassrls).
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
