-- Перекрытие токена рекордера при перевыпуске.
--
-- Было: перевыпуск затирал recorder_token_hash, и старый токен умирал В ТОТ ЖЕ МИГ. Если человек
-- нажал «перевыпустить» и не довёл установку до конца, его рекордер продолжал писать встречи и
-- переставал их заливать — молча, до ручного разбора (issue #146).
--
-- Стало: прежний хэш переезжает в *_prev с коротким сроком и продолжает работать, пока новый не
-- заработает. Перекрытие гасится при первом успешном запросе с НОВЫМ токеном (_shared/agent-auth)
-- и при явном отзыве — то есть живёт минутами, а не сутками.
--
-- ⚠️ Это страховка, а не механизм. Ory про graceful rotation говорит прямо: окно ослабляет
-- обнаружение кражи токена, и правильный фикс — не требовать ротации там, где она не нужна.
-- Поэтому основное изменение в этой же задаче — установщик берёт уже прописанный токен из
-- локального конфига, и обновление рекордера токен вообще не трогает.
--
-- ADD COLUMN — безопасно, обратимо, старый код колонок не видит и работает как раньше.

ALTER TABLE public.allowed_users
  ADD COLUMN IF NOT EXISTS recorder_token_prev_hash text,
  ADD COLUMN IF NOT EXISTS recorder_token_prev_expires_at timestamptz;

COMMENT ON COLUMN public.allowed_users.recorder_token_prev_hash IS
  'Предыдущий токен рекордера на время перевыпуска: работает, пока новый не заработает. Гасится при первом успешном запросе с новым токеном или по истечении recorder_token_prev_expires_at.';
COMMENT ON COLUMN public.allowed_users.recorder_token_prev_expires_at IS
  'Докуда живёт перекрытие предыдущего токена рекордера (короткое — часы, не дни).';

-- Поиск по обоим хэшам идёт в горячем пути каждого запроса рекордера (agent-auth).
CREATE INDEX IF NOT EXISTS allowed_users_recorder_token_prev_hash_idx
  ON public.allowed_users (recorder_token_prev_hash)
  WHERE recorder_token_prev_hash IS NOT NULL;
