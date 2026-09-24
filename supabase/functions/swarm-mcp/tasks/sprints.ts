// MCP-инструменты спринтов (issue #480, владелец 24.09.2026: «важно чтобы мсп умел рулить всем
// функционалом спринтов»). Всё, что человек делает в разделе «Спринты» веба, делается и отсюда.
//
// Логика — та же, что у веба (`_shared/tasks/sprint-*.ts`), права — те же, что в
// `swarm-api/sprint-cycles.ts` и роутах `/sprints` (решение владельца 18.09.2026): смотреть,
// набирать состав, создавать, стартовать и принимать спринт — любой участник воркспейса; удалить
// спринт, переименовать и убрать в архив пространство — только админ.
//
// ⚠️ Пространство спринтов и вкладка доски «Проекты» — РАЗНЫЕ сущности в одной таблице `sprints`
// (поле `kind`, issue #423). Этот модуль работает только с `kind = 'space'`: вкладки проектов он не
// перечисляет, не переименовывает и не архивирует. Проверка стоит в каждом инструменте, который
// принимает пространство, — через `loadSpace`, а не доверием к переданному id.

// Линт просит короткое имя из карты импортов; см. пояснение в _shared/tasks/sprint-items.ts.
// deno-lint-ignore-file no-import-prefix
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  createSprint,
  deleteSprint,
  listSprints,
  updateSprint,
} from "../../_shared/tasks/sprints.ts";
import {
  createCycle,
  deleteCycle,
  getCycle,
  listCycles,
  LiveCycleExistsError,
  type SprintCycle,
  startCycle,
  UnknownTabError,
  updateCycle,
} from "../../_shared/tasks/sprint-cycles.ts";
import {
  addItems,
  isCheckStatus,
  ItemLockedError,
  type ItemPatch,
  listItems,
  removeItem,
  updateItem,
} from "../../_shared/tasks/sprint-items.ts";
import {
  AcceptConflictError,
  acceptCycle,
} from "../../_shared/tasks/sprint-accept.ts";
import { computeSprintStats } from "../../_shared/tasks/sprint-stats.ts";
import type { Sprint } from "../../_shared/tasks/types.ts";
import { ADMIN_USER_ID } from "./tools.ts";
import {
  formatCycles,
  formatSpaces,
  formatSprint,
  isIsoDate,
  pickSpace,
} from "./sprints-format.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** Больше задач за один вызов не набираем: состав спринта — десятки, а не сотни. */
const MAX_TASKS_PER_CALL = 200;

interface Member {
  userId: number;
  groupId: string;
  isAdmin: boolean;
}

type Args = Record<string, unknown> & { requesting_user_id?: number };

/** Кто спрашивает: воркспейс и админство — тем же правилом, что в swarm-api. */
async function member(args: Args): Promise<Member | string> {
  const userId = Number(args.requesting_user_id);
  if (!Number.isFinite(userId) || userId <= 0) {
    return "Нужен requesting_user_id (или токен коннектора).";
  }
  const { data } = await supabase.from("allowed_users")
    .select("group_id, is_admin").eq("telegram_id", userId).maybeSingle();
  const row = data as
    | { group_id: string | null; is_admin: boolean | null }
    | null;
  if (!row?.group_id) return "Нет доступа: пользователь не в воркспейсе.";
  return {
    userId,
    groupId: row.group_id,
    isAdmin: userId === ADMIN_USER_ID || row.is_admin === true,
  };
}

async function spaces(groupId: string): Promise<Sprint[]> {
  return await listSprints(groupId, "space");
}

/** Пространство по имени или id — только среди пространств, не вкладок проектов. */
async function loadSpace(
  groupId: string,
  query: unknown,
): Promise<Sprint | string> {
  const picked = pickSpace(
    await spaces(groupId),
    typeof query === "string" ? query : "",
  );
  return picked.ok ? picked.value : picked.error;
}

