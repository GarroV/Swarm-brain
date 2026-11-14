"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, fetchMovePreview, moveMember, type MovePreview } from "@/lib/api";
import { bodyCode, conflictText, isFinalMoveError, moveErrorKey, parseFreshCounts } from "@/lib/moveMessages";
import type { AdminUser, AdminWorkspace } from "@/types";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { btnGhost, btnPrimary } from "@/components/admin/ui";
import { useSpacesText } from "@/components/admin/spacesText";

// «Перенести в…» (мастер-админ): предпросмотр обычными словами → подтверждение. Перенос тянет за
// человеком его данные, поэтому кнопка не жмётся вслепую: что переезжает, что станет видно там,
// что остаётся и почему. Контракт сервера — api.ts (MovePreview); сервер сам решает, можно ли
// (`can_execute`), экран только показывает причину. Счётчики показанного предпросмотра уходят в
// запрос как `expected`: данные успели измениться — сервер отвечает 409 `expected_mismatch` со свежими
// числами, экран подставляет их в предпросмотр и просит подтвердить ещё раз. Остальные отказы
// приходят машинным кодом (`{error, code}`) и переводятся здесь (moveMessages.ts).

type Phase = "loading" | "ready" | "failed";

/** Строки, которые сервер считает перемещением «прочих данных»; остальное в `counts.other` — правки связей и то, что остаётся. */
const OTHER_MOVING = [
  "task_history", "task_files", "project_history", "meeting_versions", "meeting_live_notes",
  "meeting_audio_backups", "presence", "short_links", "mcp_oauth_connections",
];

