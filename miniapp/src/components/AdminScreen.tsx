"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchAdminWorkspaces, fetchAdminWorkspaceUsers,
  addUserToWorkspace, removeUserFromWorkspace, patchAdminWorkspace,
  createAdminWorkspace, broadcastMessage, patchAdminUser,
  fetchReviewCounts, type ReviewCount,
} from "@/lib/api";
import type { AdminWorkspace, AdminUser } from "@/types";
import { countryCode, COUNTRY_NAMES } from "@/lib/countries";
import { Segmented } from "@/components/roy/ui";
import { RoyIcon } from "@/components/roy/icons";

const fieldCls =
  "w-full rounded-[12px] border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors focus:border-[var(--accent-ink)] placeholder:text-ink-mute";
const btnPrimary =
  "rounded-[12px] bg-primary px-3.5 py-2 font-semibold text-white transition-transform active:scale-[0.97] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]";

function Lbl({ t }: { t: string }) {
  return <span className="mb-1 block font-mono uppercase text-ink-mute" style={{ fontSize: 10, letterSpacing: "0.08em" }}>{t}</span>;
}

// ── Список воркспейсов + создание ─────────────────────────────────────────────
function WorkspaceList({ onSelect }: { onSelect: (ws: AdminWorkspace) => void }) {
  const [workspaces, setWorkspaces] = useState<AdminWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState("");
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminWorkspaces().then(setWorkspaces).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    const id = newId.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    const name = newName.trim();
    if (!id || !name) { setErr("Нужны id (a-z0-9-) и название"); return; }
    setSaving(true); setErr(null);
    try {
      await createAdminWorkspace(id, name);
      setNewId(""); setNewName(""); setCreating(false); load();
    } catch (e) { setErr(e instanceof Error ? e.message : "Не удалось создать"); }
    finally { setSaving(false); }
  };

  if (loading) return <p className="text-center text-ink-soft py-8 text-sm">Загрузка…</p>;

  return (
    <div className="space-y-2">
      {creating ? (
        <div className="space-y-2 rounded-[16px] border border-line bg-surface-2 p-3 dark:backdrop-blur-sm">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Название (напр. LATAM)" className={fieldCls} autoFocus />
          <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="id-слаг (напр. latam)" className={`${fieldCls} font-mono`} />
          {err && <p className="font-semibold" style={{ fontSize: 12, color: "var(--pri-high)" }}>{err}</p>}
          <div className="flex gap-2">
            <button onClick={handleCreate} disabled={saving} className={`${btnPrimary} flex-1`} style={{ fontSize: 13.5 }}>{saving ? "Создаю…" : "Создать"}</button>
            <button onClick={() => { setCreating(false); setErr(null); }} className="rounded-[12px] border border-line bg-surface px-3.5 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface active:scale-[0.97]" style={{ fontSize: 13.5 }}>Отмена</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setCreating(true)} className="flex w-full items-center justify-center gap-1.5 rounded-[16px] border border-dashed border-line-2 px-4 py-2.5 font-semibold text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" style={{ fontSize: 13.5 }}>
          <RoyIcon name="plus" size={15} strokeWidth={2.2} /> Создать воркспейс
        </button>
      )}
      {workspaces.map((ws) => (
        <button
          key={ws.id}
          onClick={() => onSelect(ws)}
          className="flex w-full items-center justify-between rounded-[16px] border border-line bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 active:scale-[0.99] dark:backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        >
          <div className="min-w-0">
            <p className="font-bold text-ink" style={{ fontSize: 15 }}>{ws.name}</p>
            <p className="font-mono text-ink-mute" style={{ fontSize: 11 }}>{ws.id}</p>
          </div>
          <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 font-mono text-ink-soft" style={{ fontSize: 11 }}>{ws.user_count} чел.</span>
        </button>
      ))}
    </div>
  );
}