async function loadCycle(
  groupId: string,
  id: unknown,
): Promise<SprintCycle | string> {
  if (typeof id !== "string" || !id.trim()) {
    return "Нужен sprint_id (из get_sprints).";
  }
  return (await getCycle(id.trim(), groupId)) ??
    `Спринт ${id} не найден в твоём воркспейсе.`;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function withMember(
  args: Args,
  fn: (m: Member) => Promise<string>,
): Promise<string> {
  const m = await member(args);
  return typeof m === "string" ? m : await fn(m);
}

// ── Пространства ──────────────────────────────────────────────────────────────

export function toolGetSprintSpaces(args: Args): Promise<string> {
  return withMember(
    args,
    async (m) =>
      formatSpaces(await spaces(m.groupId), await listCycles(m.groupId)),
  );
}

export function toolCreateSprintSpace(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const name = str(args.name);
    if (!name) return "Нужно name — имя пространства.";
    // Пространство — именованный фильтр, даты ему не нужны, но схема их требует (как в вебе).
    const today = new Date().toISOString().slice(0, 10);
    const s = await createSprint({
      name,
      start_date: today,
      end_date: today,
      kind: "space",
    }, m.groupId);
    return `✅ Пространство «${s.name}» создано (id: ${s.id}). Спринт в нём: create_sprint.`;
  });
}

export function toolRenameSprintSpace(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    if (!m.isAdmin) {
      return "Переименовать пространство может только админ (как в вебе).";
    }
    const name = str(args.name);
    if (!name) return "Нужно name — новое имя.";
    const space = await loadSpace(m.groupId, args.space);
    if (typeof space === "string") return space;
    const updated = await updateSprint(space.id, { name }, m.groupId);
    return updated
      ? `✅ «${space.name}» → «${updated.name}».`
      : "Пространство не найдено.";
  });
}

export function toolArchiveSprintSpace(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    if (!m.isAdmin) {
      return "Убрать пространство в архив может только админ (как в вебе).";
    }
    const space = await loadSpace(m.groupId, args.space);
    if (typeof space === "string") return space;
    const ok = await deleteSprint(space.id, m.groupId, m.userId);
    // Архив, не удаление (#427): спринты и их состав остаются, пространство возвращается UPDATE-ом.
    return ok
      ? `✅ Пространство «${space.name}» убрано в архив. Спринты и их состав сохранены.`
      : "Пространство не найдено.";
  });
}

// ── Спринты ───────────────────────────────────────────────────────────────────

export function toolGetSprints(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const all = await spaces(m.groupId);
    const nameById = new Map(all.map((s) => [s.id, s.name]));
    let cycles: SprintCycle[];
    if (str(args.space)) {
      const space = await loadSpace(m.groupId, args.space);
      if (typeof space === "string") return space;
      cycles = await listCycles(m.groupId, space.id);
    } else {
      // Только спринты пространств: спринт на вкладке проектов — смешение сущностей (#483),
      // в разделе «Спринты» его не видно, значит, и здесь не показываем.
      cycles = (await listCycles(m.groupId)).filter((c) =>
        c.tab_id !== null && nameById.has(c.tab_id)
      );
    }
    if (args.include_accepted !== true) {
      cycles = cycles.filter((c) => c.status !== "accepted");
    }
    return formatCycles(cycles, nameById);
  });
}

export function toolGetSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    // Состав — глазами спрашивающего: чужая приватная задача остаётся строкой без содержимого.
    const items = await listItems(cycle.id, m.groupId, {
      id: String(m.userId),
      isAdmin: m.isAdmin,
    });
    const space = (await spaces(m.groupId)).find((s) => s.id === cycle.tab_id);
    return formatSprint(
      cycle,
      space?.name ?? null,
      items,
      computeSprintStats(items),
    );
  });
}

export function toolCreateSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const name = str(args.name);
    if (!name) return "Нужно name — имя спринта.";
    if (!isIsoDate(args.start_date) || !isIsoDate(args.end_date)) {
      return "start_date и end_date обязательны, формат YYYY-MM-DD.";
    }
    if (args.start_date > args.end_date) {
      return "start_date не может быть позже end_date.";
    }
    if (args.check_date !== undefined && !isIsoDate(args.check_date)) {
      return "check_date — формат YYYY-MM-DD.";
    }
    const space = await loadSpace(m.groupId, args.space);
    if (typeof space === "string") return space;
    try {
      const c = await createCycle(
        {
          name,
          start_date: args.start_date,
          end_date: args.end_date,
          tab_id: space.id,
          check_date: isIsoDate(args.check_date) ? args.check_date : null,
        },
        m.groupId,
        String(m.userId),
      );
      return `✅ Спринт «${c.name}» создан в «${space.name}» — планирование, сверка ${c.check_date} (id: ${c.id}). Состав: add_sprint_tasks, старт: start_sprint.`;
    } catch (e) {
      if (e instanceof LiveCycleExistsError || e instanceof UnknownTabError) {
        return `Не создан: ${e.message}`;
      }
      throw e;
    }
  });
}

