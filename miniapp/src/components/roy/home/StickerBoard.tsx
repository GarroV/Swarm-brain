"use client";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useDt, useLang, useRoyNav } from "../nav";
import type { DashboardData } from "../dash/useDashboardData";
import { StickerCard, stickerTransitionName } from "./StickerCard";
import { StickerCreate } from "./StickerCreate";
import { fmtDue, PAPER } from "./stickerUi";
import { ackSticker, archiveSticker, fetchStickers, fetchTask } from "@/lib/api";
import { recall, remember } from "@/lib/lastSeen";
import { deadlineLabel, deadlineShort, STEP_DONE_EVENT, STEP_REQUEST_EVENT, stepReminder } from "@/lib/passkeyStep";
import { isHotDue, myAddressee, orderStickers, stickerProgress } from "@/lib/stickers";
import { withViewTransition } from "@/lib/viewTransition";
import { isOverdue } from "@/lib/smartLists";
import type { BoardSticker } from "@/types";

// Доска стикеров главной. Три живых стикера считаются на месте («Вычитай встречи», «Разбери
// просрочку», «Привяжите вход по Touch ID» — только тому, у кого второй шаг входа не пройден; закрыть
// его нельзя, он гаснет сам после привязки), остальные — настоящие, с сервера (GET /stickers): задание или объявление от админа.

const FACE = "relative flex w-full min-w-0 flex-col gap-2 rounded-[10px] border border-line bg-surface p-3 text-left text-ink transition-colors hover:border-accent-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]";
const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 250px), 1fr))", gap: 10 };

type LiveSticker = { key: string; tone: "blue" | "green" | "pink"; kind: string; title: string; body: string; due: string; hot?: boolean; action: string; onClick: () => void };

