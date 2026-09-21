import { apiErr, corsHeaders, json } from "./http.ts";
import {
  createCycle,
  deleteCycle,
  getCycle,
  listCycles,
  LiveCycleExistsError,
  startCycle,
  UnknownTabError,
  updateCycle,
} from "../_shared/tasks/sprint-cycles.ts";
import {
  addItems,
  isCheckStatus,
  ItemLockedError,
  type ItemPatch,
  listItems,
  removeItem,
  updateItem,
} from "../_shared/tasks/sprint-items.ts";
import {
  AcceptConflictError,
  acceptCycle,
} from "../_shared/tasks/sprint-accept.ts";

// Роуты /sprint-cycles — спринты (issue #267, доска инициатив #383-серия). Отдельным модулем,
// а не в index.ts: тот уже 2400+ строк при нашем пределе 800 (issue #265).
//
// ⚠️ Не путать с /sprints: там ВКЛАДКИ доски проектов, историческое имя таблицы. Вкладка —
// это «пространство» спринтов, и её id приходит сюда как `tab_id`.
//
// Доступ (решение владельца 18.09.2026): смотреть, набирать состав, создавать, стартовать и
// принимать спринт — любой участник воркспейса. Планирование командное, и упираться в админа
// на каждый старт спринта значит остановить ритуал, когда админ занят. Под админом остаётся
// только удаление спринта: оно необратимо и стирает историю периода.
//
// Возвращает null, если путь не про спринты (index.ts идёт дальше).

