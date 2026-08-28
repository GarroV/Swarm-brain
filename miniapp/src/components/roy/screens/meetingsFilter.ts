// Фильтрация списка «Все встречи» (доска встреч). Чистая логика — отдельно от рендера, чтобы
// её можно было читать и проверять без экрана (владелец 2026-08-21: правый блок статистики
// заменён на фильтры, сама статистика съехала под них).
import type { Entry } from "@/types";
import { countryCode } from "@/lib/countries";
import { entryImporterName } from "../entry";
import { sourceLabel } from "./RoyMeetingsScreen";

// Форма фильтра, дефолты и его сохранение живут в src/lib/meetingsFilters.ts — там нет
// импортов экрана, поэтому их берёт `deno test src/lib/`. Здесь реэкспорт, чтобы
// потребители (панель фильтров, экран встреч) импортировали всё из одного места.
export type { PeriodId, StorageFilter, StatusFilter, MeetingsFilterState } from "@/lib/meetingsFilters";
export { EMPTY_FILTERS, isFilterActive, loadSavedFilters, saveFilters } from "@/lib/meetingsFilters";
import type { MeetingsFilterState, PeriodId } from "@/lib/meetingsFilters";


// Дата встречи для фильтра по периоду: entry_date (день встречи), иначе created_at.
export function meetingDay(e: Entry): string | null {
  const raw = e.entry_date ?? e.created_at;
  if (!raw) return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

// Границы периода в виде YYYY-MM-DD. `now` параметром — чтобы поведение не зависело от часов
// машины при проверке и не приходилось мокать глобальный Date.
export function periodBounds(period: PeriodId, now: Date = new Date()): { from: string; to: string } | null {
  if (period === "all" || period === "custom") return null;
  const days = period === "week" ? 7 : period === "month" ? 30 : 90;
  const from = new Date(now);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

export function isConfirmed(e: Entry): boolean {
  return (e.metadata as Record<string, unknown> | undefined)?.confirmed === true;
}

export function personOf(e: Entry): string {
  return entryImporterName(e) || "";
}

export function applyMeetingsFilter(
  meetings: Entry[],
  f: MeetingsFilterState,
  now: Date = new Date(),
): Entry[] {
  const q = f.query.trim().toLowerCase();
  const bounds = f.period === "custom"
    ? (f.from || f.to ? { from: f.from || "0000-01-01", to: f.to || "9999-12-31" } : null)
    : periodBounds(f.period, now);
  const wantCountries = new Set(f.countries.map(countryCode));

  return meetings.filter((e) => {
    if (q) {
      const title = ((e.metadata as Record<string, unknown> | undefined)?.title as string) || e.summary || e.content || "";
      if (!title.toLowerCase().includes(q)) return false;
    }
    if (bounds) {
      const day = meetingDay(e);
      if (!day || day < bounds.from || day > bounds.to) return false;
    }
    if (wantCountries.size > 0) {
      const own = (e.countries ?? []).map(countryCode);
      if (!own.some((c) => wantCountries.has(c))) return false;
    }
    if (f.sources.length > 0 && !f.sources.includes(sourceLabel(e.source))) return false;
    if (f.people.length > 0 && !f.people.includes(personOf(e))) return false;
    if (f.storage !== "any" && (f.storage === "personal") !== Boolean(e.is_private)) return false;
    if (f.status !== "any" && (f.status === "confirmed") !== isConfirmed(e)) return false;
    return true;
  });
}

