"use client";
import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { patchMe } from "@/lib/api";
import { COUNTRY_NAMES } from "@/lib/countries";
import { COCKPIT_BLOCKS, COCKPIT_MAX_COUNTRIES, type CockpitBlock, type CockpitPreferences } from "@/lib/homeCockpit";
import { useDt } from "../nav";
import styles from "./cockpit.module.css";

const LABELS: Record<CockpitBlock, [string, string]> = {
  reminders: ["Напоминания и объявления", "Reminders and notices"],
  meetings: ["Ближайшие встречи", "Upcoming meetings"], tasks: ["Ближайшие задачи", "Upcoming tasks"],
  quality: ["Рейтинги и проверки", "Ratings and inspections"], units: ["Пиццерии", "Pizzerias"],
};
type Props = {
  markets: string[]; preferences: CockpitPreferences; onClose: () => void;
  onSaved: (markets: string[], preferences: CockpitPreferences) => void;
};

/** Mounted only when opened: all edits remain a draft until the profile request succeeds. */
export function CockpitSettings({ markets, preferences, onClose, onSaved }: Props) {
  const dt = useDt();
  const [countries, setCountries] = useState(markets);
  const [blocks, setBlocks] = useState(preferences);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const choices = markets.includes("XD") ? { ...COUNTRY_NAMES, XD: "Demoland" } : COUNTRY_NAMES;
  const toggle = (code: string) => {
    if (!countries.includes(code) && countries.length >= COCKPIT_MAX_COUNTRIES) {
      setError(dt("Можно выбрать не больше 8 стран. Снимите одну, чтобы добавить другую.", "Choose up to 8 countries. Remove one to add another."));
      return;
    }
    setCountries((before) => before.includes(code) ? before.filter((cc) => cc !== code) : [...before, code]);
    setError("");
  };
  const save = async () => {
    if (!countries.length) { setError(dt("Выберите хотя бы одну страну.", "Choose at least one country.")); return; }
    setSaving(true); setError("");
    try {
      await patchMe({ markets: countries });
      onSaved(countries, blocks);
    } catch {
      setError(dt("Не удалось сохранить страны. Проверьте доступ и повторите — настройки не изменены.", "Couldn't save your countries. Check access and retry; your settings have not changed."));
      setSaving(false);
    }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent id="home-customization" showCloseButton={!saving} className="max-h-[calc(100dvh-32px)] overflow-y-auto sm:max-w-[520px]">
      <DialogTitle>{dt("Настроить главную", "Customize home")}</DialogTitle>
      <DialogDescription>{dt("Свои страны и блоки рабочего дня. Подборка стран также применяется к дайджесту.", "Choose countries and workday blocks. Your digest uses the same countries.")}</DialogDescription>
      <fieldset disabled={saving} className="space-y-3">
        <legend className="mb-2 text-[12px] font-semibold">{dt("Мои страны", "My countries")}</legend>
        <div className="flex justify-between text-[11px] text-ink-mute"><span>{dt("Выберите от 1 до 8 стран", "Choose 1 to 8 countries")}</span><b className="text-primary" aria-live="polite">{countries.length}/8</b></div>
        <div className={styles.countryChoices} role="group" aria-label={dt("Страны", "Countries")}>
          {Object.entries(choices).map(([code, name]) => <button key={code} type="button" aria-pressed={countries.includes(code)} title={name} aria-label={`${code} — ${name}`} onClick={() => toggle(code)} className={styles.countryChoice}>{code}</button>)}
        </div>
      </fieldset>
      <fieldset disabled={saving} className="space-y-2">
        <legend className="mb-2 text-[12px] font-semibold">{dt("Блоки главной", "Home blocks")}</legend>
        {COCKPIT_BLOCKS.map((block) => <label key={block} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2 text-[12px]">
          <input type="checkbox" checked={blocks[block]} onChange={(event) => setBlocks((before) => ({ ...before, [block]: event.target.checked }))} className="size-4 accent-[var(--primary)]" />{dt(...LABELS[block])}
        </label>)}
      </fieldset>
      <p role="alert" className="min-h-4 text-[11px] text-[var(--pri-high)]">{error}</p>
      <div className="flex justify-end gap-2">
        <button type="button" disabled={saving} onClick={onClose} className={styles.button}>{dt("Отмена", "Cancel")}</button>
        <button type="button" disabled={saving} onClick={() => void save()} className={`${styles.button} ${styles.primaryButton}`}>{saving ? dt("Сохраняем…", "Saving…") : dt("Сохранить настройки", "Save settings")}</button>
      </div>
    </DialogContent>
  </Dialog>;
}
