-- Мёртвый бэкенд зависимостей задач снесён (issue #4): фронт (вкладка «Граф»/DependencyGraph)
-- удалён при замене на «Проекты», эндпоинты /dependencies + _shared/tasks/dependencies.ts удалены
-- и задеплоены (шаг 1). Шаг 2 — дроп схемы. Таблица пустая (0 строк), inbound FK нет, триггеров нет.
drop table if exists public.task_dependencies cascade;
drop function if exists public.get_all_dependencies cascade;
