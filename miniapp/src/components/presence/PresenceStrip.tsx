"use client";
// Полоска «кто сейчас в SWARM» в шапке, слева от колокольчика (его рендерит NotificationsBell,
// поэтому полоска есть на всех экранах). Звери и неоновые стили — components/presence/animals.ts
// и neonStyles.ts; данные — GET /presence/strip через lib/presenceStripStore.ts (опрос 5 с).
// Настоящих имён у клиента нет: подсказка = псевдоним + раздел + состояние.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useLang } from "@/components/roy/nav";
import { cn } from "@/lib/utils";
import {
  orderForStrip,
  splitVisible,
  STRIP_MAX_DESKTOP,
  STRIP_MAX_MOBILE,
  tooltipText,
  type StripPerson,
} from "@/lib/presenceStrip";
import { getStripServerSnapshot, getStripSnapshot, subscribeStrip } from "@/lib/presenceStripStore";
import { ANIMAL_NAMES } from "./animals";
import { ensureNeonDefs, neonAvatarMarkup } from "./neonStyles";
import { stripLabel } from "./strings";

const SIZE = 29;
// Пять кружков — только на широком окне: на 1280 px шапка «Главной» (поиск, «Настроить главную»,
// карта проекта) уже не вмещает их, и правая кнопка уезжала за край.
const WIDE_QUERY = "(min-width: 1440px)";

function useIsWide(): boolean {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY);
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return wide;
}
const OVERLAP = 6;

type Tip = { text: string; left: number; top: number };

function Avatar({ person }: { person: StripPerson }) {
  const markup = neonAvatarMarkup(person.animal, person.style);
  if (markup === null) return null;
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 100 100"
      aria-hidden="true"
      // Разметка собрана из наших же констант (animals.ts, neonStyles.ts), индексы проверены
      // в neonAvatarMarkup; пользовательского ввода в ней нет.
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

export function PresenceStrip({ className }: { className?: string }) {
  const lang = useLang();
  const isWide = useIsWide();
  const people = useSyncExternalStore(subscribeStrip, getStripSnapshot, getStripServerSnapshot);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    ensureNeonDefs();
  }, []);

  // Полоска исчезла или человек ушёл — подсказка не должна зависнуть.
  useEffect(() => {
    if (people.length === 0) setTip(null);
  }, [people.length]);

  useEffect(() => {
    if (!tip) return;
    const hide = () => setTip(null);
    window.addEventListener("scroll", hide, { passive: true, capture: true });
    return () => window.removeEventListener("scroll", hide, { capture: true });
  }, [tip]);

  if (people.length === 0) return null;

  const { shown, rest } = splitVisible(orderForStrip(people), isWide ? STRIP_MAX_DESKTOP : STRIP_MAX_MOBILE);
  const text = (p: StripPerson) => tooltipText(p, ANIMAL_NAMES[p.animal]?.[lang === "en" ? 1 : 0] ?? "?", lang);

  const show = (el: HTMLElement, p: StripPerson) => {
    const r = el.getBoundingClientRect();
    setTip({ text: text(p), left: r.left + r.width / 2, top: r.bottom + 6 });
  };

  return (
    <div
      role="group"
      aria-label={stripLabel(lang)}
      className={cn("presence-strip flex items-center", className)}
      onMouseLeave={() => setTip(null)}
    >
      {shown.map((p, i) => (
        <span
          key={`${p.key}-${i}`}
          tabIndex={0}
          role="img"
          aria-label={text(p)}
          className={cn(
            "presence-strip__dot relative inline-flex shrink-0 cursor-default items-center justify-center rounded-full outline-none",
            "ring-2 ring-background focus-visible:ring-primary",
            p.state === "idle" && "presence-strip__dot--idle",
          )}
          style={{ width: SIZE, height: SIZE, marginLeft: i === 0 ? 0 : -OVERLAP, zIndex: shown.length - i }}
          onMouseEnter={(e) => show(e.currentTarget, p)}
          onFocus={(e) => show(e.currentTarget, p)}
          onBlur={() => setTip(null)}
        >
          <Avatar person={p} />
        </span>
      ))}
      {rest > 0 && (
        <span
          className="ml-1.5 shrink-0 font-semibold tabular-nums text-ink-soft"
          style={{ fontSize: 12 }}
          aria-label={`+${rest}`}
        >
          +{rest}
        </span>
      )}
      {tip && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[60] -translate-x-1/2 whitespace-nowrap rounded-[8px] border border-line bg-[var(--popover)] px-2.5 py-1.5 text-ink shadow-[0_12px_32px_-12px_rgba(0,0,0,.5)]"
          style={{
            fontSize: 12,
            top: tip.top,
            left: Math.min(Math.max(tip.left, 100), (typeof window === "undefined" ? 9999 : window.innerWidth) - 100),
          }}
        >
          {tip.text}
        </span>
      )}
    </div>
  );
}
