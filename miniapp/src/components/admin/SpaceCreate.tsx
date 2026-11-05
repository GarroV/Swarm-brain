"use client";
import { useState } from "react";
import { ApiError, createAdminWorkspace } from "@/lib/api";
import type { AdminWorkspace } from "@/types";
import { countryCode, COUNTRY_NAMES } from "@/lib/countries";
import { RoyIcon } from "@/components/roy/icons";
import { btnGhost, btnPrimary, fieldCls, Lbl } from "@/components/admin/ui";
import { type SpacesKey, useSpacesText } from "@/components/admin/spacesText";

// Создание пространства (мастер-админ): вводится только название. Слаг сервер выдаёт сам и
// наружу не показывает; страны и админы — по желанию, можно настроить и позже.
const NAME_MAX = 60;
const ERROR_BY_CODE: Record<string, SpacesKey> = {
  name_required: "errNameRequired",
  name_too_long: "errNameTooLong",
  admin_in_other_workspace: "errAdminElsewhere",
  admins_invalid: "errAdminsInvalid",
};

/** Текст ошибки по машинному коду сервера — на языке экрана, а не серверный русский. */
export function spaceErrorKey(e: unknown): SpacesKey {
  const code = e instanceof ApiError && e.body && typeof e.body === "object" ? (e.body as { code?: unknown }).code : undefined;
  return (typeof code === "string" && ERROR_BY_CODE[code]) || "errGeneric";
}

export function SpaceCreate({ onCreated, onCancel }: { onCreated: (ws: AdminWorkspace) => void; onCancel: () => void }) {
  const t = useSpacesText();
  const [name, setName] = useState("");
  const [more, setMore] = useState(false);
  const [countries, setCountries] = useState<string[]>([]);
  const [admins, setAdmins] = useState<string[]>([]);
  const [adminDraft, setAdminDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const addAdmin = () => {
    const v = adminDraft.trim();
    if (v && !admins.includes(v)) setAdmins((a) => [...a, v]);
    setAdminDraft("");
  };
  const toggle = (code: string) => setCountries((c) => (c.includes(code) ? c.filter((x) => x !== code) : [...c, code]));

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setErr(t("errNameRequired")); return; }
    // Недописанная ссылка в поле админов — тоже админ, а не потерянный ввод.
    const pending = adminDraft.trim();
    const list = pending && !admins.includes(pending) ? [...admins, pending] : admins;
    setSaving(true); setErr(null);
    try {
      onCreated(await createAdminWorkspace({ name: trimmed, countries: countries.length ? countries : undefined, admins: list.length ? list : undefined }));
    } catch (e) {
      console.error("[SpaceCreate]", e);
      setErr(t(spaceErrorKey(e)));
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-2.5 rounded-[10px] border border-line bg-surface-2 p-3">
      <div>
        <Lbl t={t("createName")} />
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={NAME_MAX} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") create(); if (e.key === "Escape") onCancel(); }}
          placeholder={t("createNamePlaceholder")} className={fieldCls} />
      </div>
      <button type="button" onClick={() => setMore((v) => !v)} aria-expanded={more}
        className="inline-flex items-center gap-1 font-medium text-ink-soft hover:text-ink" style={{ fontSize: 12.5 }}>
        <RoyIcon name="cright" size={13} className={`transition-transform ${more ? "rotate-90" : ""}`} />
        {t("createMore")}
      </button>
      {more && (
        <div className="space-y-3">
          <div>
            <Lbl t={t("createCountries")} />
            <div className="flex max-h-[120px] flex-wrap gap-1.5 overflow-y-auto">
              {Object.keys(COUNTRY_NAMES).map((code) => {
                const on = countries.includes(code);
                return (
                  <button key={code} type="button" onClick={() => toggle(code)} aria-pressed={on}
                    className="rounded-full border px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
                    style={{ fontSize: 11, ...(on ? { background: "var(--primary)", color: "#fff", borderColor: "var(--primary)" } : { color: "var(--ink-soft)", borderColor: "var(--line-2)" }) }}>
                    {countryCode(code)}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-ink-mute" style={{ fontSize: 11 }}>{t("createCountriesHint")}</p>
          </div>
          <div>
            <Lbl t={t("createAdmins")} />
            {admins.length > 0 && (
              <div className="mb-1.5 flex flex-wrap gap-1.5">
                {admins.map((a) => (
                  <span key={a} className="inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-1 text-ink" style={{ fontSize: 12 }}>
                    {a}
                    <button type="button" aria-label={t("remove")} onClick={() => setAdmins((x) => x.filter((y) => y !== a))} className="text-ink-mute hover:text-ink">
                      <RoyIcon name="x" size={12} strokeWidth={2.2} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input value={adminDraft} onChange={(e) => setAdminDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAdmin(); } }}
                placeholder={t("createAdminsPlaceholder")} className={fieldCls} />
              <button type="button" onClick={addAdmin} disabled={!adminDraft.trim()} className={btnGhost} style={{ fontSize: 12.5 }}>{t("add")}</button>
            </div>
            <p className="mt-1 text-ink-mute" style={{ fontSize: 11 }}>{t("createAdminsHint")}</p>
          </div>
        </div>
      )}
      {err && <p role="alert" className="font-semibold" style={{ fontSize: 12, color: "var(--pri-high)" }}>{err}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={btnGhost} style={{ fontSize: 13 }}>{t("cancel")}</button>
        <button type="button" onClick={create} disabled={saving || !name.trim()} className={btnPrimary} style={{ fontSize: 13 }}>
          {saving ? t("creating") : t("create")}
        </button>
      </div>
    </div>
  );
}