export function BoardWidget({ data, compact = false }: { data: DashboardData; compact?: boolean }) {
  const dt = useDt();
  const lang = useLang();
  const { me, setTab, openTasks, openTask, tasksVersion } = useRoyNav();
  const meId = me?.telegram_id ?? null;
  const isAdmin = !!me?.is_admin && !me?.is_demo;

  // Повторный заход — сразу с прошлыми стикерами, обновление в фоне (#906).
  const [stickers, setStickers] = useState<BoardSticker[] | null>(() => recall<BoardSticker[]>("home:stickers"));
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  // Стикер, который сейчас «превращается» в карточку или обратно: только у него есть
  // viewTransitionName, иначе одинаковые имена у двух элементов отменяют переход.
  const [morph, setMorph] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Палец привязан прямо сейчас: /me ещё старый, но напоминание уже не нужно.
  const [stepDone, setStepDone] = useState(false);
  useEffect(() => {
    const onDone = () => setStepDone(true);
    window.addEventListener(STEP_DONE_EVENT, onDone);
    return () => window.removeEventListener(STEP_DONE_EVENT, onDone);
  }, []);
  const reminder = stepDone ? null : stepReminder(me);

  useEffect(() => {
    let alive = true;
    fetchStickers()
      .then((list) => { remember("home:stickers", list); if (alive) { setStickers(list); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [attempt, tasksVersion]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const ordered = useMemo(() => orderStickers(stickers ?? [], meId), [stickers, meId]);
  const current = ordered.find((s) => s.id === open) ?? null;

  const review = data.reviewCount + data.pendingMeetings;
  const overdue = data.mine.filter((t) => isOverdue(t)).length;
  const live: LiveSticker[] = [
    ...(reminder ? [{
      key: "touchid", tone: "pink" as const, kind: dt("Напоминание · вход", "Reminder · sign-in"),
      title: dt("Привяжите вход по Touch ID", "Set up Touch ID sign-in"),
      body: reminder.required
        ? dt("Без него в Swarm не войти. Это займёт полминуты.", "You can't sign in to Swarm without it. It takes half a minute.")
        : dt(`${deadlineLabel(reminder.from, "ru")}, без него в Swarm не войти. Это займёт полминуты.`, `${deadlineLabel(reminder.from, "en")}, you won't be able to sign in to Swarm without it. It takes half a minute.`),
      due: deadlineShort(reminder.from, lang), hot: reminder.required, action: dt("Привязать", "Set up"),
      onClick: () => window.dispatchEvent(new Event(STEP_REQUEST_EVENT)),
    }] : []),
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
  const completed = (s: BoardSticker) => {
    const mine = myAddressee(s, meId);
    const { done, total } = stickerProgress(s);
    return mine ? mine.done : total > 0 && done === total;
  };
  const assignments = ordered.filter((s) => !completed(s) && s.kind === "task");
  const notices = ordered.filter((s) => !completed(s) && s.kind === "notice");
  const finished = ordered.filter(completed);
  const tile = (s: BoardSticker) => {
    const mine = myAddressee(s, meId);
    const doneForMe = completed(s);
    const { done, total } = stickerProgress(s);
    const hot = isHotDue(s.due_at, doneForMe);
    const kind = s.kind === "task" ? dt("Задание", "Assignment") : dt("Объявление", "Notice");
    return <button key={s.id} type="button" aria-haspopup="dialog"
      aria-label={`${kind}: ${s.title}${doneForMe ? ` (${dt("завершено", "completed")})` : ""}`}
      onClick={() => expand(s.id)} className={`${FACE} ${doneForMe ? "opacity-65" : ""}`}
      style={{ viewTransitionName: morph === s.id && open !== s.id ? stickerTransitionName(s.id) : undefined }}>
      <span className="flex flex-wrap items-center gap-2 text-[10px]">
        <span className={`rounded px-1.5 py-0.5 font-semibold ${PAPER[s.tone]}`}>{kind}</span>
        {mine && <span className="text-ink-mute">{dt("для вас", "for you")}</span>}
        {s.due_at && <span className={`ml-auto ${hot ? "font-semibold text-[var(--pri-high)]" : "text-ink-mute"}`}>{fmtDue(s.due_at, lang)}</span>}
      </span>
      <span className={`block text-[14px] font-semibold leading-snug ${doneForMe ? "line-through" : ""}`}>{s.title}</span>
      {s.body && <span className="line-clamp-2 block text-[12px] leading-snug text-ink-soft">{s.body}</span>}
      <span className="mt-auto flex items-center justify-between gap-2 pt-1 text-[11px]">
        <span className="text-ink-mute">{doneForMe ? "✓ " : ""}{s.kind === "task" ? dt(`${done}/${total} выполнили`, `${done}/${total} done`) : dt(`${done}/${total} прочитали`, `${done}/${total} read`)}</span>
        <span className="font-semibold text-primary">{s.kind === "task" ? dt("Открыть задание →", "View assignment →") : dt("Прочитать →", "Read →")}</span>
      </span>
    </button>;
  };
  return (
    <div data-cockpit-compact={compact || undefined} className="space-y-3 rounded-[12px] border border-line bg-surface p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] text-ink-soft">{dt("Отдельные действия и сообщения команды", "Actions and team updates")}</p>
        {isAdmin && <button type="button" onClick={() => setCreating(true)} className="shrink-0 rounded-md border border-line-2 px-2 py-1 text-[11px] font-semibold text-primary hover:border-accent-line">{dt("+ Добавить", "+ Add")}</button>}
      </div>
      {stickers == null && !failed && <div style={GRID}>{[0, 1].map((i) => <div key={i} className="roy-shim h-24 rounded-[10px]" />)}</div>}
      {(live.length > 0 || assignments.length > 0) && <section aria-label={dt("Задания и напоминания", "Assignments and reminders")}>
        <h3 className="mb-2 text-[11px] font-semibold text-ink-mute">{dt("Задания и напоминания", "Assignments and reminders")} · {live.length + assignments.length}</h3>
        <div style={GRID}>
        {live.map((s) => (
          <article key={s.key} className={FACE}>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]"><span className={`rounded px-1.5 py-0.5 font-semibold ${PAPER[s.tone]}`}>{s.kind}</span><span className={s.hot ? "font-semibold text-[var(--pri-high)]" : "text-ink-mute"}>{s.due}</span></div>
            <div className="text-[14px] font-semibold leading-snug">{s.title}</div>
            <div className="flex-1 text-[12px] leading-snug text-ink-soft">{s.body}</div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-mute">{dt("для вас", "for you")}</span>
              <button type="button" onClick={s.onClick} className="rounded-[7px] bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground">{s.action} →</button>
            </div>
          </article>
        ))}
        {assignments.map(tile)}
        </div>
      </section>}
      {notices.length > 0 && <section aria-label={dt("Объявления команды", "Team notices")}><h3 className="mb-2 text-[11px] font-semibold text-ink-mute">{dt("Объявления команды", "Team notices")} · {notices.length}</h3><div style={GRID}>{notices.map(tile)}</div></section>}
      {finished.length > 0 && <details className="border-t border-line pt-2"><summary className="cursor-pointer text-[11px] text-ink-mute">{dt("Выполнено и прочитано", "Completed and read")} · {finished.length}</summary><div className="mt-2" style={GRID}>{finished.map(tile)}</div></details>}
        {failed && stickers == null && (
          <div className="flex shrink-0 items-center text-ink-soft" style={{ fontSize: 13 }}>
            <span>{dt("Стикеры не загрузились", "Stickers failed to load")}&nbsp;</span>
            <button type="button" onClick={reload} className="font-medium text-primary hover:underline">{dt("Повторить", "Retry")}</button>
          </div>
        )}
        {none && <div className="flex shrink-0 items-center text-ink-mute" style={{ fontSize: 13 }}>{dt("Стикеров пока нет", "No stickers yet")}</div>}
      {current && (
        <StickerCard sticker={current} meTelegramId={meId} isAdmin={isAdmin} onClose={collapse} onAck={onAck} onArchive={onArchive} onOpenTask={onOpenTask} />
      )}
      {creating && <StickerCreate onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload(); }} />}
    </div>
  );
}
