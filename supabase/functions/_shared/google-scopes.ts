// Google OAuth scope: что просим на входе и что реально выдали.
//
// Решение владельца 2026-08-28 (docs/decisions/2026-08-28-google-login-connects-calendar.md):
// календарь просим сразу на экране входа, как Granola. Google при нескольких scope показывает
// granular-экран, где человек может СНЯТЬ галочку календаря — и требует от приложения
// «always check which scopes were granted... and handle any denial by disabling relevant features».
// Поэтому выданные права разбираются явно, а не предполагаются.

export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events.readonly";
export const LOGIN_SCOPES = `openid email profile ${CALENDAR_SCOPE}`;

// Ответ Google на обмен кода несёт фактически выданные scope одной строкой через пробел.
// Сравниваем целыми элементами: `calendar.events` и `calendar.readonly` — ДРУГИЕ права,
// подстрочное совпадение приняло бы их за наши.
export function hasCalendarScope(granted: string | null | undefined): boolean {
  if (!granted) return false;
  return granted.split(/\s+/).filter(Boolean).includes(CALENDAR_SCOPE);
}
