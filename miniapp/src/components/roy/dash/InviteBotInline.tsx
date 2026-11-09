"use client";
import { useCallback, useEffect, useState } from "react";
import { useDt } from "../nav";
import { ApiError, createMeetingInvite, fetchMeetingInvite } from "@/lib/api";
import {
  INVITE_POLL_MS,
  type MeetingInvite,
  inviteErrorText,
  inviteStatusLabel,
  isFinalStatus,
  parseInviteErrorCode,
} from "@/lib/meetingInvite";

// «Позвать бота» прямо из строки «Встреч сегодня» (issue #636): ссылка у встречи уже есть из
// календаря, вставлять её руками в InviteBotCard незачем. Тот же POST /meeting-invites и те же
// тексты/статусы (`lib/meetingInvite.ts`), своего протокола здесь нет.
//
// Id приглашения помним по встрече в sessionStorage (как `lib/joinedCalls.ts`): после
// перезагрузки кнопку второй раз не предлагаем, пока приглашение живо. Читаем только после
// монтирования — на сервере storage нет, чтение в рендере разошлось бы с гидрацией. Все
// обращения обёрнуты: в приватном окне storage бросает, и строка встречи падать не вправе.

const PREFIX = "swarm.meetingInvite.byMeeting.";

function loadId(meetingId: string): string | null {
  try {
    return sessionStorage.getItem(PREFIX + meetingId);
  } catch {
    return null;
  }
}

function saveId(meetingId: string, id: string | null): void {
  try {
    if (id) sessionStorage.setItem(PREFIX + meetingId, id);
    else sessionStorage.removeItem(PREFIX + meetingId);
  } catch { /* нет памяти — просто не запомним */ }
}

type Note = { text: string; tone: "info" | "error" };

export function InviteBotInline({ meetingId, joinUrl }: { meetingId: string; joinUrl: string }) {
  const dt = useDt();
  const [invite, setInvite] = useState<MeetingInvite | null>(null);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const keep = useCallback((next: MeetingInvite | null) => {
    setInvite(next);
    // Помним только живое: окончательное после перезагрузки не нужно никому.
    saveId(meetingId, next && !isFinalStatus(next.status) ? next.id : null);
  }, [meetingId]);

  // Восстановление после перезагрузки: приглашение, которое уже закончилось или пропало,
  // молча забываем — кнопка вернётся.
  useEffect(() => {
    const id = loadId(meetingId);
    if (!id) return;
    let alive = true;
    fetchMeetingInvite(id)
      .then((fresh) => { if (alive) keep(fresh.status === "expired" ? null : fresh); })
      .catch((e) => { if (alive && e instanceof ApiError && e.status === 404) keep(null); });
    return () => { alive = false; };
  }, [meetingId, keep]);

  const liveId = invite && !isFinalStatus(invite.status) ? invite.id : null;
  useEffect(() => {
    if (!liveId) return;
    let alive = true;
    const timer = setInterval(() => {
      fetchMeetingInvite(liveId)
        .then((fresh) => { if (alive) keep(fresh); })
        .catch((e) => { if (alive && e instanceof ApiError && e.status === 404) keep(null); });
        // Сеть моргнула — оставляем прежний статус, спросим на следующем круге.
    }, INVITE_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [liveId, keep]);

  const call = async () => {
    if (sending) return;
    setSending(true);
    setNote(null);
    try {
      keep(await createMeetingInvite(joinUrl));
    } catch (e) {
      const code = e instanceof ApiError ? parseInviteErrorCode(e.body) : null;
      // «Коллега уже позвал» — нормальный исход: бот придёт один на всех, это не сбой.
      setNote({ text: inviteErrorText(code, dt), tone: code === "already_invited" ? "info" : "error" });
    } finally {
      setSending(false);
    }
  };

  if (invite) {
    const text = inviteStatusLabel(invite.status, dt);
    return (
      <span role="status" title={text} onClick={(e) => e.stopPropagation()} className="min-w-0 truncate text-ink-mute" style={{ fontSize: 11, maxWidth: 150 }}>
        {text}
      </span>
    );
  }
  return (
    <>
      {note && (
        <span role="alert" title={note.text} className="min-w-0 truncate"
          style={{ fontSize: 11, maxWidth: 150, color: note.tone === "error" ? "var(--pri-high)" : "var(--ink-mute)" }}>
          {note.text}
        </span>
      )}
      <button
        type="button"
        disabled={sending}
        onClick={(e) => { e.stopPropagation(); void call(); }}
        title={dt("Позвать бота записать встречу", "Invite the bot to record this meeting")}
        className="shrink-0 whitespace-nowrap rounded-full px-2 py-1 font-medium text-ink-mute transition-colors hover:text-ink disabled:opacity-50"
        style={{ fontSize: 11.5 }}
      >
        {sending ? dt("Зовём…", "Inviting…") : dt("Позвать бота", "Invite bot")}
      </button>
    </>
  );
}
