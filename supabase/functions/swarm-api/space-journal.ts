// Маршрут журнала пространства. Сборка ленты и правило видимости — в _shared/space-journal.ts
// (общие с swarm-mcp, #485); здесь только HTTP.
import { apiErr, json } from "./http.ts";
import { loadSpaceJournal } from "../_shared/space-journal.ts";

export type { JournalEvent, JournalKind, JournalParams } from "../_shared/space-journal.ts";

/** `GET /spaces/:tabId/journal?days=1|3|7|all` — лента пространства, новые сверху. */
export async function handleSpaceJournalRoutes(
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  origin: string,
  resolveNames: (ids: number[]) => Promise<Map<number, string>>,
): Promise<Response | null> {
  const match = routePath.match(/^\/spaces\/([^/]+)\/journal$/);
  if (!match) return null;
  if (req.method !== "GET") return null;
  const days = new URL(req.url).searchParams.get("days") ?? "7";
  const result = await loadSpaceJournal(match[1], groupId, telegramId, days, resolveNames);
  return result.ok ? json({ events: result.events }, 200, origin) : apiErr(result.status, result.error, origin);
}
