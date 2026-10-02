// Строка события журнала пространства на языке интерфейса (issue #459): демо-витрина обязана
// быть английской, а сервер раньше отдавал только собранный русский текст. Сервер теперь шлёт
// части события в `params`; нет их (старый сервер) или событие не из спринта — берём `text`.
import type { JournalEvent } from "@/types";

type Dt = (ru: string, en: string) => string;

function checkLabel(status: string | undefined, dt: Dt): string {
  if (status === "ok") return dt("по плану", "on track");
  if (status === "risk") return dt("риск", "at risk");
  if (status === "problem") return dt("проблема", "problem");
  return status ?? "";
}

export function journalText(e: JournalEvent, dt: Dt): string {
  const p = e.params;
  if (!p) return e.text;
  const cycle = p.cycle ?? dt("спринт", "the sprint");
  switch (e.kind) {
    case "cycle_started":
      return dt(`Спринт начат: ${cycle}`, `Sprint started: ${cycle}`);
    case "cycle_accepted":
      return p.percent === undefined
        ? dt(`Спринт принят: ${cycle}`, `Sprint accepted: ${cycle}`)
        : dt(`Спринт принят: ${cycle} — выполнено ${p.percent}%`, `Sprint accepted: ${cycle} — ${p.percent}% done`);
    case "item_added":
      return dt(`Взята в ${cycle}`, `Added to ${cycle}`);
    case "check":
      return dt(`Сверка: ${checkLabel(p.status, dt)}`, `Check-in: ${checkLabel(p.status, dt)}`);
    case "carry":
      return p.reason ? dt(`К переносу: ${p.reason}`, `To carry over: ${p.reason}`) : dt("К переносу", "To carry over");
    case "removed":
      return dt(`Задача удалена, в ${cycle} осталась упоминанием`, `Task deleted; ${cycle} keeps a mention`);
    default:
      return e.text;
  }
}
