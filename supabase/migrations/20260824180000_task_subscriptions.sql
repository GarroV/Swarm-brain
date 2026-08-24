-- Подписка на уведомления о комментариях к задаче (issue #82).
-- Решение владельца — docs/decisions/2026-08-24-comment-subscription.md:
-- «написал комментарий — как бы подписался», и в той же карточке кнопка отписаться.
-- Подписка задумана РАДИ админа: он ведёт 4-5 человек и не может обходить карточки руками,
-- а оверсайт над задачами у него уже есть, поэтому уведомление ничего нового не открывает.
--
-- Аддитивно: новая таблица, существующие не меняются. Строка появляется ТОЛЬКО когда
-- человек явно участвовал (комментарий) или сам щёлкнул тумблер. Нет строки = поведение
-- по умолчанию (причастные к задаче получают, остальные нет) — то есть таблица описывает
-- ИСКЛЮЧЕНИЯ, а не весь круг получателей.
--
-- Подписка живёт ровно столько, сколько её повод: удалили задачу или человека — строка
-- уходит каскадом.

CREATE TABLE IF NOT EXISTS public.task_subscriptions (
  task_id     uuid   NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  telegram_id bigint NOT NULL REFERENCES public.allowed_users(telegram_id) ON DELETE CASCADE,
  -- subscribed — уведомлять, даже если человек к задаче не причастен;
  -- muted      — НЕ уведомлять, даже если причастен (явный отказ сильнее умолчания).
  state       text NOT NULL DEFAULT 'subscribed' CHECK (state IN ('subscribed', 'muted')),
  -- Откуда взялась строка: 'comment' — авто-подписка по участию, 'manual' — тумблер в карточке.
  -- Нужно для текста «вы подписаны, потому что комментировали».
  reason      text NOT NULL DEFAULT 'comment' CHECK (reason IN ('comment', 'manual')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, telegram_id)
);

-- Основной запрос — «кто подписан на эту задачу» при рассылке комментария.
CREATE INDEX IF NOT EXISTS idx_task_subscriptions_task
  ON public.task_subscriptions (task_id);

-- Обязательный явный grant для Data API (см. migrations/_template_new_table.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_subscriptions TO service_role;

-- RLS как внешний замок (issue #41): политик нет → anon/authenticated получают deny-all,
-- приложение не задето, т.к. ходит service_role (rolbypassrls).
ALTER TABLE public.task_subscriptions ENABLE ROW LEVEL SECURITY;
