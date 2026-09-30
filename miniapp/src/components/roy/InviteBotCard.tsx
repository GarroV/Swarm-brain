"use client";
// «Вставь ссылку на созвон — бот постучится» (решение D017, как кнопка Read.ai).
// Человек вставляет ссылку → POST /meeting-invites → видит статус ТЕКУЩЕГО приглашения, пока бот
// не начал писать или срок не вышел. Разбор ответа и тексты — lib/meetingInvite.ts.
//
// Истории приглашений нет (владелец 30.09.2026: «зачем история приглашений?»): человеку нужен
// ответ «бот идёт или нет» про ссылку, которую он только что вставил, а не журнал прошлых.
// Id живого приглашения экран помнит в localStorage вкладки — ушёл в другой раздел и вернулся,
// статус на месте. Окончательное (записал / истекло) показываем, пока экран открыт, и забываем.
//
// Десктоп — кнопка в панели «Встреч» с небольшим окном под ней (`InviteBotButton`), мобайл —
// компактная карточка (`InviteBotCard`). Состояние у обоих одно — `useMeetingInvite`.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDt, useRoyNav } from "./nav";
import { RoyCard, SectionLabel } from "./ui";
import { RoyIcon } from "./icons";
import { ToolbarButton } from "@/components/tasks/table/Menu";
import { ApiError, createMeetingInvite, fetchMeetingInvite } from "@/lib/api";
import {
  INVITE_POLL_MS,
  type MeetingInvite,
  inviteErrorText,
  inviteStatusLabel,
  isFinalStatus,
  parseInviteErrorCode,
} from "@/lib/meetingInvite";

const STORAGE_KEY = "swarm.meetingInvite";

function loadId(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

function saveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Хранилище закрыто (приватное окно) — просто не помним между заходами.
  }
}

/** 404 — приглашения больше нет (или оно не наше): забываем. */
const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;

type InviteState = ReturnType<typeof useMeetingInvite>;

function useMeetingInvite() {
  const dt = useDt();
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<MeetingInvite | null>(null);

  const keep = useCallback((next: MeetingInvite | null) => {
    setInvite(next);
    // Помним только живое: окончательное после перезагрузки не нужно никому.
    saveId(next && !isFinalStatus(next.status) ? next.id : null);
  }, []);

  const refresh = useCallback(async (id: string, silentGone: boolean) => {
    try {
      const fresh = await fetchMeetingInvite(id);
      // Открыли экран, а приглашение уже закончилось раньше — старое не показываем.
      keep(silentGone && isFinalStatus(fresh.status) ? null : fresh);
    } catch (e) {
      if (isGone(e)) keep(null);
      // Сеть моргнула — оставляем прежний статус, спросим на следующем круге.
    }
  }, [keep]);

  useEffect(() => {
    const id = loadId();
    if (id) void refresh(id, true);
  }, [refresh]);

  const liveId = invite && !isFinalStatus(invite.status) ? invite.id : null;
  useEffect(() => {
    if (!liveId) return;
    const timer = setInterval(() => void refresh(liveId, false), INVITE_POLL_MS);
    return () => clearInterval(timer);
  }, [liveId, refresh]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const link = url.trim();
    if (!link || sending) return;
    setSending(true);
    setError(null);
    try {
      keep(await createMeetingInvite(link));
      setUrl("");
    } catch (e) {
      setError(inviteErrorText(e instanceof ApiError ? parseInviteErrorCode(e.body) : null, dt));
    } finally {
      setSending(false);
    }
  };

  const changeUrl = (v: string) => { setUrl(v); if (error) setError(null); };
  return { url, changeUrl, sending, error, invite, isLive: liveId !== null, submit, clear: () => keep(null) };
}

