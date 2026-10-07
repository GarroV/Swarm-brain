"use client";
import { useEffect, useState } from "react";
import { useDt, useRoyNav } from "../nav";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fetchConfig, patchMe } from "@/lib/api";
import { countryFlag, countryName } from "@/lib/countries";

// Строка над виджетами: моя подборка стран (та же, что в профиле и в охвате дайджеста —
// user_profiles.markets), сужение до одной страны и вход в настройку главной.

type Props = {
  markets: string[];
  onMarkets: (next: string[]) => void;
  narrow: string | null;
  onNarrow: (cc: string | null) => void;
  editing: boolean;
  onEdit: () => void;
};

export function CountryBar({ markets, onMarkets, narrow, onNarrow, editing, onEdit }: Props) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 px-6 pt-4">
      <button type="button" onClick={() => setOpen(true)}
        className="flex min-h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-surface px-2.5 py-1 hover:border-accent-line"
        aria-label={dt("Мои страны — изменить подборку", "My countries — edit selection")}>
        <span className="font-medium text-ink-soft" style={{ fontSize: 12 }}>{dt("Мои страны", "My countries")}</span>
        {markets.length === 0 && <span className="text-ink-mute" style={{ fontSize: 12 }}>{dt("не выбраны", "none")}</span>}
        {markets.map((cc) => (
          <span key={cc} className="rounded-[6px] bg-surface-2 px-1.5 py-0.5 font-mono text-ink" style={{ fontSize: 11 }}>{countryFlag(cc)} {cc}</span>
        ))}
        <span className="font-medium text-primary" style={{ fontSize: 12 }}>{dt("изменить", "edit")}</span>
      </button>
      {narrow && (
        <span className="flex items-center gap-1 rounded-full bg-ink px-2.5 py-1 text-background" style={{ fontSize: 12 }}>
          {dt(`Только ${countryName(narrow)}`, `Only ${narrow}`)}
          <button type="button" onClick={() => onNarrow(null)} aria-label={dt("Снять", "Clear")} className="ml-1 opacity-70 hover:opacity-100">×</button>
        </span>
      )}
      {!editing && (
        <button type="button" onClick={onEdit}
          className="ml-auto flex min-h-8 items-center gap-1.5 rounded-[9px] border border-line-2 bg-surface px-2.5 font-semibold text-ink-soft hover:border-accent-line hover:text-primary"
          style={{ fontSize: 12.5 }}>
          ⚙ {dt("Настроить главную", "Customize home")}
        </button>
      )}
      <CountryPicker open={open} onOpenChange={setOpen} markets={markets} onSaved={onMarkets} />
    </div>
  );
}

function CountryPicker({ open, onOpenChange, markets, onSaved }: {
  open: boolean; onOpenChange: (v: boolean) => void; markets: string[]; onSaved: (next: string[]) => void;
}) {
  const dt = useDt();
  const { toast } = useRoyNav();
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<string[]>(markets);
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setDraft(markets); }, [open, markets]);
  useEffect(() => {
    if (!open || allowed) return;
    fetchConfig().then((c) => setAllowed(c.allowed_markets)).catch((e) => { console.warn("[home] config", e); setAllowed([]); });
  }, [open, allowed]);

  const toggle = (cc: string) => setDraft((d) => (d.includes(cc) ? d.filter((x) => x !== cc) : [...d, cc]));
  const save = async () => {
    setSaving(true);
    try {
      await patchMe({ markets: draft });
      onSaved(draft);
      onOpenChange(false);
    } catch (e) {
      toast(dt("Не удалось сохранить подборку", "Couldn't save the selection"));
      console.warn("[home] markets", e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogTitle>{dt("Мои страны", "My countries")}</DialogTitle>
        <p className="text-ink-soft" style={{ fontSize: 12.5 }}>
          {dt("Главная показывает метрики только по выбранным странам. Та же подборка задаёт охват вашего дайджеста.",
            "Home shows metrics only for these countries. The same selection scopes your digest.")}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {allowed == null && <div className="roy-shim h-8 w-full rounded-[8px]" />}
          {(allowed ?? []).map((cc) => {
            const on = draft.includes(cc);
            return (
              <button key={cc} type="button" onClick={() => toggle(cc)} aria-pressed={on}
                className={`rounded-full border px-2.5 py-1 transition-colors ${on ? "border-primary bg-accent-soft text-primary" : "border-line-2 text-ink-soft hover:border-accent-line"}`}
                style={{ fontSize: 12.5 }}>
                {countryFlag(cc)} {dt(countryName(cc), cc)}
              </button>
            );
          })}
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={() => onOpenChange(false)} className="rounded-[8px] border border-line-2 px-3 py-1.5 font-semibold" style={{ fontSize: 13 }}>{dt("Отмена", "Cancel")}</button>
          <button type="button" disabled={saving} onClick={save} className="rounded-[8px] bg-primary px-3 py-1.5 font-semibold text-primary-foreground disabled:opacity-60" style={{ fontSize: 13 }}>
            {saving ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