export function MoveMemberDialog({ person, to, onClose, onMoved }: {
  person: AdminUser;
  to: AdminWorkspace;
  onClose: () => void;
  onMoved: (personName: string, toName: string) => void;
}) {
  const t = useSpacesText();
  const [phase, setPhase] = useState<Phase>("loading");
  const [preview, setPreview] = useState<MovePreview | null>(null);
  const [running, setRunning] = useState(false);
  const [changed, setChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failedText, setFailedText] = useState<string | null>(null);
  const memberRef = useMemo(() => person.id != null ? String(person.id) : person.telegram_id, [person.id, person.telegram_id]);

  const load = useCallback(() => {
    setPhase("loading"); setChanged(false); setError(null); setFailedText(null);
    if (memberRef === null) { setPhase("failed"); return; }
    fetchMovePreview(memberRef, to.id)
      .then((p) => { setPreview(p); setPhase("ready"); })
      .catch((e) => {
        console.error("[MoveMemberDialog] preview", e);
        const code = e instanceof ApiError ? bodyCode(e.body) : undefined;
        // Причина в самом запросе (уже там, нет пространства…) — повтор не поможет, говорим причину.
        setFailedText(isFinalMoveError(code) ? t(moveErrorKey(code, "movePreviewFailed")) : null);
        setPhase("failed");
      });
  }, [memberRef, to.id, t]);
  useEffect(() => { load(); }, [load]);

  const run = async () => {
    if (!preview || running || memberRef === null) return;
    setRunning(true); setError(null);
    try {
      await moveMember(memberRef, to.id, { tasks: preview.counts.tasks, entries: preview.counts.entries });
      onMoved(preview.person.name || person.name, to.name);
    } catch (e) {
      console.error("[MoveMemberDialog] move", e);
      const code = e instanceof ApiError ? bodyCode(e.body) : undefined;
      const fresh = e instanceof ApiError ? parseFreshCounts(e.body) : null;
      if (code === "expected_mismatch" && fresh) {
        setPreview((p) => (p ? { ...p, counts: { ...p.counts, ...fresh } as MovePreview["counts"] } : p));
        setChanged(true);
      } else if (code === "conflicts" && e instanceof ApiError) {
        const list = (e.body as { conflicts?: unknown }).conflicts;
        setPreview((p) => (p ? { ...p, conflicts: Array.isArray(list) ? list.map(String) : p.conflicts, can_execute: false } : p));
      } else setError(t(moveErrorKey(code, "moveFailed")));
    } finally { setRunning(false); }
  };

  const blocked = !!preview && !preview.can_execute;
  const personName = preview?.person.name || person.name;
  return (
    <Dialog open onOpenChange={(open) => { if (!open && !running) onClose(); }}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>{t("moveTitle", { name: person.name, to: to.name })}</DialogTitle>
        </DialogHeader>
        {phase === "loading" && <div className="roy-shim" style={{ height: 120, borderRadius: 10 }} />}
        {phase === "failed" && (
          <div className="space-y-2">
            <p className="text-ink-soft" style={{ fontSize: 13 }}>{failedText ?? t("movePreviewFailed")}</p>
            {!failedText && <button type="button" onClick={load} className={btnGhost} style={{ fontSize: 12.5 }}>{t("refreshPreview")}</button>}
          </div>
        )}
        {phase === "ready" && preview && <PreviewBody p={preview} name={personName} isAdmin={person.is_admin} />}
        {blocked && <p className="font-semibold" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>{t("moveBlocked")}</p>}
        {changed && <p role="alert" className="font-semibold" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>{t("moveChanged")}</p>}
        {error && <p role="alert" className="font-semibold" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>{error}</p>}
        <DialogFooter>
          <button type="button" onClick={onClose} disabled={running} className={btnGhost} style={{ fontSize: 13 }}>{t("cancel")}</button>
          <button type="button" onClick={run} disabled={phase !== "ready" || blocked || running}
            title={blocked ? t("moveBlocked") : undefined}
            className={btnPrimary} style={{ fontSize: 13 }}>
            {running ? t("moving") : t("moveConfirm", { to: to.name })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 font-semibold text-ink" style={{ fontSize: 12.5 }}>{title}</h4>
      {children}
    </section>
  );
}

function Items({ items }: { items: string[] }) {
  return <ul className="list-disc space-y-0.5 pl-4 text-ink-soft" style={{ fontSize: 12.5 }}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

function PreviewBody({ p, name, isAdmin }: { p: MovePreview; name: string; isAdmin: boolean }) {
  const t = useSpacesText();
  const c = p.counts;
  const otherTotal = OTHER_MOVING.reduce((n, k) => n + (c.other?.[k] ?? 0), 0);
  const moves = ([
    [c.personal_notes, "mvPersonalNotes"], [c.private_entries, "mvPrivateEntries"], [c.entries, "mvEntries"],
    [c.drafts, "mvDrafts"], [c.tasks, "mvTasks"], [c.projects, "mvProjects"], [c.notifications, "mvNotifications"], [c.labels, "mvLabels"], [otherTotal, "mvOther"],
  ] as const).filter(([n]) => n > 0).map(([n, key]) => t(key, { n }));
  const tokens = ([
    [p.tokens.claude, t("tokClaude")], [p.tokens.chatgpt, t("tokChatgpt")],
    [p.tokens.oauth > 0, t("tokOauth", { n: p.tokens.oauth })], [p.tokens.recorder, t("tokRecorder")],
  ] as const).filter(([on]) => on).map(([, label]) => label);
  const stays = isAdmin ? [t("stayAdmin")] : [];

  return (
    <div className="space-y-3">
      <p className="text-ink-soft" style={{ fontSize: 12.5 }}>{t("moveLead", { name, from: p.from.name, to: p.to.name })}</p>
      {p.conflicts.length > 0 && (
        <Section title={t("secConflicts")}>
          <ul className="list-disc space-y-0.5 pl-4" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>
            {p.conflicts.map((x, i) => <li key={i}>{conflictText(t, x)}</li>)}
          </ul>
        </Section>
      )}
      <Section title={t("secMoves", { to: p.to.name })}>
        {moves.length ? <Items items={moves} /> : <p className="text-ink-mute" style={{ fontSize: 12.5 }}>{t("nothing")}</p>}
        {p.projects.length > 0 && <p className="mt-0.5 text-ink-mute" style={{ fontSize: 12 }}>{p.projects.map((x) => x.name).join(", ")}</p>}
      </Section>
      {c.meetings_shared > 0 && (
        <Section title={t("secVisible", { to: p.to.name })}>
          <Items items={[t("visMeetings", { n: c.meetings_shared, to: p.to.name })]} />
        </Section>
      )}
      {stays.length > 0 && (
        <Section title={t("secStays", { from: p.from.name })}>
          <Items items={stays} />
        </Section>
      )}
      {(p.tasks_mixed.length > 0 || p.tasks_detached.length > 0) && (
        <Section title={t("secCheck")}>
          {p.tasks_detached.length > 0 && (
            <div>
              <p className="text-ink-soft" style={{ fontSize: 12.5 }}>{t("detachedLead", { n: p.tasks_detached.length, from: p.from.name })}</p>
              <Items items={p.tasks_detached.map((x) => x.title)} />
            </div>
          )}
          {p.tasks_mixed.length > 0 && (
            <div className={p.tasks_detached.length > 0 ? "mt-1.5" : ""}>
              <p className="text-ink-soft" style={{ fontSize: 12.5 }}>{t("mixedLead", { n: p.tasks_mixed.length, from: p.from.name })}</p>
              <Items items={p.tasks_mixed.map((x) => x.title)} />
            </div>
          )}
        </Section>
      )}
      {tokens.length > 0 && (
        <Section title={t("secTokens")}>
          <p className="text-ink-soft" style={{ fontSize: 12.5 }}>{t("tokensLead", { list: tokens.join(", ") })}</p>
        </Section>
      )}
    </div>
  );
}
