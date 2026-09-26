"use client";
// «Вставь ссылку на созвон — бот постучится» (решение D017, как кнопка Read.ai).
// Человек вставляет ссылку → POST /meeting-invites → видит статус своего приглашения, пока
// бот не начал писать или срок не вышел. Разбор ответа и тексты — lib/meetingInvite.ts.
//
// Список своих приглашений сервер не отдаёт (только GET по id), поэтому экран помнит id в
// localStorage этой вкладки-браузера: ушёл на другой раздел и вернулся — статус на месте.
// Это удобство, а не источник истины: пустое хранилище значит лишь «не показываем старые».
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useDt, useRoyNav } from "./nav";
import { RoyCard, SectionLabel } from "./ui";
import { RoyIcon } from "./icons";
import { ApiError, createMeetingInvite, fetchMeetingInvite } from "@/lib/api";
import {
  INVITE_POLL_MS,
  type InviteStatus,
  type MeetingInvite,
  inviteErrorText,
  invitePlatformLabel,
  inviteStatusLabel,
  isFinalStatus,
  parseInviteErrorCode,
  upsertInvite,
} from "@/lib/meetingInvite";

const STORAGE_KEY = "swarm.meetingInvites";

function loadIds(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function saveIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Хранилище закрыто (приватное окно) — просто не помним между заходами.
  }
}

const STATUS_STYLE: Record<InviteStatus, { background: string; color: string; border?: string }> = {
  pending: { background: "var(--surface-2)", color: "var(--ink-soft)" },
  taken: { background: "var(--accent-soft)", color: "var(--accent-ink)" },
  used: { background: "var(--meet-soft)", color: "var(--meet-ink)" },
  // Окончательный отказ не должен выглядеть как живое ожидание: без заливки, пунктирная рамка.
  expired: { background: "transparent", color: "var(--ink-mute)", border: "1px dashed var(--line-2)" },
};

