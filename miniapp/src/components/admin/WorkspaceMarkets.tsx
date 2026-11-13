"use client";
import { useState } from "react";
import { patchAdminWorkspace } from "@/lib/api";
import type { AdminWorkspace } from "@/types";
import { countryCode, COUNTRY_NAMES } from "@/lib/countries";
import { Segmented } from "@/components/roy/ui";
import { useDt } from "@/components/roy/nav";
import { btnPrimary } from "@/components/admin/ui";

// ── Рынки воркспейса ──────────────────────────────────────────────────────────
export function WorkspaceMarkets({ ws, onUpdated }: { ws: AdminWorkspace; onUpdated: () => void }) {
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
                  ? { background: "var(--primary)", color: "var(--on-primary)", borderColor: "var(--primary)" }
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

