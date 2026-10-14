"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ApiError, clearWorkspaceKey, fetchWorkspaceKeyStatus, setWorkspaceKey, type WorkspaceKeyStatus,
} from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";

// «Ключ к нейронке» пространства (#233, этап 3). Ключ write-only: поле только на запись, после
// сохранения очищается и никогда не подставляется; сервер отдаёт лишь статус (last4, даты, ошибка).
// Один компонент и для десктопа (AdminDesk → Воркспейсы), и для мобайла (AdminScreen).

const fieldCls =
  "w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute";
const btnPrimary =
  "rounded-full bg-primary px-3.5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";
const btnGhost =
  "rounded-full border border-line px-3.5 py-2 font-semibold text-ink-soft transition-colors hover:text-ink disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "");

export function WorkspaceKeyPanel({ wsId }: { wsId: string }) {
  const dt = useDt();
  const confirm = useConfirm();
  const [status, setStatus] = useState<WorkspaceKeyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(() => {
    setStatus(null);
    setLoadError(null);
    fetchWorkspaceKeyStatus(wsId).then(setStatus).catch((e) => {
      console.error("[WorkspaceKeyPanel] status", e);
      setLoadError(e instanceof Error ? e.message : dt("Не удалось загрузить", "Could not load"));
    });
  }, [wsId, dt]);
  useEffect(() => { load(); }, [load]);

  // Серверные тексты ключа английские; для человека — на его языке по машинному коду.
  const explain = (e: unknown): string => {
    const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
    if (code === "invalid_format") return dt("Ключ должен начинаться с «sk-» и не содержать пробелов.", 'The key must start with "sk-" and contain no spaces.');
    if (code === "rejected") return dt("OpenAI не принял этот ключ — проверьте его и введите заново.", "OpenAI rejected this key — check it and enter it again.");
    if (code === "unverifiable") return dt("Не удалось проверить ключ у OpenAI, ключ не сохранён. Попробуйте позже.", "Could not verify the key with OpenAI, so it was not saved. Please try again later.");
    return e instanceof Error ? e.message : dt("Ошибка", "Error");
  };

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      setStatus(await setWorkspaceKey(wsId, key));
      setSaved(true);
    } catch (e) {
      console.error("[WorkspaceKeyPanel] save", e);
      setError(explain(e));
    } finally {
      setDraft("");
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({
      title: dt("Убрать ключ пространства?", "Remove the workspace key?"),
      description: dt("Дальше пространство будет работать на общем ключе сервера.", "From then on the workspace uses the shared server key."),
      confirmText: dt("Убрать ключ", "Remove key"),
    }))) return;
    setBusy(true); setError(null); setSaved(false);
    try {
      setStatus(await clearWorkspaceKey(wsId));
    } catch (e) {
      console.error("[WorkspaceKeyPanel] clear", e);
      setError(explain(e));
    } finally {
      setBusy(false);
    }
  };

  const own = status?.source === "workspace";

  return (
    <section className="max-w-[720px] rounded-[10px] border border-line bg-surface px-3 py-3">
      <h3 className="font-semibold text-ink" style={{ fontSize: 14 }}>{dt("Ключ к нейронке", "AI model key")}</h3>
      <p className="mb-3 mt-0.5 text-ink-mute" style={{ fontSize: 12 }}>
        {dt("Ключ OpenAI этого пространства. Хранится зашифрованным и после сохранения не показывается.", "This workspace's OpenAI key. Stored encrypted and never shown after saving.")}
      </p>

      {loadError && (
        <p role="alert" className="mb-2 text-destructive" style={{ fontSize: 12.5 }}>
          {loadError}{" "}
          <button type="button" onClick={load} className="underline">{dt("Повторить", "Retry")}</button>
        </p>
      )}
      {!status && !loadError && <div className="roy-shim mb-2" style={{ height: 34, borderRadius: 8 }} />}
      {status && (
        <div className="mb-3 space-y-1" style={{ fontSize: 13 }}>
          <p className="text-ink">
            {own
              ? dt(`Ключ задан · …${status.last4}`, `Key is set · …${status.last4}`)
              : dt("Ключ не задан — работает общий ключ сервера", "No key set — the shared server key is used")}
          </p>
          {own && status.set_at && (
            <p className="text-ink-mute" style={{ fontSize: 12 }}>{dt("Задан", "Set")}: {fmtDate(status.set_at)}</p>
          )}
          {own && status.last_error && (
            <p role="alert" className="font-semibold text-destructive" style={{ fontSize: 12.5 }}>
              {dt("Ключ отклонён OpenAI — замените", "Key rejected by OpenAI — replace it")}
              {status.last_error_at ? ` · ${fmtDate(status.last_error_at)}` : ""}
            </p>
          )}
        </div>
      )}

      <label className="block">
        <span className="mb-1 block font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>
          {own ? dt("Новый ключ", "New key") : dt("Ключ", "Key")}
        </span>
        <input type="password" autoComplete="off" spellCheck={false} value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
          placeholder="sk-…" className={fieldCls} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={save} disabled={busy || !draft.trim()} className={btnPrimary} style={{ fontSize: 13 }}>
          {busy ? dt("Проверяю…", "Checking…") : dt("Сохранить", "Save")}
        </button>
        {own && (
          <button type="button" onClick={remove} disabled={busy} className={btnGhost} style={{ fontSize: 13 }}>
            {dt("Убрать ключ", "Remove key")}
          </button>
        )}
      </div>
      {error && <p role="alert" className="mt-2 text-destructive" style={{ fontSize: 12.5 }}>{error}</p>}
      {saved && !error && <p role="status" className="mt-2 text-ink-soft" style={{ fontSize: 12.5 }}>{dt("Ключ проверен и сохранён", "Key verified and saved")}</p>}
    </section>
  );
}
