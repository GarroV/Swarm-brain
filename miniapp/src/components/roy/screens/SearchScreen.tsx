"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { RoyIcon } from "../icons";
import { Avatar, SectionLabel, Chip } from "../ui";

const RECENT_KEY = "roy_recent_searches";

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}
export function saveRecent(q: string) {
  const next = [q, ...loadRecent().filter((x) => x !== q)].slice(0, 8);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota — игнорируем */
  }
}

function initials(name: string | undefined | null): string {
  if (!name || /^\d+$/.test(name.trim())) return "Я";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "Я";
}

export function SearchScreen() {
  const { me, push } = useRoyNav();
  const [q, setQ] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  const go = (query: string) => {
    const v = query.trim();
    if (!v) return;
    saveRecent(v);
    push({ view: "answer", params: { query: v } });
  };

  return (
    <div className="h-full overflow-y-auto">
      {/* лого + аватар */}
      <div className="flex items-center justify-between px-5 pt-3 pb-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center justify-center rounded-[10px] bg-primary font-extrabold text-white" style={{ width: 30, height: 30, fontSize: 18 }}>
            Р
          </span>
          <span className="font-bold" style={{ fontSize: 22, letterSpacing: "-0.01em" }}>
            Рой
          </span>
        </div>
        <button type="button" onClick={() => push({ view: "more" })} aria-label="Меню" className="transition-transform active:scale-[0.95]">
          <Avatar size={36}>{initials(me?.name)}</Avatar>
        </button>
      </div>

      {/* поле поиска (герой) */}
      <div className="px-5 pt-2">
        <form onSubmit={(e) => { e.preventDefault(); go(q); }}>
          <div className="flex items-center gap-2.5 bg-surface" style={{ border: "2px solid var(--ink)", borderRadius: 15, padding: "13px 15px" }}>
            <RoyIcon name="spark" size={20} className="shrink-0 text-primary" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Спросить или найти…"
              enterKeyHint="search"
              className="flex-1 bg-transparent text-ink outline-none placeholder:text-ink-mute"
              style={{ fontSize: 16 }}
            />
          </div>
        </form>
      </div>

      {recent.length > 0 && (
        <div className="px-5 pt-6 pb-24">
          <SectionLabel>Недавнее</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <Chip key={r} onClick={() => go(r)}>
                {r}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