export function toolUpdateSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    const fields: Parameters<typeof updateCycle>[1] = {};
    if (str(args.name)) fields.name = str(args.name);
    for (const key of ["start_date", "end_date"] as const) {
      if (args[key] === undefined) continue;
      if (!isIsoDate(args[key])) return `${key} — формат YYYY-MM-DD.`;
      fields[key] = args[key];
    }
    if (args.check_date !== undefined) {
      if (args.check_date !== null && !isIsoDate(args.check_date)) {
        return "check_date — YYYY-MM-DD или null.";
      }
      fields.check_date = args.check_date;
    }
    if (args.summary !== undefined) {
      fields.summary = typeof args.summary === "string" ? args.summary : null;
    }
    if (str(args.space)) {
      const space = await loadSpace(m.groupId, args.space);
      if (typeof space === "string") return space;
      fields.tab_id = space.id;
    }
    if (Object.keys(fields).length === 0) return "Нечего менять.";
    const start = fields.start_date ?? cycle.start_date;
    const end = fields.end_date ?? cycle.end_date;
    if (start > end) return "start_date не может быть позже end_date.";
    const updated = await updateCycle(cycle.id, fields, m.groupId);
    if (updated === "tab_busy") {
      return "В этом пространстве уже есть незакрытый спринт — перенос не сделан.";
    }
    if (updated === "tab_missing") return "Пространство не найдено.";
    if (!updated) return "Спринт не найден.";
    return `✅ Спринт обновлён.\n${
      formatCycles(
        [updated],
        new Map((await spaces(m.groupId)).map((s) => [s.id, s.name])),
      )
    }`;
  });
}

export function toolStartSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    const started = await startCycle(cycle.id, m.groupId);
    if (!started) {
      return `Спринт «${cycle.name}» не в планировании — стартовать нечего.`;
    }
    return `✅ Спринт «${started.name}» начат. Всё, что в составе сейчас, — план; добавленное дальше пойдёт «сверх плана».`;
  });
}

export function toolAcceptSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    try {
      const r = await acceptCycle(cycle.id, m.groupId, String(m.userId), {
        summary: typeof args.summary === "string" ? args.summary : null,
      });
      if (!r) return "Спринт не найден.";
      const next = r.next
        ? `\nСледующий спринт: «${r.next.name}» (id: ${r.next.id}).`
        : "";
      return `✅ Спринт «${r.cycle.name}» принят. Зафиксировано строк: ${r.frozen}; перенесено: ${r.carried} (вручную ${r.carried_manual}, само ${r.carried_auto}).${next}`;
    } catch (e) {
      if (e instanceof AcceptConflictError) return `Не принят: ${e.message}`;
      throw e;
    }
  });
}

export function toolDeleteSprint(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    if (!m.isAdmin) return "Удалить спринт может только админ (как в вебе).";
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    const ok = await deleteCycle(cycle.id, m.groupId, m.userId);
    return ok
      ? `✅ Спринт «${cycle.name}» убран в архив.`
      : "Принятый спринт не удаляется — это архив периода.";
  });
}

// ── Состав ────────────────────────────────────────────────────────────────────

export function toolAddSprintTasks(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    if (cycle.status === "accepted") {
      return "Спринт принят, состав не меняется.";
    }
    const ids = Array.isArray(args.task_ids)
      ? args.task_ids.filter((x): x is string => typeof x === "string")
      : [];
    if (ids.length === 0) {
      return "Нужен task_ids — массив id задач (из get_tasks).";
    }
    if (ids.length > MAX_TASKS_PER_CALL) {
      return `Не больше ${MAX_TASKS_PER_CALL} задач за вызов.`;
    }
    const added = await addItems(cycle.id, ids, m.groupId, String(m.userId));
    const skipped = ids.length - added;
    const kind = cycle.status === "draft"
      ? "в план"
      : "сверх плана (спринт уже идёт)";
    const why = skipped
      ? ` Пропущено ${skipped}: уже в составе, личные или не из твоего воркспейса.`
      : "";
    return `✅ Добавлено ${added} ${kind}.${why}`;
  });
}

