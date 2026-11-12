"use client";
import { useState } from "react";
import { patchMe } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SCHEME, forcedMode, SCHEME_OPTIONS, schemeOption, type SchemeId, type SchemeMode, type SchemeOption,
} from "@/lib/scheme";
import { applyScheme, isDarkFor, saveTheme, type ThemeId } from "@/lib/theme";
import { useScheme, useThemeMode } from "@/lib/useScheme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RoyIcon, type RoyIconName } from "./icons";
import { useDt } from "./nav";

// Меню «Оформление» (решение владельца 12.11.2026, docs/decisions/2026-11-12-color-themes.md):
// режим (светлая / тёмная / как в системе) и сетка цветовых схем с мини-превью. Схема и режим
// применяются сразу; схема уходит в профиль (PATCH /me ui_scheme), режим остаётся на устройстве
// (как раньше у переключателя в рейке). Схема с одним режимом фиксирует его — выбор режима
// на это время отключён и подписан.

const MODES: readonly { id: ThemeId; ru: string; en: string; icon: RoyIconName }[] = [
  { id: "light", ru: "Светлая", en: "Light", icon: "sun" },
  { id: "dark", ru: "Тёмная", en: "Dark", icon: "moon" },
  { id: "system", ru: "Как в системе", en: "System", icon: "monitor" },
];

/** Какой вариант схемы рисует плитка: текущий режим, а если его у схемы нет — тот, что есть. */
function previewDark(o: SchemeOption, darkNow: boolean): boolean {
  const has = (m: SchemeMode) => (o.modes as readonly SchemeMode[]).includes(m);
  if (darkNow) return has("dark") || !has("light");
  return !has("light");
}

function modesCaption(o: SchemeOption, dt: (ru: string, en: string) => string): string {
  if (o.modes.length === 2) return dt("Светлая + тёмная", "Light + dark");
  return o.modes[0] === "light" ? dt("Только светлая", "Light only") : dt("Только тёмная", "Dark only");
}

