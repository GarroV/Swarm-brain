"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, addMasterAdmin, fetchMasterAdmins, removeMasterAdmin, type MasterAdmin } from "@/lib/api";
import { useDt } from "@/components/roy/nav";
import { useConfirm } from "@/components/ui/confirm";

// «Мастер-админы» (#233, этап 3): кто видит и настраивает все пространства. Только для
// мастер-админа (`me.is_superadmin`) — вкладка в AdminDesk и блок в AdminScreen. Права решает сервер;
// константа в коде в списке есть, но без кнопки «Снять».

const fieldCls =
  "w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute";
const btnPrimary =
  "rounded-full bg-primary px-3.5 py-2 font-semibold text-primary-foreground transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

export function MasterAdminsPanel() {
  const dt = useDt();
  const confirm = useConfirm();
  const [rows, setRows] = useState<MasterAdmin[] | null>(null);
  const [idDraft, setIdDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMasterAdmins().then(setRows).catch((e) => {
      console.error("[MasterAdminsPanel] list", e);
      setError(e instanceof Error ? e.message : dt("Не удалось загрузить", "Could not load"));
      setRows([]);
    });
  }, [dt]);
  useEffect(() => { load(); }, [load]);

  // Серверные тексты русские; для человека — на его языке по машинному коду.
  const explain = (e: unknown): string => {
    const code = e instanceof ApiError ? (e.body as { code?: string } | null)?.code : undefined;
    if (code === "invalid_id") return dt("Telegram ID — положительное число", "Telegram ID must be a positive number");
    if (code === "builtin") return dt("Этого мастер-админа задаёт код, снять его из списка нельзя", "This master admin is set in code and cannot be removed from the list");
    if (code === "last") return dt("Нельзя удалить последнего мастер-админа", "The last master admin cannot be removed");
    if (code === "not_found") return dt("Такого мастер-админа нет", "No such master admin");
    return e instanceof Error ? e.message : dt("Ошибка", "Error");
  };

  const run = async (op: () => Promise<MasterAdmin[]>) => {
    setBusy(true); setError(null);
    try {
      setRows(await op());
      return true;
    } catch (e) {
      console.error("[MasterAdminsPanel] change", e);
      setError(explain(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const id = Number(idDraft.trim());
    if (!Number.isSafeInteger(id) || id <= 0) {
      setError(dt("Telegram ID — положительное число", "Telegram ID must be a positive number"));
      return;
    }
    if (await run(() => addMasterAdmin(id))) setIdDraft("");
  };

  const remove = async (row: MasterAdmin) => {
    if (!(await confirm({
      title: dt("Снять мастер-админа?", "Remove this master admin?"),
      description: dt(`${row.name ?? row.telegram_id} потеряет доступ ко всем пространствам, кроме своего.`, `${row.name ?? row.telegram_id} will lose access to every workspace except their own.`),
      confirmText: dt("Снять", "Remove"),
    }))) return;
    await run(() => removeMasterAdmin(row.telegram_id));
  };

  return (
    <section className="max-w-[720px] rounded-[10px] border border-line bg-surface px-3 py-3">
      <h3 className="font-semibold text-ink" style={{ fontSize: 14 }}>{dt("Мастер-админы", "Master admins")}</h3>
      <p className="mb-3 mt-0.5 text-ink-mute" style={{ fontSize: 12 }}>
        {dt("Видят и настраивают все пространства, включая ключи и этот список.", "See and configure every workspace, including keys and this list.")}
      </p>

      {rows === null && <div className="roy-shim mb-2" style={{ height: 34, borderRadius: 8 }} />}
      <div className="space-y-1.5">
        {(rows ?? []).map((r) => (
          <div key={r.telegram_id} className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-2.5 py-1.5">
            <span className="min-w-0 truncate text-ink" style={{ fontSize: 13 }}>
              {r.name && <span className="mr-2">{r.name}</span>}
              <span className={r.name ? "font-mono text-ink-mute" : "font-mono"}>{r.telegram_id}</span>
              {r.builtin && <span className="ml-2 text-ink-mute" style={{ fontSize: 11.5 }}>{dt("задан в коде", "set in code")}</span>}
            </span>
            {!r.builtin && (
              <button type="button" onClick={() => remove(r)} disabled={busy}
                className="shrink-0 text-ink-soft underline transition-colors hover:text-ink disabled:opacity-60" style={{ fontSize: 12.5 }}>
                {dt("Снять", "Remove")}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <input inputMode="numeric" autoComplete="off" value={idDraft} onChange={(e) => setIdDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
          placeholder={dt("Telegram ID", "Telegram ID")} aria-label="Telegram ID" className={fieldCls} />
        <button type="button" onClick={add} disabled={busy || !idDraft.trim()} className={`${btnPrimary} shrink-0`} style={{ fontSize: 13 }}>
          {dt("Добавить", "Add")}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-destructive" style={{ fontSize: 12.5 }}>{error}</p>}
    </section>
  );
}
