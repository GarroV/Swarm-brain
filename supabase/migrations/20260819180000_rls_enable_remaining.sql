-- Включение RLS на пяти таблицах, где он оставался выключенным (issue #41).
--
-- Проблема. При включённом RLS на 13 таблицах public пять оставались открытыми: meetings,
-- meeting_live_notes, projects, sprints, task_labels. У ролей anon и authenticated на них полный
-- набор прав (SELECT/INSERT/UPDATE/DELETE/TRUNCATE), а anon-ключ Supabase публичен по дизайну.
-- Проверено фактически 2026-08-19: запрос к /rest/v1/meetings с anon-ключом возвращал реальные
-- встречи (id, title) — то есть содержимое разговоров команды читалось анонимно, а запись и
-- удаление были доступны так же.
--
-- Почему БЕЗ политик — и почему это не кладёт приложение.
-- Обычно «включить RLS без политик» = закрыть доступ всем и положить продукт. Здесь не так:
-- в Swarm НИ ОДИН клиент не ходит в базу напрямую ролями anon/authenticated.
--   * Edge Functions — только SERVICE_ROLE_KEY (41 вхождение на весь supabase/functions,
--     SUPABASE_ANON_KEY не используется нигде).
--   * Веб-интерфейс — через прокси /api → swarm-api с Bearer-сессией, без supabase-js в браузере
--     (anon-ключа нет ни в исходниках, ни в собранном бандле).
--   * Рекордер и бот — тоже через Edge Functions.
-- Проверено в pg_roles: service_role и postgres имеют rolbypassrls = true, поэтому приложение и
-- задачи pg_cron продолжают работать поверх RLS, а anon/authenticated (rolbypassrls = false)
-- получают deny-all — политик нет, значит не проходит ни одна строка.
--
-- Тем самым RLS здесь — не механизм авторизации (её по-прежнему делает КОД: checkAllowed,
-- visibilityFilter, entries-guard — см. CLAUDE.md), а внешний замок на прямой доступ к базе.
-- Если однажды клиент пойдёт в базу напрямую, политики придётся написать ДО этого — иначе он
-- упрётся в deny-all. Это осознанный размен: лучше явная поломка нового кода, чем тихо открытая
-- наружу таблица.
--
-- Обратимо: ALTER TABLE ... DISABLE ROW LEVEL SECURITY возвращает прежнее состояние.

ALTER TABLE public.meetings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_live_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sprints            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_labels        ENABLE ROW LEVEL SECURITY;