export function toolRemoveSprintTask(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    const taskId = str(args.task_id);
    if (!taskId) return "Нужен task_id.";
    const ok = await removeItem(cycle.id, taskId, m.groupId);
    return ok
      ? "✅ Задача убрана из состава."
      : "Задачи нет в составе, или спринт уже принят.";
  });
}

export function toolMarkSprintTask(args: Args): Promise<string> {
  return withMember(args, async (m) => {
    const cycle = await loadCycle(m.groupId, args.sprint_id);
    if (typeof cycle === "string") return cycle;
    const taskId = str(args.task_id);
    if (!taskId) return "Нужен task_id.";
    const patch: ItemPatch = {};
    if ("check_status" in args) {
      if (args.check_status !== null && !isCheckStatus(args.check_status)) {
        return "check_status: ok, risk, problem или null.";
      }
      patch.check_status = args.check_status as ItemPatch["check_status"];
    }
    if ("check_note" in args) {
      patch.check_note = typeof args.check_note === "string"
        ? args.check_note
        : null;
    }
    if ("to_carry" in args) {
      if (typeof args.to_carry !== "boolean") {
        return "to_carry: true или false.";
      }
      patch.to_carry = args.to_carry;
    }
    if ("carry_reason" in args) {
      patch.carry_reason = typeof args.carry_reason === "string"
        ? args.carry_reason
        : null;
    }
    if (Object.keys(patch).length === 0) {
      return "Нечего менять: check_status, check_note, to_carry, carry_reason.";
    }
    try {
      const item = await updateItem(
        cycle.id,
        taskId,
        m.groupId,
        patch,
        String(m.userId),
      );
      // Название не печатаем: updateItem отдаёт строку не глазами спрашивающего, и у чужой
      // личной задачи ответ раскрыл бы её заголовок.
      return item ? "✅ Отметка сохранена." : "Задачи нет в составе.";
    } catch (e) {
      if (e instanceof ItemLockedError) return `Не сохранено: ${e.message}`;
      throw e;
    }
  });
}

// ── Определения ───────────────────────────────────────────────────────────────

const ME = {
  type: "number",
  description: "Твой Telegram user ID — обязателен для проверки доступа",
};
const SPRINT_ID = {
  type: "string",
  description: "id спринта из get_sprints / get_sprint_spaces",
};
const SPACE = {
  type: "string",
  description:
    "Пространство спринтов: имя или id из get_sprint_spaces. Вкладки доски «Проекты» сюда не подходят — это другая сущность.",
};
const DATE = (what: string) => ({
  type: "string",
  description: `${what}, YYYY-MM-DD. Год — от текущей даты, не из головы`,
});

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    name,
    description,
    inputSchema: {
      type: "object",
      properties: { ...properties, requesting_user_id: ME },
      required: [...required, "requesting_user_id"],
    },
  };
}