// ── Пользователи воркспейса ───────────────────────────────────────────────────
function WorkspaceUsers({ wsId, allWorkspaces }: { wsId: string; allWorkspaces: AdminWorkspace[] }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // инлайн-редактор профиля (всё кроме telegram_id и Telegram-@username)
  const [editId, setEditId] = useState<number | null>(null);
  const [editFirst, setEditFirst] = useState("");
  const [editLast, setEditLast] = useState("");
  const [editRole, setEditRole] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editMarkets, setEditMarkets] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const allCodes = Object.keys(COUNTRY_NAMES);

  const load = useCallback(() => {
    setLoading(true);
    fetchAdminWorkspaceUsers(wsId).then(setUsers).finally(() => setLoading(false));
  }, [wsId]);

  useEffect(() => { load(); }, [load]);

  // Принимаем «@username», «username» или числовой Telegram ID — автоопределение.
  const handleAdd = async () => {
    const raw = addInput.trim();
    if (!raw) return;
    const ref = /^\d+$/.test(raw) ? { telegramId: Number(raw) } : { username: raw.replace(/^@/, "") };
    setAdding(true); setErr(null);
    try { await addUserToWorkspace(wsId, ref); setAddInput(""); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Не удалось добавить"); }
    finally { setAdding(false); }
  };

  const handleRemove = async (userId: number) => {
    if (!window.confirm("Удалить пользователя из воркспейса?")) return;
    await removeUserFromWorkspace(wsId, userId);
    load();
  };

  const handleMove = async (userId: number, toWs: string) => {
    if (!toWs || toWs === wsId) return;
    await addUserToWorkspace(toWs, { telegramId: userId }); // upsert реассайнит group_id
    load();
  };

  const startEdit = (u: AdminUser) => {
    setEditId(u.telegram_id);
    setEditFirst(u.first_name ?? "");
    setEditLast(u.last_name ?? "");
    setEditRole(u.role ?? "");
    setEditEmail(u.email ?? "");
    setEditPhone(u.phone ?? "");
    setEditNotes(u.notes ?? "");
    setEditMarkets(u.markets ?? []);
  };
  const toggleMarket = (code: string) => setEditMarkets((p) => p.includes(code) ? p.filter((c) => c !== code) : [...p, code]);
  const saveEdit = async () => {
    if (editId == null) return;
    setSavingEdit(true);
    try {
      await patchAdminUser(editId, {
        first_name: editFirst.trim() || null,
        last_name: editLast.trim() || null,
        role: editRole.trim() || null,
        email: editEmail.trim() || null,
        phone: editPhone.trim() || null,
        notes: editNotes.trim() || null,
        markets: editMarkets,
      });
      setEditId(null); load();
    } finally { setSavingEdit(false); }
  };

  const others = allWorkspaces.filter((w) => w.id !== wsId);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          placeholder="Telegram ID или @username"
          value={addInput}
          onChange={(e) => setAddInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          className={fieldCls}
        />
        <button onClick={handleAdd} disabled={adding || !addInput.trim()} className={btnPrimary} aria-label="Добавить пользователя">
          <RoyIcon name="plus" size={16} strokeWidth={2.2} />
        </button>
      </div>
      {err && <p className="font-semibold" style={{ fontSize: 12.5, color: "var(--pri-high)" }}>{err}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Загрузка…</p>
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <div key={u.telegram_id} className="rounded-[14px] border border-line bg-surface px-3 py-2.5 dark:backdrop-blur-sm">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold text-ink" style={{ fontSize: 13.5 }}>
                    {u.name}
                    {u.is_admin && <span className="rounded-[6px] px-1.5 py-0.5 font-mono uppercase" style={{ fontSize: 9, color: "var(--accent-ink)", background: "var(--accent-soft)" }}>admin</span>}
                  </p>
                  <p className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
                    {u.username ? `@${u.username} · ` : ""}{u.telegram_id}
                  </p>
                  {u.role && <p className="text-ink-soft" style={{ fontSize: 11 }}>{u.role}</p>}
                </div>
                {u.markets.length > 0 && (
                  <span className="shrink-0 text-ink-soft" style={{ fontSize: 11 }}>{u.markets.map(countryCode).join(", ")}</span>
                )}
                <button onClick={() => startEdit(u)} aria-label="Редактировать профиль" className="shrink-0 transition-colors hover:opacity-80 active:scale-[0.92]" style={{ color: "var(--accent-ink)" }}>
                  <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
                </button>
                <button onClick={() => handleRemove(u.telegram_id)} aria-label="Удалить" className="shrink-0 transition-colors hover:opacity-80 active:scale-[0.92]" style={{ color: "var(--pri-high)" }}>
                  <RoyIcon name="trash" size={16} strokeWidth={1.9} />
                </button>
              </div>
              {editId === u.telegram_id ? (
                <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
                  <div className="flex gap-2">
                    <div className="flex-1"><Lbl t="Имя" /><input value={editFirst} onChange={(e) => setEditFirst(e.target.value)} placeholder="Имя" className={fieldCls} /></div>
                    <div className="flex-1"><Lbl t="Фамилия" /><input value={editLast} onChange={(e) => setEditLast(e.target.value)} placeholder="Фамилия" className={fieldCls} /></div>
                  </div>
                  <div>
                    <Lbl t="Роль" />
                    <input value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="напр. BD, Marketing" className={fieldCls} />
                  </div>
                  <div className="flex gap-2">
                    <div className="flex-1"><Lbl t="Email" /><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@…" type="email" className={fieldCls} /></div>
                    <div className="flex-1"><Lbl t="Телефон" /><input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+…" className={fieldCls} /></div>
                  </div>
                  <div>
                    <Lbl t="Рынки" />
                    <div className="flex max-h-[148px] flex-wrap gap-1.5 overflow-y-auto">
                      {allCodes.map((code) => {
                        const on = editMarkets.includes(code);
                        return (
                          <button key={code} onClick={() => toggleMarket(code)} className="rounded-full border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                            style={{ fontSize: 11, ...(on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : { color: "var(--ink-soft)", borderColor: "var(--line-2)" }) }}>
                            {countryCode(code)}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <Lbl t="Заметки" />
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} placeholder="Заметки админа…" className={`${fieldCls} resize-none`} />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={saveEdit} disabled={savingEdit} className={`${btnPrimary} flex-1`} style={{ fontSize: 13 }}>{savingEdit ? "Сохраняю…" : "Сохранить профиль"}</button>
                    <button onClick={() => setEditId(null)} className="rounded-[12px] border border-line bg-surface px-3 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97]" style={{ fontSize: 13 }}>Отмена</button>
                  </div>
                </div>
              ) : others.length > 0 ? (
                <select
                  defaultValue=""
                  onChange={(e) => { handleMove(u.telegram_id, e.target.value); e.currentTarget.value = ""; }}
                  className="mt-2 w-full rounded-[10px] border border-line bg-surface-2 px-2 py-1 text-ink-soft outline-none focus:border-[var(--accent-ink)]"
                  style={{ fontSize: 11.5 }}
                >
                  <option value="">↪ Переместить в…</option>
                  {others.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Рынки воркспейса ──────────────────────────────────────────────────────────
function WorkspaceMarkets({ ws, onUpdated }: { ws: AdminWorkspace; onUpdated: () => void }) {
  const allCodes = Object.keys(COUNTRY_NAMES);
  const [selected, setSelected] = useState<string[] | null>(ws.allowed_markets);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const isCustom = selected !== null;

  const toggle = (code: string) => {
    if (!isCustom) return;
    setSelected((prev) =>
      (prev ?? allCodes).includes(code) ? (prev ?? allCodes).filter((c) => c !== code) : [...(prev ?? allCodes), code]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await patchAdminWorkspace(ws.id, { allowed_markets: selected });
      setSaved(true); onUpdated();
      setTimeout(() => setSaved(false), 2000);
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-3">
      <Segmented
        items={[{ id: "global", label: "Глобальный список" }, { id: "custom", label: "Свой список" }]}
        value={isCustom ? "custom" : "global"}
        onChange={(v) => setSelected(v === "custom" ? (ws.allowed_markets ?? allCodes) : null)}
      />

      {isCustom ? (
        <div className="flex flex-wrap gap-1.5">
          {allCodes.map((code) => {
            const on = selected!.includes(code);
            return (
              <button
                key={code}
                onClick={() => toggle(code)}
                className="rounded-full border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                style={{ fontSize: 11.5, ...(on
                  ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" }
                  : { color: "var(--ink-soft)", borderColor: "var(--line-2)" }) }}
              >
                {countryCode(code)}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-ink-soft">Пользователи видят все рынки из глобального списка.</p>
      )}

      <button onClick={handleSave} disabled={saving} className={`${btnPrimary} w-full`} style={{ fontSize: 14 }}>
        {saving ? "Сохраняю…" : saved ? "✓ Сохранено" : "Сохранить"}
      </button>
    </div>
  );
}

// ── Деталь воркспейса (переименование + табы) ─────────────────────────────────
function WorkspaceDetail({ ws, onBack }: { ws: AdminWorkspace; onBack: () => void }) {
  const [workspace, setWorkspace] = useState(ws);
  const [tab, setTab] = useState<"users" | "markets">("users");
  const [allWorkspaces, setAllWorkspaces] = useState<AdminWorkspace[]>([]);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(ws.name);

  useEffect(() => { fetchAdminWorkspaces().then(setAllWorkspaces).catch(() => {}); }, []);

  const saveName = async () => {
    const n = nameDraft.trim();
    if (!n || n === workspace.name) { setRenaming(false); return; }
    const updated = await patchAdminWorkspace(workspace.id, { name: n });
    setWorkspace((w) => ({ ...w, name: updated?.name ?? n }));
    setRenaming(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-5 pb-3">
        <button onClick={onBack} aria-label="Назад" className="text-ink-soft transition-colors hover:text-ink">
          <RoyIcon name="cleft" size={20} strokeWidth={2.2} />
        </button>
        {renaming ? (
          <input
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") saveName(); if (e.key === "Escape") setRenaming(false); }}
            autoFocus
            className={`${fieldCls} flex-1 font-bold`}
            style={{ fontSize: 18 }}
          />
        ) : (
          <>
            <h1 className="font-bold text-ink" style={{ fontSize: 20, letterSpacing: "-0.01em" }}>{workspace.name}</h1>
            <button onClick={() => { setNameDraft(workspace.name); setRenaming(true); }} aria-label="Переименовать" className="transition-colors hover:opacity-80" style={{ color: "var(--accent-ink)" }}>
              <RoyIcon name="pencil" size={16} strokeWidth={1.9} />
            </button>
          </>
        )}
        <span className="ml-auto font-mono text-ink-mute" style={{ fontSize: 11 }}>{workspace.id}</span>
      </div>

      <div className="px-4">
        <Segmented
          items={[{ id: "users", label: "Пользователи" }, { id: "markets", label: "Рынки" }]}
          value={tab}
          onChange={(v) => setTab(v as "users" | "markets")}
        />
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {tab === "users"
          ? <WorkspaceUsers wsId={workspace.id} allWorkspaces={allWorkspaces} />
          : <WorkspaceMarkets ws={workspace} onUpdated={() => setWorkspace((w) => ({ ...w }))} />}
      </div>
    </div>
  );
}

// ── Рассылка всем пользователям ───────────────────────────────────────────────
function BroadcastBlock() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    if (typeof window !== "undefined" && !window.confirm(`Отправить сообщение ВСЕМ пользователям системы в Telegram?\n\n«${t.slice(0, 140)}${t.length > 140 ? "…" : ""}»`)) return;
    setSending(true); setResult(null);
    try {
      const r = await broadcastMessage(t);
      setResult(`✓ Отправлено: ${r.sent}${r.failed ? ` · не доставлено: ${r.failed}` : ""} (из ${r.total})`);
      setText("");
    } catch (e) { setResult(e instanceof Error ? e.message : "Ошибка рассылки"); }
    finally { setSending(false); }
  };

  return (
    <div className="rounded-[16px] border border-line bg-surface px-3 py-2.5 dark:backdrop-blur-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" style={{ fontSize: 13.5 }}>
        <span className="flex items-center gap-2"><RoyIcon name="note" size={15} className="text-ink-soft" /> Рассылка всем</span>
        <RoyIcon name="cright" size={14} className={`text-ink-soft transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2.5 space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Сообщение всем пользователям системы…" className={`${fieldCls} resize-none`} />
          <button onClick={send} disabled={sending || !text.trim()} className={`${btnPrimary} w-full`} style={{ fontSize: 13.5 }}>{sending ? "Отправляю…" : "Отправить всем"}</button>
          {result && <p className="font-mono text-ink-soft" style={{ fontSize: 11.5 }}>{result}</p>}
        </div>
      )}
    </div>
  );
}

// Сводка «на вычитке по участникам» — приглядеть, у кого копится бэклог встреч, БЕЗ доступа
// к чужому контенту (только имя + число). Свёрнута по умолчанию.
function ReviewQueueBlock() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReviewCount[] | null>(null);

  useEffect(() => {
    if (!open || rows !== null) return;
    fetchReviewCounts().then(setRows).catch(() => setRows([]));
  }, [open, rows]);

  const total = (rows ?? []).reduce((n, r) => n + r.count, 0);

  return (
    <div className="rounded-[16px] border border-line bg-surface px-3 py-2.5 dark:backdrop-blur-sm">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between font-semibold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]" style={{ fontSize: 13.5 }}>
        <span className="flex items-center gap-2"><RoyIcon name="cal" size={15} className="text-ink-soft" /> На вычитке по участникам{rows && total > 0 ? ` · ${total}` : ""}</span>
        <RoyIcon name="cright" size={14} className={`text-ink-soft transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2.5 space-y-1.5">
          {rows === null && <p className="text-ink-mute" style={{ fontSize: 12 }}>Загрузка…</p>}
          {rows !== null && rows.length === 0 && <p className="text-ink-mute" style={{ fontSize: 12 }}>Ни у кого нет встреч на вычитке.</p>}
          {(rows ?? []).map((r) => (
            <div key={r.telegram_id} className="flex items-center justify-between rounded-[10px] bg-surface-2 px-2.5 py-1.5">
              <span className="truncate text-ink" style={{ fontSize: 13 }}>{r.name}</span>
              <span className="shrink-0 font-mono font-semibold text-accent-ink" style={{ fontSize: 12.5 }}>{r.count}</span>
            </div>
          ))}
          <p className="text-ink-mute" style={{ fontSize: 11 }}>Только число — сами встречи приватны их владельцу.</p>
        </div>
      )}
    </div>
  );
}

export function AdminScreen() {
  const [selected, setSelected] = useState<AdminWorkspace | null>(null);

  if (selected) return <WorkspaceDetail ws={selected} onBack={() => setSelected(null)} />;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="px-4 pt-5 pb-3">
        <h1 className="font-bold text-ink" style={{ fontSize: 24, letterSpacing: "-0.02em" }}>Суперадмин</h1>
        <p className="font-mono uppercase text-ink-mute" style={{ fontSize: 10.5, letterSpacing: "0.08em", marginTop: 2 }}>Воркспейсы · рынки · доступы · вычитка · рассылка</p>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <ReviewQueueBlock />
        <BroadcastBlock />
        <WorkspaceList onSelect={setSelected} />
      </div>
    </div>
  );
}
