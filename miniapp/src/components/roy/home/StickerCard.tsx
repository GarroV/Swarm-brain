"use client";
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDt, useLang } from "../nav";
import { useDialogA11y } from "./useDialogA11y";
import { fmtDue, PAPER } from "./stickerUi";
import { isExternalHref, isHotDue, myAddressee, safeStickerHref, stickerProgress } from "@/lib/stickers";
import type { BoardSticker } from "@/types";

// Развёрнутый стикер: кто подключён, кто выполнил, «Понятно» для объявления. Открывается морфингом
// из самого стикера (одинаковый viewTransitionName, см. lib/viewTransition.ts).

export const stickerTransitionName = (id: string) => `sticker-${id}`;

type Props = {
  sticker: BoardSticker;
  meTelegramId: number | null;
  isAdmin: boolean;
  onClose: () => void;
  onAck: (id: string) => Promise<void>;
  onArchive: (id: string) => Promise<void>;
  onOpenTask: (taskId: string) => void;
};

export function StickerCard({ sticker: s, meTelegramId, isAdmin, onClose, onAck, onArchive, onOpenTask }: Props) {
  const dt = useDt();
  const lang = useLang();
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useDialogA11y(ref, onClose);

  const me = myAddressee(s, meTelegramId);
  const { done, total } = stickerProgress(s);
  const href = safeStickerHref(s.link);
  const hot = isHotDue(s.due_at, me ? me.done : done === total && total > 0);
  const titleId = `sticker-title-${s.id}`;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : dt("Не получилось", "Something went wrong"));
    } finally {
      setBusy(false);
    }
  };

  const kindLabel = s.kind === "task" ? dt("Задание", "Task") : dt("Объявление", "Notice");
  const progressLabel = s.kind === "task"
    ? dt(`${done} / ${total} выполнили`, `${done} / ${total} done`)
    : dt(`${done} / ${total} ознакомились`, `${done} / ${total} acknowledged`);

  return createPortal(
    <div
      className="fixed inset-0 z-[90] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ viewTransitionName: stickerTransitionName(s.id) }}
        className={`relative flex max-h-[86vh] w-full max-w-[480px] flex-col gap-3 overflow-y-auto rounded-[4px] p-6 shadow-[0_18px_44px_rgba(0,0,0,.32)] outline-none ${PAPER[s.tone]}`}
      >
        <i aria-hidden="true" className="absolute left-1/2 top-[-9px] h-4 w-20 -translate-x-1/2 rotate-[-2deg] bg-white/60" />
        <div className="flex items-start justify-between gap-3">
          <div className="font-bold uppercase opacity-60" style={{ fontSize: 10.5, letterSpacing: "0.1em" }}>{kindLabel}</div>
          <button
            type="button"
            data-autofocus
            onClick={onClose}
            aria-label={dt("Закрыть", "Close")}
            className="-m-1 rounded-md px-2 py-0.5 text-[20px] leading-none opacity-60 hover:bg-black/10 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#1B1B1B]"
          >
            ×
          </button>
        </div>

        <h2 id={titleId} className="font-bold leading-tight" style={{ fontSize: 24 }}>{s.title}</h2>
        {s.body && <p className="whitespace-pre-wrap opacity-85" style={{ fontSize: 14, lineHeight: 1.5 }}>{s.body}</p>}

        <div className="flex flex-wrap items-center gap-2">
          {s.due_at && (
            <span className={`rounded px-1.5 py-0.5 font-mono ${hot ? "bg-[#D03A3A] text-white" : "bg-black/10"}`} style={{ fontSize: 11 }}>
              {dt("срок", "due")} {fmtDue(s.due_at, lang)}
            </span>
          )}
          {href && (
            <a
              href={href}
              {...(isExternalHref(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className="rounded-[7px] border border-black/25 px-2.5 py-1 font-semibold underline-offset-2 hover:bg-black/10 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1B1B1B]"
              style={{ fontSize: 12 }}
            >
              {dt("Открыть ссылку", "Open link")} ↗
            </a>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between" style={{ fontSize: 12.5 }}>
            <b>{progressLabel}</b>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={progressLabel}>
            <div className="h-full rounded-full bg-[#1B1B1B]" style={{ width: total ? `${(done / total) * 100}%` : 0 }} />
          </div>
        </div>

        <ul className="max-h-[220px] space-y-0.5 overflow-y-auto" style={{ fontSize: 13 }}>
          {s.addressees.map((a) => (
            <li key={a.person_id} className="flex items-center gap-2">
              <span aria-hidden="true" className="w-4 text-center font-bold">{a.done ? "✓" : "○"}</span>
              <span className={a.done ? "opacity-60" : ""}>{a.name}</span>
              <span className="sr-only">{a.done ? dt("выполнено", "done") : dt("не выполнено", "not done")}</span>
              {a.telegram_id === meTelegramId && <span className="opacity-60" style={{ fontSize: 11 }}>{dt("(вы)", "(you)")}</span>}
            </li>
          ))}
          {total === 0 && <li className="opacity-60">{dt("Адресатов нет", "No addressees")}</li>}
        </ul>

        {error && <p role="alert" className="rounded bg-[#D03A3A] px-2 py-1 text-white" style={{ fontSize: 12 }}>{error}</p>}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {s.kind === "notice" && me && !me.done && (
            <button type="button" disabled={busy} onClick={() => run(() => onAck(s.id))}
              className="rounded-[7px] bg-[#1B1B1B] px-3 py-1.5 font-semibold text-white hover:bg-black disabled:opacity-60" style={{ fontSize: 12.5 }}>
              {dt("Понятно", "Got it")}
            </button>
          )}
          {s.kind === "notice" && me?.done && (
            <span className="font-semibold opacity-70" style={{ fontSize: 12.5 }}>✓ {dt("Вы отметили «Понятно»", "You marked “Got it”")}</span>
          )}
          {s.kind === "task" && me?.task_id && (
            <button type="button" onClick={() => onOpenTask(me.task_id!)}
              className="rounded-[7px] bg-[#1B1B1B] px-3 py-1.5 font-semibold text-white hover:bg-black" style={{ fontSize: 12.5 }}>
              {dt("Открыть задачу", "Open task")}
            </button>
          )}
          {isAdmin && (
            <button type="button" disabled={busy} onClick={() => run(() => onArchive(s.id))}
              className="ml-auto rounded-[7px] border border-black/25 px-3 py-1.5 font-semibold hover:bg-black/10 disabled:opacity-60" style={{ fontSize: 12.5 }}>
              {dt("В архив", "Archive")}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
