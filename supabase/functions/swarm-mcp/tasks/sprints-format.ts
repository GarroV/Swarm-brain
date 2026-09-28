// Тексты ответов MCP-инструментов спринтов (issue #480). Чистые функции — без базы, под тестами.
//
// ⚠️ Пространство спринтов и вкладка доски «Проекты» — РАЗНЫЕ сущности, хоть и живут в одной
// таблице `sprints` (поле `kind`, issue #423). Здесь есть только пространства: выбор по имени
// идёт из списка `kind = 'space'`, вкладок проектов этот модуль не видит и не трогает.

import type { Sprint } from "../../_shared/tasks/types.ts";
import type { SprintCycle } from "../../_shared/tasks/sprint-cycles.ts";
import type { SprintItem } from "../../_shared/tasks/sprint-items.ts";
import type { SprintStats } from "../../_shared/tasks/sprint-stats.ts";
import { isClosedStatus } from "../../_shared/tasks/statuses.ts";

const STAGE: Record<string, string> = {
  draft: "планирование",
  active: "идёт",
  accepted: "принят",
};

const CHECK: Record<string, string> = {
  ok: "✅ идёт",
  risk: "⚠️ риск",
  problem: "🛑 проблема",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Дата YYYY-MM-DD, которая действительно существует (не 2026-02-31). */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== "string" || !ISO_DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

export type Picked<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Пространство по id или имени — только среди пространств (`kind = 'space'`). Имя сверяется
 * без регистра; частичное совпадение берётся, лишь если оно одно: угадывать между двумя
 * пространствами значит однажды набрать состав не туда.
 */
export function pickSpace(
  spaces: readonly Sprint[],
  query: string,
): Picked<Sprint> {
  const q = query.trim().toLowerCase();
  const pool = spaces.filter((s) => s.kind === "space");
  const names = pool.map((s) => `«${s.name}»`).join(", ") || "пространств нет";
  if (!q) {
    return { ok: false, error: `Не указано пространство. Есть: ${names}` };
  }
  const byId = pool.find((s) => s.id === query.trim());
  if (byId) return { ok: true, value: byId };
  const exact = pool.filter((s) => s.name.trim().toLowerCase() === q);
  if (exact.length === 1) return { ok: true, value: exact[0] };
  const partial = pool.filter((s) => s.name.toLowerCase().includes(q));
  if (exact.length === 0 && partial.length === 1) {
    return { ok: true, value: partial[0] };
  }
  if (exact.length > 1 || partial.length > 1) {
    const many = (exact.length > 1 ? exact : partial).map((s) =>
      `«${s.name}» (id: ${s.id})`
    );
    return {
      ok: false,
      error: `Под «${query}» подходит несколько пространств: ${
        many.join(", ")
      }. Укажи id.`,
    };
  }
  return {
    ok: false,
    error: `Пространство «${query}» не найдено. Есть: ${names}`,
  };
}

function cycleLine(c: SprintCycle, spaceName: string | null): string {
  const where = spaceName ? ` · ${spaceName}` : "";
  const check = c.check_date ? `, сверка ${c.check_date}` : "";
  return `• ${c.name} — ${
    STAGE[c.status] ?? c.status
  }, ${c.start_date} → ${c.end_date}${check}${where} (id: ${c.id})`;
}

export function formatSpaces(
  spaces: readonly Sprint[],
  cycles: readonly SprintCycle[],
): string {
  const pool = spaces.filter((s) => s.kind === "space");
  if (pool.length === 0) {
    return "Пространств спринтов пока нет. Создай: create_sprint_space.";
  }
  const lines = pool.map((s) => {
    const own = cycles.filter((c) => c.tab_id === s.id);
    const live = own.find((c) => c.status !== "accepted");
    const accepted = own.filter((c) => c.status === "accepted").length;
    const now = live
      ? `сейчас: ${live.name} (${STAGE[live.status]}, id: ${live.id})`
      : "живого спринта нет";
    return `• ${s.name} (id: ${s.id}) — ${now}; принятых: ${accepted}`;
  });
  return `Пространства спринтов:\n${lines.join("\n")}`;
}

export function formatCycles(
  cycles: readonly SprintCycle[],
  spaceNameById: ReadonlyMap<string, string>,
): string {
  if (cycles.length === 0) return "Спринтов нет.";
  return cycles.map((c) =>
    cycleLine(c, c.tab_id ? spaceNameById.get(c.tab_id) ?? null : null)
  ).join("\n");
}

function itemLine(i: SprintItem): string {
  if (i.hidden) return `  • 🔒 личная задача (скрыта)`;
  const mark = isClosedStatus(i.status) ? "[x]" : "[ ]";
  const who = i.assignees.length ? ` — ${i.assignees.join(", ")}` : "";
  const due = i.due_date ? `, срок ${i.due_date}` : "";
  const plan = i.in_plan ? "" : " · сверх плана";
  const check = i.check_status
    ? ` · ${CHECK[i.check_status]}${i.check_note ? `: ${i.check_note}` : ""}`
    : "";
  const carry = i.to_carry
    ? ` · к переносу${i.carry_reason ? `: ${i.carry_reason}` : ""}`
    : "";
  const removed = i.removed ? " · задача удалена, осталась упоминанием" : "";
  return `  • ${mark} ${i.title}${who}${due}${plan}${check}${carry}${removed} (task_id: ${
    i.task_id ?? "—"
  })`;
}

export function formatSprint(
  cycle: SprintCycle,
  spaceName: string | null,
  items: readonly SprintItem[],
  stats: SprintStats,
): string {
  const head = [
    `Спринт «${cycle.name}» — ${
      STAGE[cycle.status] ?? cycle.status
    } (id: ${cycle.id})`,
    `Пространство: ${
      spaceName ?? "без пространства"
    } · ${cycle.start_date} → ${cycle.end_date}` +
    (cycle.check_date ? ` · сверка ${cycle.check_date}` : ""),
    `План: ${stats.planDone} из ${stats.plan} (${stats.planPercent}%) · сверх плана: ${stats.extraDone} из ${stats.extra}` +
    (stats.cancelled ? ` · отменено: ${stats.cancelled}` : ""),
    `Сверка: идёт ${stats.check_ok}, риск ${stats.check_risk}, проблема ${stats.check_problem}`,
  ];
  if (cycle.summary) head.push(`Итог: ${cycle.summary}`);
  if (items.length === 0) {
    return `${head.join("\n")}\n\nСостав пуст. Добавить: add_sprint_tasks.`;
  }

  const byProject = new Map<string, SprintItem[]>();
  for (const i of items) {
    const key = i.hidden ? "—" : i.project ?? "Без проекта";
    byProject.set(key, [...(byProject.get(key) ?? []), i]);
  }
  const body = [...byProject.entries()].map(([p, list]) =>
    `${p}:\n${list.map(itemLine).join("\n")}`
  );
  return `${head.join("\n")}\n\nСостав (${items.length}):\n${body.join("\n")}`;
}
