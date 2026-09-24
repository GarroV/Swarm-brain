"use client";
import { useState } from "react";
import { patchMe } from "@/lib/api";
import { applyBackdrop, BACKDROP_OPTIONS, type BackdropId } from "@/lib/backdrop";
import { useBackdrop } from "@/lib/useBackdrop";
import { useDt } from "@/components/roy/nav";
import { RoyIcon } from "@/components/roy/icons";

// Выбор задника — личная настройка (docs/decisions/2026-09-24-backdrop.md). Применяется сразу в
// этой вкладке, в профиль уходит следом: так выбор едет на другие устройства.

// Превью галактики — статичная картинка градиентами: живой canvas в плитке не нужен.
const GALAXY_PREVIEW =
  "radial-gradient(circle at 50% 55%, rgba(250,224,158,.35), transparent 28%)," +
  "radial-gradient(1px 1px at 22% 30%, #fff, transparent)," +
  "radial-gradient(1px 1px at 70% 22%, #cfe3f0, transparent)," +
  "radial-gradient(1px 1px at 82% 70%, #fff, transparent)," +
  "radial-gradient(1px 1px at 35% 78%, #cfe3f0, transparent)," +
  "radial-gradient(60% 40% at 50% 55%, rgba(120,170,200,.18), transparent 70%)," +
  "#0E1116";

function Preview({ id }: { id: BackdropId }) {
  const base = "h-14 w-full rounded-[7px] border border-line-2";
  if (id === "galaxy") return <div className={base} style={{ background: GALAXY_PREVIEW }} />;
  if (id === "none") return <div className={`${base} bg-background`} />;
  return <div className={`${base} bg-background roy-backdrop-${id}`} />;
}

export function BackdropSection() {
  const dt = useDt();
  const current = useBackdrop();
  const [saveFailed, setSaveFailed] = useState(false);

  const choose = (id: BackdropId) => {
    if (id === current) return;
    applyBackdrop(id);
    setSaveFailed(false);
    patchMe({ ui_backdrop: id }).catch((e) => {
      console.error("[BackdropSection] save failed", e);
      setSaveFailed(true);
    });
  };

  return (
    <div className="space-y-2.5">
      <div role="radiogroup" aria-label={dt("Фон", "Background")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {BACKDROP_OPTIONS.map((o) => {
          const on = o.id === current;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(o.id)}
              className={`flex flex-col gap-1.5 rounded-[8px] border p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
                on ? "border-primary bg-accent-soft" : "border-line-2 bg-surface hover:bg-surface-2"
              }`}
            >
              <Preview id={o.id} />
              <span className="flex items-center gap-1 px-0.5 font-semibold text-ink" style={{ fontSize: 12.5 }}>
                {on && <RoyIcon name="check" size={13} strokeWidth={2.2} className="text-accent-ink" />}
                {dt(o.ru, o.en)}
              </span>
              <span className="px-0.5 text-ink-mute" style={{ fontSize: 11, lineHeight: 1.3 }}>
                {dt(o.hintRu, o.hintEn)}
              </span>
            </button>
          );
        })}
      </div>
      {saveFailed && (
        <p className="text-[var(--pri-high)]" style={{ fontSize: 12 }}>
          {dt(
            "Не удалось сохранить в профиль — фон действует только в этом браузере.",
            "Couldn't save to your profile — the background applies in this browser only.",
          )}
        </p>
      )}
    </div>
  );
}
