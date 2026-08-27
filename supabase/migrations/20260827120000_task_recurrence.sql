-- Регулярные (циклические) задачи — решения владельца 2026-08-27,
-- канон: docs/decisions/2026-08-27-recurring-tasks.md
--
-- Модель: ОДНА строка задачи катится вперёд (как Todoist/Vikunja). Отметили готовой →
-- срок прыгает на следующее вхождение графика, статус снова «открыто». Экземпляров на каждое
-- вхождение НЕТ, отдельной таблицы шаблонов НЕТ.
--
-- День недели и число месяца отдельными колонками НЕ хранятся: они и есть срок задачи
-- (`due_date`). Единственное исключение — `recur_anchor_dom`: без него задача со сроком
-- 31 января после февральского зажатия (28-е) залипла бы на 28-м числе навсегда.
--
-- Только ADD COLUMN — безопасно, откат не требуется (NULL = обычная задача, как было).

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recur_freq       text;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS recur_anchor_dom smallint;

-- Частота приходит из веба, бота и MCP — замок на уровне БД, чтобы мусор («hourly») не осел
-- в данных молча. Код тоже проверяет (isRecurFreq), но он не единственный писатель.
ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_freq_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_freq_chk
  CHECK (recur_freq IS NULL OR recur_freq IN ('daily', 'weekly', 'monthly'));

ALTER TABLE public.tasks DROP CONSTRAINT IF EXISTS tasks_recur_anchor_dom_chk;
ALTER TABLE public.tasks ADD CONSTRAINT tasks_recur_anchor_dom_chk
  CHECK (recur_anchor_dom IS NULL OR recur_anchor_dom BETWEEN 1 AND 31);

COMMENT ON COLUMN public.tasks.recur_freq IS
  'Цикличность: daily | weekly | monthly. NULL = обычная задача. День недели (weekly) и число (monthly) берутся из due_date.';
COMMENT ON COLUMN public.tasks.recur_anchor_dom IS
  'Только для monthly: исходное число месяца (1–31), чтобы после зажатия по короткому месяцу вернуться к нему (31 янв → 28 фев → 31 мар), а не залипнуть на 28-м.';

-- Индекса нет намеренно: смарт-список «Регулярные» фильтруется на клиенте, как остальные
-- смарт-списки (сервер отдаёт задачи одним списком). Понадобится серверная фильтрация —
-- добавить частичный индекс WHERE recur_freq IS NOT NULL.
