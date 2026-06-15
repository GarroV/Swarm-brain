"use client";
import { useEffect, useState } from "react";
import { useRoyNav } from "../nav";
import { NavHeader, TypeTag, Market, SectionLabel, type RoyTypeKey } from "../ui";
import { fetchEntry } from "@/lib/api";
import type { Entry } from "@/types";

function tagKey(e: Entry): RoyTypeKey {
  const ft = typeof e.metadata?.file_type === "string" ? (e.metadata.file_type as string) : "";
  if (ft.includes("pdf")) return "pdf";
  switch (e.entry_type) {
    case "transcript":
      return "mic";
    case "meeting":
      return "meet";
    case "note":
      return "note";
    case "document":
      return "doc";
    default:
      return "doc";
  }
}

function deriveTitle(e: Entry): string {
  const mt = typeof e.metadata?.title === "string" ? (e.metadata.title as string).trim() : "";
  if (mt) return mt;
  const base = (e.summary && e.summary.trim()) || e.content || "";
  const fl = base.split("\n").map((s) => s.trim()).find(Boolean) ?? "";
  return fl.length > 80 ? fl.slice(0, 77) + "…" : fl || "Запись";
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

export function RecordDetail({ id }: { id: string }) {
  const { pop } = useRoyNav();
  const [e, setE] = useState<Entry | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchEntry(id)
      .then((x) => alive && setE(x))
      .catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [id]);

  return (
    <div className="flex flex-col h-full roy-pop">
      <NavHeader onBack={pop} title="Запись" />
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        {err && <div className="text-ink-soft text-sm py-8 text-center">Не удалось загрузить запись.</div>}
        {e && (
          <>
            <div className="flex items-center gap-2 mb-2 pt-1">
              <TypeTag type={tagKey(e)} />
              <Market code={e.countries?.[0]} />
              {e.entry_date && (
                <span className="text-ink-mute" style={{ fontSize: 12 }}>
                  {fmtDate(e.entry_date)}
                </span>
              )}
            </div>
            <h1 className="font-bold text-ink mb-3" style={{ fontSize: 22, letterSpacing: "-0.01em", lineHeight: 1.2 }}>
              {deriveTitle(e)}
            </h1>
            {e.summary && (
              <div className="px-4 py-3.5 mb-4" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 16 }}>
                <div className="text-accent-ink font-bold uppercase mb-1.5" style={{ fontSize: 11, letterSpacing: "0.05em" }}>
                  Кратко от ИИ
                </div>
                <p className="text-ink whitespace-pre-wrap" style={{ fontSize: 14, lineHeight: 1.55 }}>
                  {e.summary}
                </p>
              </div>
            )}
            <SectionLabel>Текст</SectionLabel>
            <p className="text-ink whitespace-pre-wrap" style={{ fontSize: 14.5, lineHeight: 1.65 }}>
              {e.content}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
