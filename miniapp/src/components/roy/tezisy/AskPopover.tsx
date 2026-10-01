"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/lib/api";
import { RoyIcon } from "../icons";
import { TezisyBlocks } from "../ui";
import { useDt } from "../nav";

// Точечный вопрос по выделенному куску тезисов (решение владельца 2026-09-30). Две части:
// кнопка «Спросить» у выделения и окошко с вопросом и ответом. Окошко живёт в портале: панель
// карточки анимируется transform'ом, и fixed-позиция внутри неё съезжала бы. role="dialog" —
// чтобы Esc закрывал окошко, а не всю панель (DetailPanel пропускает Esc, пока открыт диалог).

export type AskAnchor = { top: number; bottom: number; left: number };
export type AskApply = "insert" | "replace";

const POP_W = 360;
const GUTTER = 16;
const QUESTION_MAX = 300;

function place(anchor: AskAnchor, width: number): React.CSSProperties {
  const left = Math.min(Math.max(anchor.left, GUTTER), window.innerWidth - width - GUTTER);
  // В нижней части экрана — над выделением, иначе окошко уходит за край.
  return anchor.bottom > window.innerHeight * 0.6
    ? { left, bottom: window.innerHeight - anchor.top + 8 }
    : { left, top: anchor.bottom + 8 };
}

/** Кнопка у выделения. mousedown гасим — иначе клик снимает выделение раньше, чем сработает. */
export function AskChip({ anchor, onOpen }: { anchor: AskAnchor; onOpen: () => void }) {
  const dt = useDt();
  return createPortal(
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onOpen}
      className="fixed z-[60] inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-card font-semibold text-accent-ink shadow-lg transition-transform active:scale-[0.97]"
      style={{ ...place(anchor, 120), padding: "5px 10px", fontSize: 12 }}>
      <RoyIcon name="spark" size={13} strokeWidth={1.9} /> {dt("Спросить", "Ask")}
    </button>,
    document.body,
  );
}

export function AskPopover({ anchor, fragment, ask, onApply, onClose }: {
  anchor: AskAnchor;
  fragment: string;
  ask: (fragment: string, question: string) => Promise<string>;
  /** Нет — ответ только читают (нет прав на правку); кнопки вставки не показываем. */
  onApply?: (answer: string, mode: AskApply) => void;
  onClose: () => void;
}) {
  const dt = useDt();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const width = Math.min(POP_W, window.innerWidth - GUTTER * 2);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await ask(fragment, question.trim()));
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404
        ? dt("Спрашивать по встрече может только тот, кто её записывал.", "Only the people who recorded the meeting can ask about it.")
        : dt("Не удалось получить ответ — попробуй ещё раз.", "Couldn't get an answer — try again."));
    } finally {
      setBusy(false);
    }
  };

  const btn = "rounded-full px-3 py-2 font-semibold transition-transform active:scale-[0.98]";
  return createPortal(
    <div ref={boxRef} role="dialog" aria-label={dt("Вопрос по встрече", "Ask about the meeting")}
      className="fixed z-[60] flex flex-col gap-2.5 rounded-[10px] border border-line bg-card p-3 shadow-lg dark:backdrop-blur-lg"
      style={{ ...place(anchor, width), width }}>
      <div className="flex items-start gap-2">
        <p className="line-clamp-3 flex-1 border-l-2 border-accent-line pl-2 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.5 }}>
          {fragment}
        </p>
        <button type="button" onClick={onClose} aria-label={dt("Закрыть", "Close")} title="Esc"
          className="-mr-1 -mt-1 shrink-0 rounded-full p-1 text-ink-mute transition-colors hover:bg-surface-2 hover:text-ink">
          <RoyIcon name="x" size={14} strokeWidth={2} />
        </button>
      </div>
      {answer === null ? (
        <>
          <input autoFocus value={question} maxLength={QUESTION_MAX} disabled={busy}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
            placeholder={dt("Что конкретно здесь обсуждали?", "What exactly was discussed here?")}
            className="w-full rounded-[8px] border border-line bg-surface px-2.5 py-2 text-ink outline-none focus:border-primary/50"
            style={{ fontSize: 13 }} />
          {error && <p className="text-ink-soft" style={{ fontSize: 12 }}>{error}</p>}
          <button type="button" onClick={submit} disabled={busy}
            className={`${btn} inline-flex items-center justify-center gap-1.5 bg-primary text-primary-foreground disabled:opacity-60`} style={{ fontSize: 13 }}>
            <RoyIcon name="spark" size={13} strokeWidth={1.9} />
            {busy ? dt("Ищу в записи…", "Searching the recording…") : dt("Спросить", "Ask")}
          </button>
        </>
      ) : (
        <>
          <div className="max-h-64 overflow-y-auto"><TezisyBlocks text={answer} /></div>
          {onApply && (
            <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => onApply(answer, "insert")} className={`${btn} bg-primary text-primary-foreground`} style={{ fontSize: 12 }}>
                  {dt("Вставить под пунктом", "Insert below")}
                </button>
                <button type="button" onClick={() => onApply(answer, "replace")} className={`${btn} border border-line-2 text-ink`} style={{ fontSize: 12 }}>
                  {dt("Заменить пункт", "Replace the point")}
                </button>
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