/** Поле, кнопка, ошибка и одна строка статуса текущего приглашения. */
function InviteForm({ s, autoFocus = false }: { s: InviteState; autoFocus?: boolean }) {
  const dt = useDt();
  const { push } = useRoyNav();
  const inv = s.invite;
  return (
    <>
      {/* noValidate: мусор в поле должен дойти до сервера и вернуться нашим текстом, а не
          браузерной подсказкой на одном языке. */}
      <form onSubmit={s.submit} noValidate className="flex gap-1.5">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          autoFocus={autoFocus}
          value={s.url}
          onChange={(e) => s.changeUrl(e.target.value)}
          placeholder="https://meet.google.com/…"
          aria-label={dt("Ссылка на созвон", "Call link")}
          aria-invalid={s.error ? true : undefined}
          aria-describedby={s.error ? "invite-bot-error" : undefined}
          className="min-w-0 flex-1 rounded-[7px] border border-line-2 bg-surface px-2.5 py-1.5 text-ink outline-none focus:border-primary aria-invalid:border-destructive"
          style={{ fontSize: 13 }}
        />
        <button
          type="submit"
          disabled={!s.url.trim() || s.sending}
          className="shrink-0 rounded-[7px] bg-primary px-3 py-1.5 font-semibold text-primary-foreground transition-opacity disabled:opacity-50"
          style={{ fontSize: 12.5 }}
        >
          {s.sending ? dt("Зовём…", "Inviting…") : dt("Позвать", "Invite")}
        </button>
      </form>
      {s.error && (
        <p id="invite-bot-error" role="alert" className="mt-1.5" style={{ fontSize: 12, color: "var(--pri-high)" }}>
          {s.error}
        </p>
      )}
      {/* Толк, комната закрыта для гостей (D040, T111): бот перезагружает страницу и ждёт до
          BOT_PROFILE.guestRoom.waitMinutes (сейчас 10) — число здесь держим в согласии вручную,
          сервер и бот сверяет контрактный тест supabase/functions/_shared/bot-profile.test.ts. */}
      <p className="mt-1.5 text-ink-mute" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
        {dt(
          "Толк: откройте комнату для внешних участников — бот зайдёт гостем, ждёт до 10 минут.",
          "Kontur.Talk: open the room to external participants — the bot joins as a guest and waits up to 10 minutes.",
        )}
      </p>
      {inv && (
        <div role="status" className="mt-2 flex items-center gap-2" style={{ fontSize: 12 }}>
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${inv.status === "expired" ? "bg-line-2" : inv.status === "used" ? "bg-status-done" : "bg-status-prog"}`} aria-hidden />
          <span className={`min-w-0 flex-1 truncate ${inv.status === "expired" ? "text-ink-mute" : "text-ink-soft"}`}>
            {inviteStatusLabel(inv.status, dt)}
          </span>
          {inv.status === "used" && inv.meeting_id && (
            <button type="button" onClick={() => push({ view: "meetingReview", params: { id: inv.meeting_id as string } })}
              className="shrink-0 font-semibold text-accent-ink hover:underline">
              {dt("Открыть", "Open")}
            </button>
          )}
          {isFinalStatus(inv.status) && (
            <button type="button" aria-label={dt("Скрыть", "Hide")} onClick={s.clear}
              className="shrink-0 text-ink-mute hover:text-ink">
              <RoyIcon name="x" size={13} />
            </button>
          )}
        </div>
      )}
    </>
  );
}

const HINT: [string, string] = [
  "Ссылка на Google Meet или Контур.Толк — бот постучится и запишет встречу.",
  "A Google Meet or Kontur.Talk link — the bot will knock and record the meeting.",
];

/** Десктоп: кнопка в панели «Встреч» и небольшое окно под ней, прижатое к правому краю. */
export function InviteBotButton() {
  const dt = useDt();
  const s = useMeetingInvite();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Пока бот идёт, кнопка сама говорит об этом — открывать окно ради статуса не нужно.
  const label = s.isLive && s.invite ? inviteStatusLabel(s.invite.status, dt) : dt("Позвать бота", "Invite the bot");
  return (
    <span ref={ref} className="relative">
      <ToolbarButton on={s.isLive} popup={{ open }} onClick={() => setOpen((v) => !v)}>
        <RoyIcon name="meet" size={13} />
        {label}
      </ToolbarButton>
      {open && (
        <div role="dialog" aria-label={dt("Позвать бота на созвон", "Invite the bot to a call")}
          className="absolute right-0 top-full z-50 mt-1 w-[320px] rounded-[10px] border border-line bg-[var(--popover)] p-3 shadow-[0_14px_36px_-12px_rgba(0,0,0,.35)]">
          <p className="mb-2 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.4 }}>{dt(...HINT)}</p>
          <InviteForm s={s} autoFocus />
        </div>
      )}
    </span>
  );
}

/** Мобайл: компактная карточка на экране «Встречи». */
export function InviteBotCard() {
  const dt = useDt();
  const s = useMeetingInvite();
  return (
    <RoyCard className="px-3 py-2.5">
      <SectionLabel className="!mb-1">{dt("Позвать бота на созвон", "Invite the bot to a call")}</SectionLabel>
      <p className="mx-1 mb-2 text-ink-soft" style={{ fontSize: 12, lineHeight: 1.4 }}>{dt(...HINT)}</p>
      <InviteForm s={s} />
    </RoyCard>
  );
}
