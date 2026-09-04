// Доступ к Google Calendar по серверной OAuth-интеграции. Один модуль на всех потребителей:
// `meeting-current` (какая встреча идёт сейчас — для рекордера) и `swarm-api /calendar/today`
// (панель «Встречи сегодня» на главной, issue #218).
//
// Вынесено из meeting-current 03.09.2026: вторая копия обмена refresh→access и запроса
// событий гарантированно разъехалась бы с первой — ровно тот случай, про который в
// documentation.md написано «дубли = главный источник дрифта».
import type { GEvent } from "../meeting-current/select.ts";

const CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") ?? "";

/** refresh_token → access_token. `null` при любой осечке: молча не обновляемся, а не падаем. */
export async function accessToken(refresh: string): Promise<string | null> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) return null;
  return (await res.json()).access_token ?? null;
}

/** События основного календаря в окне. `null` — Google ответил ошибкой (её отличаем от «пусто»). */
export async function listEvents(token: string, timeMin: string, timeMax: string, maxResults = 25): Promise<GEvent[] | null> {
  const q = new URLSearchParams({
    singleEvents: "true",          // повторяющиеся раскрываются в экземпляры, иначе слот без даты
    orderBy: "startTime",
    timeMin,
    timeMax,
    maxResults: String(maxResults),
  });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${q}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return ((await res.json()).items ?? []) as GEvent[];
}
