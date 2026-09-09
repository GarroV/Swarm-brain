import { apiErr, corsHeaders, json } from "./http.ts";
import {
  acceptCycle,
  addItems,
  createCycle,
  deleteCycle,
  getCycle,
  listCycles,
  listItems,
  removeItem,
  startCycle,
  updateCycle,
} from "../_shared/tasks/sprint-cycles.ts";

// Роуты /sprint-cycles — спринты (issue #267). Отдельным модулем, а не в index.ts: тот уже
// 2400+ строк при нашем пределе 800 (issue #265), и дописывать в него — увеличивать долг.
//
// ⚠️ Не путать с /sprints: там ВКЛАДКИ доски проектов, историческое имя таблицы.
//
// Доступ: смотреть и набирать состав — любой участник воркспейса (планирование командное);
// создавать, стартовать, принимать и удалять спринт — только админ, как и вкладки доски.
// Возвращает null, если путь не про спринты (index.ts идёт дальше).

function badDates(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== "string") return "name is required";
  if (!body.start_date || !body.end_date) return "start_date и end_date обязательны";
  if ((body.start_date as string) > (body.end_date as string)) return "start_date не может быть позже end_date";
  return null;
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export async function handleSprintCycleRoutes(
  req: Request,
  routePath: string,
  telegramId: number,
  groupId: string,
  isAdmin: boolean,
  origin: string,
): Promise<Response | null> {
  const actor = String(telegramId);

  if (routePath === "/sprint-cycles") {
    if (req.method === "GET") return json(await listCycles(groupId), 200, origin);
    if (req.method === "POST") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const body = await readBody(req);
      if (!body) return apiErr(400, "Invalid JSON", origin);
      const bad = badDates(body);
      if (bad) return apiErr(400, bad, origin);
      try {
        const cycle = await createCycle({
          name: body.name as string,
          start_date: body.start_date as string,
          end_date: body.end_date as string,
        }, groupId, actor);
        return json(cycle, 201, origin);
      } catch (e) {
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }
    return null;
  }

  const cycleMatch = routePath.match(/^\/sprint-cycles\/([^/]+)$/);
  if (cycleMatch) {
    const id = cycleMatch[1];
    if (req.method === "GET") {
      const cycle = await getCycle(id, groupId);
      if (!cycle) return apiErr(404, "Not found", origin);
      // Состав отдаём вместе с циклом: экран спринта без него всё равно бесполезен,
      // а второй запрос стоил бы лишнего круга на каждом открытии.
      return json({ ...cycle, items: await listItems(id, groupId) }, 200, origin);
    }
    if (req.method === "PATCH") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const body = await readBody(req);
      if (!body) return apiErr(400, "Invalid JSON", origin);
      const fields: Parameters<typeof updateCycle>[1] = {};
      if (typeof body.name === "string") fields.name = body.name;
      if (typeof body.start_date === "string") fields.start_date = body.start_date;
      if (typeof body.end_date === "string") fields.end_date = body.end_date;
      if (typeof body.summary === "string" || body.summary === null) fields.summary = body.summary as string | null;
      if (fields.start_date && fields.end_date && fields.start_date > fields.end_date) {
        return apiErr(400, "start_date не может быть позже end_date", origin);
      }
      const updated = await updateCycle(id, fields, groupId);
      if (!updated) return apiErr(404, "Not found", origin);
      return json(updated, 200, origin);
    }
    if (req.method === "DELETE") {
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const ok = await deleteCycle(id, groupId);
      // Принятый спринт не удаляется — это архив периода, другой памяти о нём нет.
      if (!ok) return apiErr(404, "Not found или спринт уже принят", origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    return null;
  }

  const startMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/start$/);
  if (startMatch && req.method === "POST") {
    if (!isAdmin) return apiErr(403, "Forbidden", origin);
    const started = await startCycle(startMatch[1], groupId);
    if (!started) return apiErr(404, "Not found или спринт уже начат", origin);
    return json(started, 200, origin);
  }

  const acceptMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/accept$/);
  if (acceptMatch && req.method === "POST") {
    if (!isAdmin) return apiErr(403, "Forbidden", origin);
    const body = (await readBody(req)) ?? {};
    const result = await acceptCycle(acceptMatch[1], groupId, actor, {
      summary: typeof body.summary === "string" ? body.summary : null,
      nextCycleId: typeof body.next_cycle_id === "string" ? body.next_cycle_id : null,
    });
    if (!result) return apiErr(404, "Not found или спринт уже принят", origin);
    return json(result, 200, origin);
  }

  const tasksMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/tasks$/);
  if (tasksMatch && req.method === "POST") {
    const body = await readBody(req);
    if (!body) return apiErr(400, "Invalid JSON", origin);
    const taskIds = Array.isArray(body.task_ids) ? (body.task_ids as string[]) : [];
    const cycle = await getCycle(tasksMatch[1], groupId);
    if (!cycle) return apiErr(404, "Not found", origin);
    if (cycle.status === "accepted") return apiErr(409, "Спринт принят, состав не меняется", origin);
    // Сколько реально добавилось: чужие воркспейсы, приватные и уже добавленные отсеиваются молча.
    return json({ added: await addItems(tasksMatch[1], taskIds, groupId, actor) }, 200, origin);
  }

  const itemMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/tasks\/([^/]+)$/);
  if (itemMatch && req.method === "DELETE") {
    const ok = await removeItem(itemMatch[1], itemMatch[2], groupId);
    if (!ok) return apiErr(404, "Not found или спринт уже принят", origin);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  return null;
}