// Мини-макет экрана на переменных схемы: рейка, шапка, карточка со строками и тремя статусными точками.
function Thumb({ id, dark }: { id: SchemeId; dark: boolean }) {
  return (
    <div data-scheme={id} className={cn(dark && "dark", "relative flex h-[70px] w-full overflow-hidden rounded-[7px] border border-line-2")}
      style={{ background: "var(--background)", colorScheme: dark ? "dark" : "light" }} aria-hidden>
      <div className="w-[22%] shrink-0 border-r" style={{ background: "var(--sidebar)", borderColor: "var(--line)" }}>
        <i className="mx-1.5 mt-2 block h-1 rounded-sm" style={{ background: "var(--ink-mute)" }} />
        <i className="mx-1.5 mt-1.5 block h-1.5 rounded-sm" style={{ background: "var(--accent-soft)", boxShadow: "inset 0 0 0 1px var(--accent-line)" }} />
        <i className="mx-1.5 mt-1.5 block h-1 rounded-sm" style={{ background: "var(--ink-mute)", opacity: 0.6 }} />
      </div>
      <div className="flex-1 p-1.5">
        <i className="block h-1.5 w-1/2 rounded-sm" style={{ background: "var(--ink)" }} />
        <div className="mt-1.5 rounded-[3px] border p-1.5" style={{ background: "var(--surface)", borderColor: "var(--line)" }}>
          <i className="block h-1 w-4/5 rounded-sm" style={{ background: "var(--ink-soft)" }} />
          <div className="mt-1.5 flex items-center gap-1">
            <i className="block h-2 w-5 rounded-sm" style={{ background: "var(--primary)" }} />
            <i className="size-1.5 rounded-full" style={{ background: "var(--pri-high)" }} />
            <i className="size-1.5 rounded-full" style={{ background: "var(--pri-med)" }} />
            <i className="size-1.5 rounded-full" style={{ background: "var(--status-done)" }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export function SchemeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const dt = useDt();
  const scheme = useScheme();
  const mode = useThemeMode();
  const [saveFailed, setSaveFailed] = useState(false);
  const forced = forcedMode(scheme);
  const darkNow = isDarkFor(mode, scheme);

  const save = (id: SchemeId) => {
    setSaveFailed(false);
    patchMe({ ui_scheme: id === DEFAULT_SCHEME ? null : id }).catch((e) => {
      console.error("[SchemeDialog] save failed", e);
      setSaveFailed(true);
    });
  };
  const pick = (id: SchemeId) => {
    if (id === scheme) return;
    applyScheme(id);
    save(id);
  };
  const reset = () => {
    saveTheme("system");
    if (scheme !== DEFAULT_SCHEME) { applyScheme(DEFAULT_SCHEME); save(DEFAULT_SCHEME); }
  };

  const title = dt("Оформление", "Appearance");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[620px] overflow-y-auto sm:max-w-[620px]">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pr-9">
          <DialogTitle className="text-[19px] leading-tight">{title}</DialogTitle>
          <DialogDescription className="text-ink-mute" style={{ fontSize: 12.5 }}>
            {dt("применяется сразу ко всему интерфейсу", "applies to the whole interface right away")}
          </DialogDescription>
        </div>

        <section aria-labelledby="scheme-mode-h" className="space-y-2">
          <h3 id="scheme-mode-h" className="font-medium text-ink-mute" style={{ fontSize: 12 }}>{dt("Режим", "Mode")}</h3>
          <div role="radiogroup" aria-labelledby="scheme-mode-h" className="grid grid-cols-3 gap-1 rounded-full border border-line-2 bg-surface-2 p-1">
            {MODES.map((m) => {
              // Схема с одним режимом: подсвечен навязанный, остальные отключены.
              const on = forced ? forced === m.id : mode === m.id;
              const locked = forced !== null;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={on} disabled={locked}
                  onClick={() => saveTheme(m.id)}
                  className={cn(
                    "flex min-h-8 items-center justify-center gap-1.5 rounded-full px-2 font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed",
                    on ? "bg-surface text-ink shadow-[0_0_0_1px_var(--line-2)]" : "text-ink-soft enabled:hover:text-ink",
                    locked && !on && "opacity-50",
                  )} style={{ fontSize: 13 }}>
                  <RoyIcon name={m.icon} size={14} strokeWidth={1.8} />
                  <span className="truncate">{dt(m.ru, m.en)}</span>
                </button>
              );
            })}
          </div>
          {forced && (
            <p className="text-ink-mute" style={{ fontSize: 12 }} role="status">
              {forced === "light"
                ? dt(`Схема «${schemeOption(scheme).ru}» только светлая — режим задаёт она сама.`, `The “${schemeOption(scheme).en}” scheme is light only — it sets the mode itself.`)
                : dt(`Схема «${schemeOption(scheme).ru}» только тёмная — режим задаёт она сама.`, `The “${schemeOption(scheme).en}” scheme is dark only — it sets the mode itself.`)}
            </p>
          )}
        </section>

        <section aria-labelledby="scheme-grid-h" className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 id="scheme-grid-h" className="font-medium text-ink-mute" style={{ fontSize: 12 }}>{dt("Цветовая схема", "Colour scheme")}</h3>
            <span className="text-ink-mute" style={{ fontSize: 11.5 }}>
              {dt("показан текущий режим, а если его нет у схемы — тот, что есть", "preview follows the current mode, or the one the scheme has")}
            </span>
          </div>
          <div role="radiogroup" aria-labelledby="scheme-grid-h" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {SCHEME_OPTIONS.map((o, i) => {
              const on = o.id === scheme;
              return (
                <button key={o.id} type="button" role="radio" aria-checked={on} onClick={() => pick(o.id)}
                  className={cn(
                    "relative flex flex-col gap-1.5 rounded-[9px] border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
                    on ? "border-primary bg-accent-soft" : "border-line-2 bg-surface hover:bg-surface-2",
                  )}>
                  <Thumb id={o.id} dark={previewDark(o, darkNow)} />
                  {on && (
                    <span className="absolute right-0.5 top-0.5 grid size-[18px] place-items-center rounded-full bg-primary text-primary-foreground">
                      <RoyIcon name="check" size={11} strokeWidth={2.6} />
                    </span>
                  )}
                  <span className="px-0.5 font-semibold text-ink" style={{ fontSize: 12.5 }}>
                    {i === 0 ? "" : `${i}. `}{dt(o.tileRu, o.tileEn)}
                  </span>
                  <span className="px-0.5 text-ink-mute" style={{ fontSize: 11 }}>{modesCaption(o, dt)}</span>
                </button>
              );
            })}
          </div>
        </section>

        {saveFailed && (
          <p className="text-[var(--pri-high)]" style={{ fontSize: 12 }} role="alert">
            {dt("Не удалось сохранить в профиль — схема действует только в этом браузере.", "Couldn't save to your profile — the scheme applies in this browser only.")}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
          <p className="min-w-0 flex-1 text-ink-mute" style={{ fontSize: 12, lineHeight: 1.4 }}>
            {dt("Схема запоминается в профиле и работает на всех устройствах; режим — на этом устройстве.",
              "The scheme is kept in your profile and works on every device; the mode stays on this device.")}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset}>{dt("Сбросить", "Reset")}</Button>
            <Button onClick={() => onOpenChange(false)}>{dt("Готово", "Done")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Кнопка-шестерёнка: открывает меню «Оформление». Живёт в рейке рядом с переключателем режима. */
export function SchemeGear({ className }: { className?: string }) {
  const dt = useDt();
  const [open, setOpen] = useState(false);
  const label = dt("Оформление", "Appearance");
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title={label} aria-label={label} aria-haspopup="dialog"
        className={cn(
          "grid size-[28px] shrink-0 place-items-center rounded-full border border-line-2 bg-surface text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] narrow:h-[34px] narrow:w-full narrow:rounded-[8px] narrow:border-0 narrow:bg-transparent",
          open && "bg-accent-soft text-accent-ink",
          className,
        )}>
        <RoyIcon name="gear" size={15} strokeWidth={1.7} className="narrow:size-[17px]" />
      </button>
      <SchemeDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