function badDates(body: Record<string, unknown>): string | null {
  if (!body.name || typeof body.name !== "string") return "name is required";
  if (!body.start_date || !body.end_date) {
    return "start_date и end_date обязательны";
  }
  if ((body.start_date as string) > (body.end_date as string)) {
    return "start_date не может быть позже end_date";
  }
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
  const viewer = { id: actor, isAdmin };
  const url = new URL(req.url);

  if (routePath === "/sprint-cycles") {
    if (req.method === "GET") {
      // `tab_id=none` — служебное пространство «Без вкладки»: спринты, заведённые до
      // пространств или потерявшие вкладку. Без параметра — все, как было до доски.
      const raw = url.searchParams.get("tab_id");
      const tabId = raw === null ? undefined : raw === "none" ? null : raw;
      return json(await listCycles(groupId, tabId), 200, origin);
    }
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return apiErr(400, "Invalid JSON", origin);
      const bad = badDates(body);
      if (bad) return apiErr(400, bad, origin);
      try {
        const cycle = await createCycle(
          {
            name: body.name as string,
            start_date: body.start_date as string,
            end_date: body.end_date as string,
            tab_id: typeof body.tab_id === "string" ? body.tab_id : null,
            check_date: typeof body.check_date === "string"
              ? body.check_date
              : null,
          },
          groupId,
          actor,
        );
        return json(cycle, 201, origin);
      } catch (e) {
        if (e instanceof UnknownTabError) {
          return apiErr(400, e.message, origin);
        }
        if (e instanceof LiveCycleExistsError) {
          return apiErr(409, e.message, origin);
        }
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
      // `viewer` обязателен — состав показывается глазами спрашивающего, и чужая приватная
      // задача остаётся в нём строкой без содержимого.
      return json(
        { ...cycle, items: await listItems(id, groupId, viewer) },
        200,
        origin,
      );
    }
    if (req.method === "PATCH") {
      const body = await readBody(req);
      if (!body) return apiErr(400, "Invalid JSON", origin);
      const fields: Parameters<typeof updateCycle>[1] = {};
      if (typeof body.name === "string") fields.name = body.name;
      if (typeof body.start_date === "string") {
        fields.start_date = body.start_date;
      }
      if (typeof body.end_date === "string") fields.end_date = body.end_date;
      if (typeof body.check_date === "string" || body.check_date === null) {
        fields.check_date = body.check_date as string | null;
      }
      if (typeof body.summary === "string" || body.summary === null) {
        fields.summary = body.summary as string | null;
      }
      if (
        fields.start_date && fields.end_date &&
        fields.start_date > fields.end_date
      ) {
        return apiErr(400, "start_date не может быть позже end_date", origin);
      }
      const updated = await updateCycle(id, fields, groupId);
      if (!updated) return apiErr(404, "Not found", origin);
      return json(updated, 200, origin);
    }
    if (req.method === "DELETE") {
      // Под админом с 18.09.2026. Необратимым это действие быть перестало (архивация, #427),
      // но право не расширяем без просьбы владельца — спринт общий.
      if (!isAdmin) return apiErr(403, "Forbidden", origin);
      const ok = await deleteCycle(id, groupId, telegramId);
      // Принятый спринт не удаляется — это архив периода, другой памяти о нём нет.
      if (!ok) return apiErr(404, "Not found или спринт уже принят", origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    return null;
  }

  const startMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/start$/);
  if (startMatch && req.method === "POST") {
    const started = await startCycle(startMatch[1], groupId);
    if (!started) return apiErr(404, "Not found или спринт уже начат", origin);
    return json(started, 200, origin);
  }

  const acceptMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/accept$/);
  if (acceptMatch && req.method === "POST") {
    const body = (await readBody(req)) ?? {};
    try {
      // `next_cycle_id` из старого веба игнорируется: следующий спринт теперь создаёт сама
      // приёмка, одной транзакцией с переносом хвостов.
      const result = await acceptCycle(acceptMatch[1], groupId, actor, {
        summary: typeof body.summary === "string" ? body.summary : null,
      });
      if (!result) return apiErr(404, "Not found", origin);
      return json(result, 200, origin);
    } catch (e) {
      if (e instanceof AcceptConflictError) {
        return apiErr(409, e.message, origin);
      }
      return apiErr(500, e instanceof Error ? e.message : String(e), origin);
    }
  }

  const tasksMatch = routePath.match(/^\/sprint-cycles\/([^/]+)\/tasks$/);
  if (tasksMatch && req.method === "POST") {
    const body = await readBody(req);
    if (!body) return apiErr(400, "Invalid JSON", origin);
    const taskIds = Array.isArray(body.task_ids)
      ? (body.task_ids as string[])
      : [];
    const cycle = await getCycle(tasksMatch[1], groupId);
    if (!cycle) return apiErr(404, "Not found", origin);
    if (cycle.status === "accepted") {
      return apiErr(409, "Спринт принят, состав не меняется", origin);
    }
    // Сколько реально добавилось: чужие воркспейсы, приватные и уже добавленные отсеиваются молча.
    return json(
      { added: await addItems(tasksMatch[1], taskIds, groupId, actor) },
      200,
      origin,
    );
  }

  const itemMatch = routePath.match(
    /^\/sprint-cycles\/([^/]+)\/tasks\/([^/]+)$/,
  );
  if (itemMatch) {
    const [, cycleId, taskId] = itemMatch;

    // Сверка и пометка «к переносу». Отдельным роутом от правки задачи: это отметки о ходе
    // работы в конкретном спринте, а не свойства самой задачи — в следующем спринте они свои.
    if (req.method === "PATCH") {
      const body = await readBody(req);
      if (!body) return apiErr(400, "Invalid JSON", origin);

      const patch: ItemPatch = {};
      if ("check_status" in body) {
        const v = body.check_status;
        if (v !== null && !isCheckStatus(v)) {
          return apiErr(
            400,
            "check_status: принимаются ok, risk, problem или null",
            origin,
          );
        }
        patch.check_status = v as ItemPatch["check_status"];
      }
      if ("check_note" in body) {
        patch.check_note = typeof body.check_note === "string"
          ? body.check_note
          : null;
      }
      if ("to_carry" in body) {
        if (typeof body.to_carry !== "boolean") {
          return apiErr(400, "to_carry: ожидается true или false", origin);
        }
        patch.to_carry = body.to_carry;
      }
      if ("carry_reason" in body) {
        patch.carry_reason = typeof body.carry_reason === "string"
          ? body.carry_reason
          : null;
      }
      if (Object.keys(patch).length === 0) {
        return apiErr(400, "Нечего менять", origin);
      }

      try {
        const item = await updateItem(cycleId, taskId, groupId, patch, actor);
        if (!item) return apiErr(404, "Not found", origin);
        return json(item, 200, origin);
      } catch (e) {
        if (e instanceof ItemLockedError) {
          return apiErr(409, e.message, origin);
        }
        return apiErr(500, e instanceof Error ? e.message : String(e), origin);
      }
    }

    if (req.method === "DELETE") {
      const ok = await removeItem(cycleId, taskId, groupId);
      if (!ok) return apiErr(404, "Not found или спринт уже принят", origin);
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    return null;
  }

  return null;
}
