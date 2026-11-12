"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnswerBody } from "./screens/AnswerScreen";
import { RecordBody } from "./screens/RecordDetail";
import { RoyIcon } from "./icons";
import { useRoyNav, useDt } from "./nav";
import { fetchEntry, type AskSource } from "@/lib/api";
import type { Entry } from "@/types";

const ANSWER_MODAL_COPY = {
  loadError: { ru: "Не удалось загрузить запись.", en: "Could not load entry." },
  loading: { ru: "Загрузка…", en: "Loading…" },
  answer: { ru: "Ответ", en: "Answer" },
  back: { ru: "Назад", en: "Back" },
  close: { ru: "Закрыть", en: "Close" },
} as const;

// Запись внутри окна (источник из ответа) — НЕ уводим на отдельный экран, чтобы «Назад»
// возвращал к результатам поиска, а не на главную.
function ModalRecord({ id }: { id: string }) {
  const dt = useDt();
  const [e, setE] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let alive = true;
    setE(null); setErr(false);
    fetchEntry(id).then((x) => alive && setE(x)).catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [id]);
  if (err) return <div className="py-8 text-center text-sm text-ink-soft">{dt(ANSWER_MODAL_COPY.loadError.ru, ANSWER_MODAL_COPY.loadError.en)}</div>;
  if (!e) return <div className="py-8 text-center text-sm text-ink-soft">{dt(ANSWER_MODAL_COPY.loading.ru, ANSWER_MODAL_COPY.loading.en)}</div>;
  return <RecordBody entry={e} />;
}

// Контекстное окно ответа (десктоп) поверх дашборда. Уточнения переспрашивают внутри окна,
// источник раскрывается внутри окна же (с «Назад» к ответу) — без прыжка на главную.
export function AnswerModal({ query, onClose }: { query: string; onClose: () => void }) {
  const { push } = useRoyNav();
  const dt = useDt();
  const [q, setQ] = useState(query);
  const [recordId, setRecordId] = useState<string | null>(null);

  // Источник-встреча (entry_type="meeting") не умеет открываться ВНУТРИ окна — MeetingDetail
  // рассчитан на пуш-стек (свой NavHeader/pop), а не на встраивание как ModalRecord/RecordBody.
  // Поэтому для встречи закрываем окно и ведём на полноценный экран, а не показываем неполный/
  // неверный контент (issue: «Ответ» всегда вёл на RecordDetail, теряя транскрипт/задачи).
  const openSource = (source: AskSource) => {
    if (source.entry_type === "meeting") { onClose(); push({ view: "meetingDetail", params: { id: source.id } }); }
    else setRecordId(source.id);
  };

  useEffect(() => { setQ(query); setRecordId(null); }, [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (recordId) setRecordId(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, recordId]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-stretch justify-center bg-[var(--scrim-sheet)] sm:items-start sm:p-6 sm:pt-[6vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label={dt(ANSWER_MODAL_COPY.answer.ru, ANSWER_MODAL_COPY.answer.en)}
        onClick={(e) => e.stopPropagation()}
        className="flex w-full flex-col overflow-hidden border border-line bg-[var(--popover)] shadow-[0_24px_64px_-18px_rgba(0,0,0,.5)] sm:max-w-[760px] sm:rounded-[14px]"
        style={{ maxHeight: "88vh" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-line px-5 py-3.5">
          {recordId ? (
            <button onClick={() => setRecordId(null)} className="inline-flex items-center gap-0.5 font-semibold text-primary transition-transform active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" style={{ fontSize: 15 }}>
              <RoyIcon name="cleft" size={18} strokeWidth={2.2} /> {dt(ANSWER_MODAL_COPY.back.ru, ANSWER_MODAL_COPY.back.en)}
            </button>
          ) : (
            <span className="flex items-center gap-2 font-bold text-ink" style={{ fontSize: 16, letterSpacing: "-0.01em" }}>
              <RoyIcon name="spark" size={17} className="text-primary" /> {dt(ANSWER_MODAL_COPY.answer.ru, ANSWER_MODAL_COPY.answer.en)}
            </span>
          )}
          <button
            onClick={onClose}
            aria-label={dt(ANSWER_MODAL_COPY.close.ru, ANSWER_MODAL_COPY.close.en)}
            className="flex items-center justify-center rounded-full p-1.5 text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.95] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
          >
            <RoyIcon name="x" size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {recordId
            ? <ModalRecord id={recordId} />
            : <AnswerBody query={q} onFollowup={setQ} onOpenRecord={openSource} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
