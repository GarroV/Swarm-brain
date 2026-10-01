-- Две таблицы стройки scriba выдавали anon/authenticated полный набор прав (issue #628).
-- Строк это не открывало — RLS включён, политик нет, — но остальные таблицы стройки эти права
-- снимают (meeting_invites, meeting_calendar_*, meeting_agent_grants), и эти две выбивались из
-- общего правила. Приложение ходит под service_role, его права не трогаем.
revoke all on public.service_agents from anon, authenticated;
revoke all on public.meeting_notices from anon, authenticated;
