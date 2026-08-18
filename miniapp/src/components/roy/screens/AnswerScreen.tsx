"use client";
import { useEffect, useState } from "react";
import { useRoyNav, openSourceRoute } from "../nav";
import { NavHeader, SectionLabel, RoyCard, TypeTag, Market, Chip, type RoyTypeKey } from "../ui";
import { RoyIcon } from "../icons";
import { ask, type AskResult, type AskSource } from "@/lib/api";

// Ответ с верхними индексами-сносками [n] → accent-ink.
function AnswerText({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p className="text-ink whitespace-pre-wrap" style={{ fontSize: 14.5, lineHeight: 1.6 }}>
      {parts.map((p, i) => {
        const m = p.match(/^\[(\d+)\]$/);
        if (m) {
          return (
            <sup key={i} className="text-accent-ink font-bold" style={{ fontSize: 11 }}>
              {m[1]}
            </sup>
          );
        }
        return <span key={i}>{p}</span>;
      })}
    </p>
  );
}

// entry_date (YYYY-MM-DD) → компактно «дд.мм.гг»; null / нераспознанное → null.
function fmtShortDate(d?: string | null): string | null {
  const m = (d ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1].slice(2)}` : null;
}

function Loading() {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-ink-soft" style={{ fontSize: 13.5 }}>
        <RoyIcon name="spark" size={16} className="text-primary roy-spin" />
        Swarm ищет по базе, встречам и задачам…
      </div>
      <div className="roy-shim" style={{ height: 86, borderRadius: 16 }} />
      <div className="space-y-2.5">
        {[0, 1, 2].map((i) => (
          <div key={i} className="roy-shim" style={{ height: 64, borderRadius: 18 }} />
        ))}
      </div>
    </div>
  );
}

// Тело ответа (запрос + ответ + источники + уточнения) — переиспользуется push-экраном
// AnswerScreen (мобайл) и AnswerModal (десктоп, контекстное окно). Колбэки определяют,
// куда вести уточнение/источник в каждом контексте.
export function AnswerBody({ query, onFollowup, onOpenRecord }: { query: string; onFollowup: (q: string) => void; onOpenRecord: (source: AskSource) => void }) {
  const [data, setData] = useState<AskResult | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr(false);
    ask(query)
      .then((r) => alive && setData(r))
      .catch(() => alive && setErr(true));
    return () => { alive = false; };
  }, [query]);

  return (
    <>
      <RoyCard className="px-4 py-3 mb-4 flex items-center gap-2.5">
        <RoyIcon name="search" size={16} className="text-ink-mute shrink-0" />
        <span className="text-ink font-medium" style={{ fontSize: 14.5 }}>{query}</span>
      </RoyCard>

      {!data && !err && <Loading />}
      {err && <div className="text-ink-soft text-sm py-8 text-center">Не удалось получить ответ. Попробуй ещё раз.</div>}

      {data && (
        <>
          {data.answer && (
            <div className="mb-5">
              <SectionLabel>Ответ</SectionLabel>
              <div className="px-4 py-4" style={{ background: "var(--accent-soft)", border: "1px solid var(--accent-line)", borderRadius: 16 }}>
                <AnswerText text={data.answer} />
              </div>
            </div>
          )}

          {data.sources.length > 0 && (
            <div className="mb-5">
              <SectionLabel>Источники</SectionLabel>
              <div className="space-y-2.5">
                {data.sources.map((s) => (
                  <button key={s.id} type="button" onClick={() => onOpenRecord(s)} className="w-full text-left transition-transform active:scale-[0.99]">
                    <RoyCard className="px-4 py-3.5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="inline-flex items-center justify-center rounded-full bg-accent-soft text-accent-ink font-bold shrink-0" style={{ width: 20, height: 20, fontSize: 11 }}>{s.n}</span>
                        <TypeTag type={s.tag as RoyTypeKey} small />
                        <Market code={s.market} />
                        {fmtShortDate(s.date) && (
                          <span className="text-ink-mute ml-auto tabular-nums" style={{ fontSize: 11 }}>{fmtShortDate(s.date)}</span>
                        )}
                      </div>
                      <div className="font-semibold text-ink mb-0.5" style={{ fontSize: 14.5, letterSpacing: "-0.01em" }}>{s.title}</div>
                      <div className="text-ink-soft line-clamp-2" style={{ fontSize: 13 }}>{s.snippet}</div>
                    </RoyCard>
                  </button>
                ))}
              </div>
            </div>
          )}

          {data.followups.length > 0 && (
            <div>
              <SectionLabel>Уточнить</SectionLabel>
              <div className="flex flex-wrap gap-2">
                {data.followups.map((f) => (
                  <Chip key={f} onClick={() => onFollowup(f)}>{f}</Chip>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// Полноэкранный push-вариант (мобайл / стек).
export function AnswerScreen({ query }: { query: string }) {
  const { pop, push } = useRoyNav();
  return (
    <div className="flex flex-col h-full roy-pop">
      <NavHeader onBack={pop} title="Ответ" />
      <div className="flex-1 overflow-y-auto px-5 pb-24">
        <AnswerBody
          query={query}
          onFollowup={(q) => push({ view: "answer", params: { query: q } })}
          onOpenRecord={openSourceRoute(push)}
        />
      </div>
    </div>
  );
}
