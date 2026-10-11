"use client";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDt, useLang, useRoyNav } from "../nav";
import type { DashboardData } from "../dash/useDashboardData";
import { StickerCard, stickerTransitionName } from "./StickerCard";
import { StickerCreate } from "./StickerCreate";
import { fmtDue, PAPER } from "./stickerUi";
import { ackSticker, archiveSticker, fetchStickers, fetchTask } from "@/lib/api";
import { isHotDue, myAddressee, orderStickers, stickerProgress } from "@/lib/stickers";
import { withViewTransition } from "@/lib/viewTransition";
import { isOverdue } from "@/lib/smartLists";
import type { BoardSticker } from "@/types";

// Доска стикеров главной. Два живых стикера считаются на месте («Вычитай встречи», «Разбери
// просрочку»), остальные — настоящие, с сервера (GET /stickers): задание или объявление от админа.

const TILT = [-1.5, 1.2, -0.8, 1, -1.2];
const FACE = "relative flex min-h-[190px] w-[200px] shrink-0 flex-col gap-2 rounded-[3px] p-4 text-left shadow-[0_8px_18px_rgba(0,0,0,.14)] transition-transform hover:-translate-y-0.5 hover:rotate-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";

type LiveSticker = { key: string; tone: "blue" | "green"; kind: string; title: string; body: string; due: string; hot?: boolean; action: string; onClick: () => void };

function Tape() {
  return <i aria-hidden="true" className="absolute left-1/2 top-[-8px] h-4 w-16 -translate-x-1/2 rotate-[-2deg] bg-white/60" />;
}

