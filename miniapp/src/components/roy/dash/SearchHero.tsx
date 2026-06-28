"use client";
import { useState } from "react";
import { useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { RoyCard } from "../ui";
import { saveRecent } from "../screens/SearchScreen";

// Центр-верх главного экрана: поисковый герой «Рой» (RAG + поиск по базе).
// Только поле поиска (чипы-заготовки убраны по запросу). Submit → openAnswer (модал-ответ).

export function SearchHero() {
  const { openAnswer } = useRoyNav();
  const [q, setQ] = useState("");

  const go = (query: string) => {
    const v = query.trim();
    if (!v) return;
    saveRecent(v);
    openAnswer(v);
  };

  return (
    <RoyCard className="flex shrink-0 flex-col items-center justify-center gap-5 px-8 py-9">
      <div className="text-center">
        <h2 className="font-bold text-ink" style={{ fontSize: 30, letterSpacing: "-0.025em" }}>
          Спросите Swarm
        </h2>
        <p className="mt-1 text-ink-soft" style={{ fontSize: 13.5 }}>
          Ответ по базе знаний, чатам и расшифровкам встреч
        </p>
      </div>

      <form className="w-full" style={{ maxWidth: 560 }} onSubmit={(e) => { e.preventDefault(); go(q); }}>
        <div
          className="flex items-center gap-3 bg-surface border border-line-2 focus-within:border-primary dark:backdrop-blur-md"
          style={{ borderRadius: 16, padding: "14px 18px" }}
        >
          <RoyIcon name="spark" size={21} className="shrink-0 text-primary" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Спросить или найти по базе знаний…"
            enterKeyHint="search"
            className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
            style={{ fontSize: 16 }}
          />
          <kbd
            className="hidden select-none rounded-[7px] border border-line-2 bg-surface-2 px-2 py-0.5 font-semibold text-ink-mute lg:inline-block"
            style={{ fontSize: 12 }}
          >
            ⌘K
          </kbd>
        </div>
      </form>
    </RoyCard>
  );
}
