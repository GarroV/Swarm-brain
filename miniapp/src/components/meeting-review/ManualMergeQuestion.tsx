"use client";
import { useDt } from "@/components/roy/nav";
import type { ManualMergeCandidate } from "@/lib/manualMeetingMergeRequest";

export const MANUAL_MERGE_COPY = {
  question: {
    ru: "Это встреча «{title}»?",
    en: "Is this the meeting “{title}”?",
  },
  description: {
    ru: "Можно объединить записи. Исходные версии и пометки сохранятся.",
    en:
      "You can combine the recordings. Original versions and notes are preserved.",
  },
  replace: {
    ru: "Будет использована более полная расшифровка.",
    en: "The more complete transcript will be used.",
  },
  retain: {
    ru: "Текущие тезисы этой встречи сохранятся.",
    en: "The current summary of this meeting will be kept.",
  },
  yes: { ru: "Да, объединить", en: "Yes, combine" },
  no: { ru: "Нет, другая встреча", en: "No, a different meeting" },
  saving: { ru: "Сохраняю решение…", en: "Saving your decision…" },
  loading: {
    ru: "Проверяем похожие встречи…",
    en: "Checking for matching meetings…",
  },
  changed: {
    ru: "Данные встречи изменились. Проверьте предложение ещё раз.",
    en: "The meeting has changed. Check the suggestion again.",
  },
  busy: {
    ru: "Встреча ещё записывается или обрабатывается. Проверьте позже.",
    en: "The meeting is still recording or processing. Check again later.",
  },
  missing: {
    ru: "Предложенная встреча больше недоступна.",
    en: "The suggested meeting is no longer available.",
  },
  failed: {
    ru: "Не удалось проверить или сохранить решение.",
    en: "Could not check or save your decision.",
  },
  retry: { ru: "Проверить ещё раз", en: "Check again" },
  untitled: { ru: "Встреча", en: "Meeting" },
  merged: { ru: "Записи объединены", en: "Recordings combined" },
  publishedShared: {
    ru: "Встреча уже в базе команды.",
    en: "This meeting is already in the team base.",
  },
  publishedPersonal: {
    ru: "Встреча уже в личной базе.",
    en: "This meeting is already in the personal base.",
  },
  unknownAuthor: { ru: "Автор неизвестен", en: "Unknown author" },
  readOnly: {
    ru: "В демо этот блок доступен только для просмотра.",
    en: "This section is read-only in the demo.",
  },
} as const;

const button =
  "inline-flex min-h-10 items-center justify-center rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-surface-2 disabled:opacity-60";

/** Presentation has no writes: only explicit Yes/No invokes a supplied action. */
export function ManualMergeQuestion(
  { candidate, busy, disabled = false, readOnly = false, onDecision }: {
    candidate: ManualMergeCandidate;
    busy: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    onDecision: (decision: "merge" | "separate") => void;
  },
) {
  const dt = useDt(), copy = MANUAL_MERGE_COPY;
  const title = candidate.target.title ||
    dt(copy.untitled.ru, copy.untitled.en);
  const question = dt(copy.question.ru, copy.question.en).replace(
    "{title}",
    () => title,
  );
  const detail = candidate.arbitration.replace ? copy.replace : copy.retain;
  const start = new Date(candidate.target.startedAt ?? "");
  const when = Number.isNaN(start.getTime())
    ? null
    : start.toLocaleString(dt("ru-RU", "en-GB"), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  const metadata = [when, candidate.target.recorderNames?.join(", ")].filter(
    Boolean,
  ).join(" · ");
  const published = candidate.base === "workspace"
    ? copy.publishedShared
    : copy.publishedPersonal;
  return (
    <section
      aria-label={question}
      aria-busy={busy}
      className="mb-4 rounded-[10px] border border-accent-line bg-surface px-4 py-3 text-ink"
    >
      <p className="break-words text-sm font-semibold">{question}</p>
      {metadata && (
        <p className="mt-1 break-words text-xs text-ink-soft">{metadata}</p>
      )}
      {candidate.target.inBase && (
        <p className="mt-1 text-xs text-ink-soft">
          {dt(published.ru, published.en)}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">
        {dt(copy.description.ru, copy.description.en)}
      </p>
      <p className="mt-1 text-xs text-ink-soft">{dt(detail.ru, detail.en)}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || disabled || readOnly}
          onClick={() => onDecision("merge")}
          className={button}
        >
          {dt(copy.yes.ru, copy.yes.en)}
        </button>
        <button
          type="button"
          disabled={busy || disabled || readOnly}
          onClick={() => onDecision("separate")}
          className={button}
        >
          {dt(copy.no.ru, copy.no.en)}
        </button>
      </div>
      {readOnly && (
        <p role="status" className="mt-2 text-xs text-ink-soft">
          {dt(copy.readOnly.ru, copy.readOnly.en)}
        </p>
      )}
      {busy && (
        <p role="status" className="mt-2 text-xs text-ink-soft">
          {dt(copy.saving.ru, copy.saving.en)}
        </p>
      )}
    </section>
  );
}