export function BoardWidget({ data }: { data: DashboardData }) {
  const dt = useDt();
  const lang = useLang();
  const { me, setTab, openTasks, openTask, tasksVersion } = useRoyNav();
  const meId = me?.telegram_id ?? null;
  const isAdmin = !!me?.is_admin && !me?.is_demo;

  const [stickers, setStickers] = useState<BoardSticker[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // Стикер, который сейчас «превращается» в карточку или обратно: только у него есть
  // viewTransitionName, иначе одинаковые имена у двух элементов отменяют переход.
  const [morph, setMorph] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchStickers()
      .then((list) => { if (alive) { setStickers(list); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt, tasksVersion]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const ordered = useMemo(() => orderStickers(stickers ?? [], meId), [stickers, meId]);
  const current = ordered.find((s) => s.id === open) ?? null;

  const review = data.reviewCount + data.pendingMeetings;
  const overdue = data.mine.filter((t) => isOverdue(t)).length;
  const live: LiveSticker[] = [
    ...(review > 0 ? [{ key: "review", tone: "blue" as const, kind: dt("Задание · сейчас", "Task · now"), title: dt("Вычитай встречи", "Review meetings"), body: dt(`${review} в очереди на вычитку.`, `${review} waiting for review.`), due: dt(`${review} в очереди`, `${review} queued`), action: dt("Вычитать", "Review"), onClick: () => setTab("cal") }] : []),
    ...(overdue > 0 ? [{ key: "overdue", tone: "green" as const, kind: dt("Задание · задачи", "Task · tasks"), title: dt("Разбери просрочку", "Clear overdue"), body: dt(`${overdue} задач со сроком в прошлом.`, `${overdue} tasks are past due.`), due: dt("сегодня", "today"), hot: true, action: dt("Открыть", "Open"), onClick: () => openTasks("mine", "all") }] : []),
  ];

  // Раскрытие: имя перехода ставим на стикер ДО снимка «было», в колбэке меняем на карточку.
  const expand = (id: string) => {
    flushSync(() => setMorph(id));
    withViewTransition(() => setOpen(id));
  };
  const collapse = () => {
    const id = open;
    withViewTransition(() => { setOpen(null); setMorph(id); });
  };

  const onAck = async (id: string) => { await ackSticker(id); reload(); };
  const onArchive = async (id: string) => {
    await archiveSticker(id);
    setOpen(null);
    reload();
  };
  const onOpenTask = async (taskId: string) => {
    const known = data.mine.find((t) => t.id === taskId);
    const task = known ?? await fetchTask(taskId).catch(() => null);
    setOpen(null);
    if (task) openTask(task);
    else openTasks("mine", "all");
  };

  const none = stickers != null && ordered.length === 0 && live.length === 0;
  return (
    <div className="rounded-[14px] border border-line bg-[repeating-linear-gradient(45deg,color-mix(in_srgb,var(--pri-med)_7%,var(--surface-2))_0_2px,var(--surface-2)_2px_9px)] p-4">
      <div className="flex gap-4 overflow-x-auto pb-2 pt-2" style={{ scrollSnapType: "x mandatory" }}>
        {stickers == null && !failed && [0, 1].map((i) => <div key={i} className="roy-shim w-[200px] shrink-0" style={{ height: 190, borderRadius: 3 }} />)}
        {live.map((s, i) => (
          <article key={s.key} className={`${FACE} ${PAPER[s.tone]}`} style={{ transform: `rotate(${TILT[i % 5]}deg)`, scrollSnapAlign: "start" }}>
            <Tape />
            <div className="font-bold uppercase opacity-60" style={{ fontSize: 10, letterSpacing: "0.1em" }}>{s.kind}</div>
            <div className="font-bold leading-tight" style={{ fontSize: 19 }}>{s.title}</div>
            <div className="flex-1 opacity-80" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.body}</div>
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded px-1.5 py-0.5 font-mono ${s.hot ? "bg-[#D03A3A] text-white" : "bg-black/10"}`} style={{ fontSize: 10.5 }}>{s.due}</span>
              <button type="button" onClick={s.onClick} className="rounded-[7px] bg-[#1B1B1B] px-2.5 py-1 font-semibold text-white hover:bg-black" style={{ fontSize: 11.5 }}>{s.action}</button>
            </div>
          </article>
        ))}
        {ordered.map((s, i) => {
          const mine = myAddressee(s, meId);
          const mineDone = !!mine?.done;
          const { done, total } = stickerProgress(s);
          const hot = isHotDue(s.due_at, mine ? mine.done : false);
          const kind = s.kind === "task" ? dt("Задание", "Task") : dt("Объявление", "Notice");
          return (
            <button
              key={s.id}
              type="button"
              aria-haspopup="dialog"
              aria-label={`${kind}: ${s.title}${mineDone ? ` (${dt("выполнено", "done")})` : ""}`}
              onClick={() => expand(s.id)}
              className={`${FACE} ${PAPER[s.tone]} ${mineDone ? "opacity-60" : ""}`}
              style={{
                transform: `rotate(${TILT[(i + live.length) % 5]}deg)`,
                scrollSnapAlign: "start",
                viewTransitionName: morph === s.id && open !== s.id ? stickerTransitionName(s.id) : undefined,
              }}
            >
              <Tape />
              <span className="block font-bold uppercase opacity-60" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                {kind}{mine ? ` · ${dt("вам", "for you")}` : ""}
              </span>
              <span className={`block font-bold leading-tight ${mineDone ? "line-through" : ""}`} style={{ fontSize: 19 }}>{s.title}</span>
              <span className="line-clamp-4 block flex-1 opacity-80" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.body}</span>
              <span className="flex items-center justify-between gap-2">
                {s.due_at
                  ? <span className={`rounded px-1.5 py-0.5 font-mono ${hot ? "bg-[#D03A3A] text-white" : "bg-black/10"}`} style={{ fontSize: 10.5 }}>{fmtDue(s.due_at, lang)}</span>
                  : <span />}
                <span className="font-mono opacity-70" style={{ fontSize: 10.5 }}>{mineDone ? "✓ " : ""}{done}/{total}</span>
              </span>
            </button>
          );
        })}
        {failed && stickers == null && (
          <div className="flex shrink-0 items-center text-ink-soft" style={{ fontSize: 13 }}>
            <span>{dt("Стикеры не загрузились", "Stickers failed to load")}&nbsp;</span>
            <button type="button" onClick={reload} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
          </div>
        )}
        {none && <div className="flex shrink-0 items-center text-ink-mute" style={{ fontSize: 13 }}>{dt("Стикеров пока нет", "No stickers yet")}</div>}
        {isAdmin && (
          <button type="button" onClick={() => setCreating(true)} className="grid w-[150px] shrink-0 place-items-center rounded-[6px] border-2 border-dashed border-line-2 text-ink-mute hover:border-accent-line hover:text-primary" style={{ fontSize: 12.5 }}>
            <span><b className="block text-center" style={{ fontSize: 22 }}>+</b>{dt("Стикер", "Sticker")}<br /><small>{dt("задание или объявление", "task or notice")}</small></span>
          </button>
        )}
      </div>
      {current && (
        <StickerCard sticker={current} meTelegramId={meId} isAdmin={isAdmin} onClose={collapse} onAck={onAck} onArchive={onArchive} onOpenTask={onOpenTask} />
      )}
      {creating && <StickerCreate onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