export const SPRINT_TOOL_DEFINITIONS = [
  tool(
    "get_sprint_spaces",
    "Пространства раздела «Спринты» (НЕ вкладки доски «Проекты»): id, живой спринт, сколько принято. Вызывай первым — имена пространств угадать нельзя.",
    {},
  ),
  tool(
    "create_sprint_space",
    "Создать пространство спринтов. Может любой участник.",
    {
      name: { type: "string", description: "Имя пространства" },
    },
    ["name"],
  ),
  tool(
    "rename_sprint_space",
    "Переименовать пространство спринтов. Только админ.",
    {
      space: SPACE,
      name: { type: "string", description: "Новое имя" },
    },
    ["space", "name"],
  ),
  tool(
    "archive_sprint_space",
    "Убрать пространство спринтов в архив (не удаление: спринты и состав сохраняются). Только админ.",
    { space: SPACE },
    ["space"],
  ),
  tool(
    "get_sprints",
    "Спринты: по пространству или все. По умолчанию без принятых.",
    {
      space: SPACE,
      include_accepted: {
        type: "boolean",
        description: "true — показать и принятые (архив периодов)",
      },
    },
  ),
  tool(
    "get_sprint",
    "Спринт целиком: этап, даты, план/факт, сверка и состав по проектам с task_id. Чужие личные задачи — строкой без содержимого.",
    { sprint_id: SPRINT_ID },
    ["sprint_id"],
  ),
  tool(
    "create_sprint",
    "Создать спринт в пространстве (этап «планирование»). В пространстве может быть только один незакрытый спринт.",
    {
      space: SPACE,
      name: {
        type: "string",
        description: "Имя спринта, например «Спринт 24.09 — 07.10»",
      },
      start_date: DATE("Старт"),
      end_date: DATE("Финал (приёмка)"),
      check_date: DATE("Чекпоинт-сверка; по умолчанию шестой день от старта"),
    },
    ["space", "name", "start_date", "end_date"],
  ),
  tool(
    "update_sprint",
    "Изменить спринт: имя, даты, чекпоинт, итог, перенос в другое пространство.",
    {
      sprint_id: SPRINT_ID,
      name: { type: "string" },
      start_date: DATE("Старт"),
      end_date: DATE("Финал"),
      check_date: {
        type: ["string", "null"],
        description: "Чекпоинт YYYY-MM-DD или null — снять",
      },
      summary: {
        type: ["string", "null"],
        description: "Итог спринта текстом",
      },
      space: SPACE,
    },
    ["sprint_id"],
  ),
  tool(
    "start_sprint",
    "Начать спринт: планирование → идёт. Текущий состав становится планом, всё добавленное позже — «сверх плана».",
    { sprint_id: SPRINT_ID },
    ["sprint_id"],
  ),
  tool(
    "accept_sprint",
    "Финал — приёмка: фиксирует итоги, создаёт следующий спринт и переносит в него незакрытое.",
    {
      sprint_id: SPRINT_ID,
      summary: {
        type: "string",
        description: "Итог спринта текстом (опционально)",
      },
    },
    ["sprint_id"],
  ),
  tool("delete_sprint", "Убрать непринятый спринт в архив. Только админ.", {
    sprint_id: SPRINT_ID,
  }, ["sprint_id"]),
  tool(
    "add_sprint_tasks",
    "Добавить задачи в состав спринта. До старта — в план, после — «сверх плана». Личные задачи в спринт не попадают.",
    {
      sprint_id: SPRINT_ID,
      task_ids: {
        type: "array",
        items: { type: "string" },
        description: "id задач из get_tasks (полные uuid)",
      },
    },
    ["sprint_id", "task_ids"],
  ),
  tool(
    "remove_sprint_task",
    "Убрать задачу из состава спринта (сама задача остаётся).",
    {
      sprint_id: SPRINT_ID,
      task_id: { type: "string", description: "task_id из get_sprint" },
    },
    ["sprint_id", "task_id"],
  ),
  tool(
    "mark_sprint_task",
    "Отметка по задаче в спринте: сверка на чекпоинте (идёт/риск/проблема + комментарий) и пометка «к переносу» с причиной.",
    {
      sprint_id: SPRINT_ID,
      task_id: { type: "string", description: "task_id из get_sprint" },
      check_status: {
        type: ["string", "null"],
        enum: ["ok", "risk", "problem", null],
        description: "ok — идёт, risk — риск, problem — проблема, null — снять",
      },
      check_note: {
        type: ["string", "null"],
        description: "Комментарий к сверке",
      },
      to_carry: {
        type: "boolean",
        description: "true — пометить к переносу в следующий спринт",
      },
      carry_reason: {
        type: ["string", "null"],
        description: "Почему переносится",
      },
    },
    ["sprint_id", "task_id"],
  ),
];

type ToolFn = (args: Args) => Promise<string>;

export const SPRINT_TOOLS: Record<string, ToolFn> = {
  get_sprint_spaces: toolGetSprintSpaces,
  create_sprint_space: toolCreateSprintSpace,
  rename_sprint_space: toolRenameSprintSpace,
  archive_sprint_space: toolArchiveSprintSpace,
  get_sprints: toolGetSprints,
  get_sprint: toolGetSprint,
  create_sprint: toolCreateSprint,
  update_sprint: toolUpdateSprint,
  start_sprint: toolStartSprint,
  accept_sprint: toolAcceptSprint,
  delete_sprint: toolDeleteSprint,
  add_sprint_tasks: toolAddSprintTasks,
  remove_sprint_task: toolRemoveSprintTask,
  mark_sprint_task: toolMarkSprintTask,
};