function linkText(url: string): string {
  return url.replace(/^https?:\/\//, "");
}

/** 404 — приглашения больше нет (или оно не наше): из списка убираем. */
const isGone = (e: unknown) => e instanceof ApiError && e.status === 404;

function InviteRow({ invite, onOpenMeeting, onDismiss }: { invite: MeetingInvite; onOpenMeeting: (id: string) => void; onDismiss: () => void }) {
  const dt = useDt();
  const final = isFinalStatus(invite.status);
  return (
    // flex-wrap: на 320 px кнопка «Открыть встречу» уходит под статус, а не наезжает на него.
    <li className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 rounded-[12px] border border-line px-3 py-2">
      <div className="min-w-0 flex-[1_1_170px]">
        <div className="truncate text-ink" style={{ fontSize: 13 }} title={invite.join_url}>
          <span className="font-semibold">{invitePlatformLabel(invite.platform)}</span>
          <span className="text-ink-mute"> · {linkText(invite.join_url)}</span>
        </div>
        <span
          role="status"
          className="mt-1 inline-flex items-center whitespace-nowrap font-semibold"
          style={{ fontSize: 11, borderRadius: 7, padding: "1px 7px", ...STATUS_STYLE[invite.status] }}
        >
          {inviteStatusLabel(invite.status, dt)}
        </span>
      </div>
      {invite.status === "used" && invite.meeting_id && (
        <button
          type="button"
          onClick={() => onOpenMeeting(invite.meeting_id as string)}
          className="shrink-0 rounded-[10px] border border-line-2 px-2.5 py-1.5 font-semibold text-accent-ink transition-colors hover:bg-surface-2"
          style={{ fontSize: 12 }}
        >
          {dt("Открыть встречу", "Open meeting")}
        </button>
      )}
      {final && (
        <button
          type="button"
          aria-label={dt("Убрать из списка", "Remove from the list")}
          onClick={onDismiss}
          className="flex shrink-0 items-center justify-center rounded-[10px] text-ink-mute transition-colors hover:bg-surface-2"
          style={{ width: 32, height: 32 }}
        >
          <RoyIcon name="x" size={16} />
        </button>
      )}
    </li>
  );
}

export function InviteBotCard() {
  const { push } = useRoyNav();
  const dt = useDt();
  const [url, setUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invites, setInvites] = useState<MeetingInvite[]>([]);
  const invitesRef = useRef(invites);
  invitesRef.current = invites;

  const remember = useCallback((next: MeetingInvite[]) => {
    setInvites(next);
    saveIds(next.map((x) => x.id));
  }, []);

  // Перечитать статусы тех, что ещё могут измениться. Пропавшие (404) — выбрасываем.
  const refresh = useCallback(async (list: MeetingInvite[] | string[]) => {
    const current = invitesRef.current;
    const results = await Promise.all(
      list.map(async (item) => {
        const id = typeof item === "string" ? item : item.id;
        try {
          return await fetchMeetingInvite(id);
        } catch (e) {
          if (isGone(e)) return null;
          // Сеть моргнула — оставляем прежний статус, спросим на следующем круге.
          return current.find((x) => x.id === id) ?? null;
        }
      }),
    );
    const fresh = results.filter((x): x is MeetingInvite => x !== null);
    const byId = new Map(fresh.map((x) => [x.id, x]));
    const asked = new Set(list.map((item) => (typeof item === "string" ? item : item.id)));
    const merged = [
      ...invitesRef.current.filter((x) => !asked.has(x.id) || byId.has(x.id)).map((x) => byId.get(x.id) ?? x),
      ...fresh.filter((x) => !invitesRef.current.some((y) => y.id === x.id)),
    ];
    remember(merged);
  }, [remember]);

  useEffect(() => {
    const ids = loadIds();
    if (ids.length > 0) void refresh(ids);
  }, [refresh]);

  const live = invites.filter((x) => !isFinalStatus(x.status));
  useEffect(() => {
    if (live.length === 0) return;
    const timer = setInterval(() => void refresh(invitesRef.current.filter((x) => !isFinalStatus(x.status))), INVITE_POLL_MS);
    return () => clearInterval(timer);
  }, [live.length, refresh]);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const link = url.trim();
    if (!link || sending) return;
    setSending(true);
    setError(null);
    try {
      const invite = await createMeetingInvite(link);
      remember(upsertInvite(invitesRef.current, invite));
      setUrl("");
    } catch (e) {
      setError(inviteErrorText(e instanceof ApiError ? parseInviteErrorCode(e.body) : null, dt));
    } finally {
      setSending(false);
    }
  };

  const dismiss = (id: string) => remember(invitesRef.current.filter((x) => x.id !== id));
  const openMeeting = (id: string) => push({ view: "meetingReview", params: { id } });

  return (
    <RoyCard className="px-3.5 py-3">
      <SectionLabel className="!mb-1.5">{dt("Позвать бота на созвон", "Invite the bot to a call")}</SectionLabel>
      <p className="mx-1 mb-2.5 text-ink-soft" style={{ fontSize: 12.5, lineHeight: 1.4 }}>
        {dt(
          "Вставьте ссылку на Google Meet — бот постучится и запишет встречу.",
          "Paste a Google Meet link — the bot will knock and record the meeting.",
        )}
      </p>
      {/* noValidate: мусор в поле должен дойти до сервера и вернуться нашим текстом, а не
          браузерной подсказкой на одном языке. */}
      <form onSubmit={submit} noValidate className="flex flex-wrap gap-2">
        <input
          type="url"
          inputMode="url"
          autoComplete="off"
          value={url}
          onChange={(e) => { setUrl(e.target.value); if (error) setError(null); }}
          placeholder="https://meet.google.com/abc-defg-hij"
          aria-label={dt("Ссылка на созвон", "Call link")}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "invite-bot-error" : undefined}
          className="min-w-0 flex-[1_1_200px] rounded-[12px] border border-line-2 bg-surface px-3 py-2 text-ink outline-none focus:border-primary aria-invalid:border-destructive"
          style={{ fontSize: 14 }}
        />
        <button
          type="submit"
          disabled={!url.trim() || sending}
          className="shrink-0 grow rounded-[12px] bg-primary px-4 py-2 font-semibold text-primary-foreground transition-opacity disabled:opacity-50 sm:grow-0"
          style={{ fontSize: 14 }}
        >
          {sending ? dt("Зовём…", "Inviting…") : dt("Позвать бота", "Invite the bot")}
        </button>
      </form>
      {error && (
        <p id="invite-bot-error" role="alert" className="mx-1 mt-2" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>
          {error}
        </p>
      )}
      {invites.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={dt("Мои приглашения", "My invites")}>
          {invites.map((inv) => (
            <InviteRow key={inv.id} invite={inv} onOpenMeeting={openMeeting} onDismiss={() => dismiss(inv.id)} />
          ))}
        </ul>
      )}
    </RoyCard>
  );
}
