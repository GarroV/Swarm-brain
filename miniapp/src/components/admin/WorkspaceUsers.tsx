"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchAdminWorkspaceUsers, addUserToWorkspace, removeUserFromWorkspace, patchAdminUser, setWorkspaceAdmin,
} from "@/lib/api";
import type { AdminWorkspace, AdminUser } from "@/types";
import { countryCode, COUNTRY_NAMES } from "@/lib/countries";
import { RoyIcon } from "@/components/roy/icons";
import { useDt, useRoyNav } from "@/components/roy/nav";
import { canSetWorkspaceAdmin } from "@/lib/adminAccess";
import { useConfirm } from "@/components/ui/confirm";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { btnPrimary, fieldCls, Lbl } from "@/components/admin/ui";
import { MoveMemberDialog } from "@/components/admin/MoveMemberDialog";

// Чем адресуется строка в админских маршрутах: реальный юзер — telegram_id, ОЖИДАЮЩЕЕ
// приглашение (telegram_id=null) — username, а email-only приглашение — сам email.
// Бэкенд различает три формы сам (_shared/users/user-ref.ts).
const USER_COLS = "minmax(0,1.3fr) minmax(80px,0.6fr) minmax(70px,0.6fr) minmax(0,1fr) 300px";

function userRef(u: AdminUser): string {
  return u.telegram_id != null ? String(u.telegram_id) : (u.username ?? u.email ?? "");
}

// ── Люди пространства ───────────────────────────────────────────────────
// desk — таблица по стенду (screens-system.js → screenAdmin): Пользователь · Роль · Рынок · Почта ·
// Действия; форма правки раскрывается под строкой. Без desk — карточки (мобайл).
export function WorkspaceUsers({ wsId, allWorkspaces, desk = false }: { wsId: string; allWorkspaces: AdminWorkspace[]; desk?: boolean }) {
  const confirm = useConfirm();
  const dt = useDt();
  const isMaster = canSetWorkspaceAdmin(useRoyNav().me);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [addInput, setAddInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // инлайн-редактор профиля (всё кроме telegram_id и Telegram-@username).
  // Ключ — userRef(u), а не telegram_id: у ОЖИДАЮЩЕГО приглашения его ещё нет.
  const [editKey, setEditKey] = useState<string | null>(null);
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

  // Принимаем e-mail (веб-вход через Google, без Telegram), «@username», «username» или числовой
  // Telegram ID — автоопределение. Порядок: цифры → telegram_id; похоже на email → email; иначе username.
  const handleAdd = async () => {
    const raw = addInput.trim();
    if (!raw) return;
    const ref = /^-?\d+$/.test(raw) ? { telegramId: Number(raw) }
      : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw) ? { email: raw.toLowerCase() }
      : { username: raw.replace(/^@/, "") };
    setAdding(true); setErr(null);
    try { await addUserToWorkspace(wsId, ref); setAddInput(""); load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Не удалось добавить"); }
    finally { setAdding(false); }
  };

  // Реальный юзер удаляется по telegram_id; ожидающий (pending) — по username, а email-only
  // приглашение (без username) — по email (бэкенд сам различает по формату).
  const handleRemove = async (u: AdminUser) => {
    if (!(await confirm({ title: dt("Убрать человека из пространства?", "Remove the person from the space?"), description: dt("Человек потеряет доступ к этому пространству. Его можно будет добавить снова.", "The person loses access to this space. You can add them again."), confirmText: dt("Убрать", "Remove") }))) return;
    await removeUserFromWorkspace(wsId, userRef(u));
    load();
  };

  // Назначить/снять админа пространства — только мастер-админ; сервер проверяет сам (403 остальным).
  const handleAdminRole = async (u: AdminUser) => {
    if (u.telegram_id == null) return;
    const next = !u.is_admin;
    if (!(await confirm({
      title: next ? dt("Сделать админом пространства?", "Make a workspace admin?") : dt("Снять права админа?", "Remove admin rights?"),
      description: next
        ? dt("Админ сможет в этом пространстве добавлять людей, менять настройки и заводить ключ к нейронке.", "An admin can add people, change settings and set the AI key in this workspace.")
        : dt("Человек останется в пространстве, но управлять им больше не сможет.", "The person stays in the workspace but can no longer manage it."),
      confirmText: next ? dt("Сделать админом", "Make admin") : dt("Снять права", "Remove rights"),
    }))) return;
    try {
      await setWorkspaceAdmin(wsId, u.telegram_id, next);
    } catch (e) {
      console.error("[WorkspaceUsers] admin role", e);
      setErr(e instanceof Error ? e.message : dt("Не удалось сохранить", "Could not save"));
    }
    load();
  };

  // «Перенести в…» — только мастер-админ и только с предпросмотром (MoveMemberDialog): перенос тянет
  // за человеком его данные, поэтому простого «сменить пространство» здесь нет.
  const [moveTo, setMoveTo] = useState<{ user: AdminUser; to: AdminWorkspace } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pickMove = (u: AdminUser, toId: string) => {
    const to = allWorkspaces.find((w) => w.id === toId);
    if (to && u.telegram_id != null) { setNotice(null); setMoveTo({ user: u, to }); }
  };

  const startEdit = (u: AdminUser) => {
    setEditKey(userRef(u));
    setEditFirst(u.first_name ?? "");
    setEditLast(u.last_name ?? "");
    setEditRole(u.role ?? "");
    setEditEmail(u.email ?? "");
    setEditPhone(u.phone ?? "");
    setEditNotes(u.notes ?? "");
    setEditMarkets(u.markets ?? []);
  };
  const toggleMarket = (code: string) => setEditMarkets((p) => p.includes(code) ? p.filter((c) => c !== code) : [...p, code]);
  // У ожидающего приглашения профиля ещё нет (user_profiles ссылается на telegram_id) — ему
  // отправляем ТОЛЬКО email, иначе бэкенд честно ответит 400.
  const saveEdit = async (u: AdminUser) => {
    if (editKey == null) return;
    setSavingEdit(true); setErr(null);
    try {
      await patchAdminUser(
        editKey,
        u.pending
          ? { email: editEmail.trim() || null }
          : {
              first_name: editFirst.trim() || null,
              last_name: editLast.trim() || null,
              role: editRole.trim() || null,
              email: editEmail.trim() || null,
              phone: editPhone.trim() || null,
              notes: editNotes.trim() || null,
              markets: editMarkets,
            },
      );
      setEditKey(null); load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : dt("Не удалось сохранить", "Could not save"));
    } finally { setSavingEdit(false); }
  };

  const others = isMaster ? allWorkspaces.filter((w) => w.id !== wsId) : [];

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          placeholder="E-mail, @username или Telegram ID"
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
      {notice && <p className="font-semibold" role="status" style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>{notice}</p>}

      {loading ? (
        <p className="text-sm text-ink-soft">Загрузка…</p>
      ) : (
        <div className={desk ? "overflow-hidden rounded-[10px] border border-line bg-surface" : "space-y-2"}>
          {desk && (
            <div className="grid items-center gap-2 border-b border-line bg-surface-2 px-3 font-semibold uppercase text-ink-soft"
              style={{ gridTemplateColumns: USER_COLS, height: 32, fontSize: 10.5, letterSpacing: "0.07em" }}>
              <span>{dt("Пользователь", "User")}</span><span>{dt("Роль", "Role")}</span><span>{dt("Рынок", "Market")}</span>
              <span>{dt("Почта", "Email")}</span><span className="text-right">{dt("Действия", "Actions")}</span>
            </div>
          )}
          {users.map((u) => (
            <div key={u.telegram_id ?? u.username ?? u.id} className={desk ? "border-b border-line px-3 py-1.5 last:border-b-0" : "rounded-[10px] border border-line bg-surface px-3 py-2.5"}>
              {desk ? (
                <div className="grid items-center gap-2" style={{ gridTemplateColumns: USER_COLS, minHeight: 34, fontSize: 13 }}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 truncate font-medium text-ink">
                      {u.name}
                      {u.is_admin && <span className="rounded-[6px] px-1.5 py-0.5 font-mono uppercase" style={{ fontSize: 9, color: "var(--accent-ink)", background: "var(--accent-soft)" }}>admin</span>}
                      {u.pending && <span className="rounded-[6px] px-1.5 py-0.5 font-semibold" style={{ fontSize: 9, color: "var(--status-open)", background: "color-mix(in srgb, var(--status-open) 12%, transparent)" }}>{dt("ждёт входа", "awaiting sign-in")}</span>}
                    </p>
                    <p className="truncate font-mono text-ink-mute" style={{ fontSize: 11 }}>
                      {[u.username ? `@${u.username}` : null, u.telegram_id != null ? String(u.telegram_id) : null].filter(Boolean).join(" · ") || "?"}
                    </p>
                  </div>
                  <span className="truncate text-ink-soft">{u.role || <span className="text-ink-mute">—</span>}</span>
                  <span className="truncate font-mono text-ink-soft" style={{ fontSize: 12 }}>{u.markets.length ? u.markets.map(countryCode).join(" ") : <span className="text-ink-mute">—</span>}</span>
                  <span className="truncate text-ink-soft">{u.email || <span className="text-ink-mute">{dt("не привязана", "not linked")}</span>}</span>
                  <div className="flex items-center justify-end gap-1.5">
                    {!u.pending && others.length > 0 && (
                      <MoveSelect
                        others={others}
                        onPick={(id) => pickMove(u, id)}
                        label={dt("↪ Перенести в…", "↪ Move to…")}
                        ariaLabel={dt("Перенести в другое пространство", "Move to another space")}
                        className="h-[28px] max-w-[150px] rounded-[7px] border border-line-2 bg-surface px-1.5 text-ink-soft outline-none focus:border-primary"
                        fontSize={12}
                      />
                    )}
                    <button type="button" onClick={() => (editKey === userRef(u) ? setEditKey(null) : startEdit(u))}
                      className={`h-[28px] rounded-full border px-2.5 font-medium transition-colors ${u.email ? "border-line-2 bg-surface text-ink hover:bg-surface-2" : "border-[var(--pri-med)] text-[var(--pri-med)] hover:bg-surface-2"}`}
                      style={{ fontSize: 12 }}>
                      {u.pending || !u.email ? dt("Привязать почту", "Link email") : dt("Профиль", "Profile")}
                    </button>
                    <button type="button" onClick={() => handleRemove(u)} aria-label={dt("Удалить", "Remove")}
                      className="inline-flex size-[28px] items-center justify-center rounded-full text-[var(--pri-high)] transition-colors hover:bg-surface-2">
                      <RoyIcon name="trash" size={15} strokeWidth={1.9} />
                    </button>
                  </div>
                </div>
              ) : (
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold text-ink" style={{ fontSize: 13.5 }}>
                    {u.name}
                    {u.is_admin && <span className="rounded-[6px] px-1.5 py-0.5 font-mono uppercase" style={{ fontSize: 9, color: "var(--accent-ink)", background: "var(--accent-soft)" }}>admin</span>}
                    {u.pending && <span className="rounded-[6px] px-1.5 py-0.5 font-semibold" style={{ fontSize: 9, color: "var(--status-open)", background: "color-mix(in srgb, var(--status-open) 12%, transparent)" }}>ждёт входа</span>}
                  </p>
                  <p className="font-mono text-ink-mute" style={{ fontSize: 11 }}>
                    {u.username ? `@${u.username}` : ""}{u.telegram_id != null ? `${u.username ? " · " : ""}${u.telegram_id}` : (u.username ? "" : "?")}
                  </p>
                  {u.email && <p className="truncate text-ink-soft" style={{ fontSize: 11 }}>{u.email}</p>}
                  {u.role && <p className="text-ink-soft" style={{ fontSize: 11 }}>{u.role}</p>}
                </div>
                {u.markets.length > 0 && (
                  <span className="shrink-0 text-ink-soft" style={{ fontSize: 11 }}>{u.markets.map(countryCode).join(", ")}</span>
                )}
                <button onClick={() => startEdit(u)} aria-label={u.pending ? dt("Привязать email", "Link email") : dt("Редактировать профиль", "Edit profile")} className="shrink-0 transition-colors hover:opacity-80 active:scale-[0.92]" style={{ color: "var(--accent-ink)" }}>
                  <RoyIcon name="pencil" size={15} strokeWidth={1.9} />
                </button>
                <button onClick={() => handleRemove(u)} aria-label="Удалить" className="shrink-0 transition-colors hover:opacity-80 active:scale-[0.92]" style={{ color: "var(--pri-high)" }}>
                  <RoyIcon name="trash" size={16} strokeWidth={1.9} />
                </button>
              </div>
              )}
              {editKey === userRef(u) ? (
                <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
                  {!u.pending && (
                    <>
                      <div className="flex gap-2">
                        <div className="flex-1"><Lbl t="Имя" /><input value={editFirst} onChange={(e) => setEditFirst(e.target.value)} placeholder="Имя" className={fieldCls} /></div>
                        <div className="flex-1"><Lbl t="Фамилия" /><input value={editLast} onChange={(e) => setEditLast(e.target.value)} placeholder="Фамилия" className={fieldCls} /></div>
                      </div>
                      <div>
                        <Lbl t="Роль" />
                        <input value={editRole} onChange={(e) => setEditRole(e.target.value)} placeholder="напр. BD, Marketing" className={fieldCls} />
                      </div>
                    </>
                  )}
                  {u.pending ? (
                    <div>
                      <Lbl t={dt("Email (вход в веб через Google)", "Email (web sign-in via Google)")} />
                      <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@dodobrands.io" type="email" autoFocus className={fieldCls} />
                      <p className="mt-1 text-ink-mute" style={{ fontSize: 10.5 }}>{dt("Имя, роль и рынки появятся после первого входа.", "Name, role and markets appear after the first sign-in.")}</p>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <div className="flex-1"><Lbl t="Email" /><input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email@…" type="email" className={fieldCls} /></div>
                      <div className="flex-1"><Lbl t="Телефон" /><input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+…" className={fieldCls} /></div>
                    </div>
                  )}
                  {!u.pending && (
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
                  )}
                  {!u.pending && (
                  <div>
                    <Lbl t="Заметки" />
                    <textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} rows={2} placeholder="Заметки админа…" className={`${fieldCls} resize-none`} />
                  </div>
                  )}
                  {isMaster && !u.pending && u.telegram_id != null && (
                    <div className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-2 px-2.5 py-1.5">
                      <span className="text-ink-soft" style={{ fontSize: 12 }}>
                        {u.is_admin ? dt("Админ пространства", "Workspace admin") : dt("Участник", "Member")}
                      </span>
                      <button type="button" onClick={() => handleAdminRole(u)} className="font-semibold underline" style={{ fontSize: 12.5, color: "var(--accent-ink)" }}>
                        {u.is_admin ? dt("Снять права админа", "Remove admin rights") : dt("Сделать админом", "Make admin")}
                      </button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(u)} disabled={savingEdit} className={`${btnPrimary} flex-1`} style={{ fontSize: 13 }}>{savingEdit ? dt("Сохраняю…", "Saving…") : u.pending ? dt("Привязать email", "Link email") : dt("Сохранить профиль", "Save profile")}</button>
                    <button onClick={() => setEditKey(null)} className="rounded-full border border-line bg-surface px-3 py-2 font-semibold text-ink-soft transition-colors hover:bg-surface-2 active:scale-[0.97]" style={{ fontSize: 13 }}>Отмена</button>
                  </div>
                </div>
              ) : !desk && !u.pending && others.length > 0 ? (
                <MoveSelect
                  others={others}
                  onPick={(id) => pickMove(u, id)}
                  label={dt("↪ Перенести в…", "↪ Move to…")}
                  ariaLabel={dt("Перенести в другое пространство", "Move to another space")}
                  className="mt-2 w-full rounded-[10px] border border-line bg-surface-2 px-2 py-1 text-ink-soft outline-none focus:border-[var(--accent-ink)]"
                  fontSize={11.5}
                />
              ) : null}
            </div>
          ))}
        </div>
      )}
      {moveTo && (
        <MoveMemberDialog
          person={moveTo.user}
          to={moveTo.to}
          onClose={() => setMoveTo(null)}
          onMoved={(name, toName) => {
            setMoveTo(null);
            setNotice(dt(`${name} перенесён(а) в пространство «${toName}»`, `${name} was moved to the “${toName}” space`));
            load();
          }}
        />
      )}
    </div>
  );
}

/** «Перенести в другое пространство» — действие, а не поле: значение не держим, после выбора меню
 *  снова показывает подпись. Своё меню вместо нативного <select> — macOS раскрывал тот системным
 *  поверх интерфейса (#300). */
function MoveSelect({ others, onPick, label, ariaLabel, className, fontSize }: {
  others: AdminWorkspace[];
  onPick: (workspaceId: string) => void;
  label: string;
  ariaLabel: string;
  className: string;
  fontSize: number;
}) {
  return (
    <Select value={null} onValueChange={(v) => { if (typeof v === "string" && v) onPick(v); }}>
      <SelectTrigger aria-label={ariaLabel} className={className} style={{ fontSize }}>
        <span className="truncate">{label}</span>
      </SelectTrigger>
      <SelectContent>
        {others.map((w) => <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
