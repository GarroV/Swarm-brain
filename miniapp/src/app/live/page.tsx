"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

// «Рой Live» — companion-экран встречи (Granola-режим). Три режима:
//   • ?meeting=<id>      — РЕАЛЬНЫЙ: грузит встречу/тезисы/пометки, автосейв в /api, результат.
//   • ?host=recorder     — панель рекордера: пометки уходят в нативный буфер (meetingId на стопе).
//   • без параметров     — ДЕМО: локальные данные, раскладка пометок по времени (для показа UX).
// Пользовательские пометки рисуются жирным/янтарным — чтобы видеть, где человек, а где ИИ.

type Note = { sec: number; text: string };

const MONO: CSSProperties = { fontFamily: "var(--font-geist-mono), ui-monospace, Menlo, monospace" };
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// ── демо-данные (только для режима без ?meeting) ──────────────────────────────
type DemoSection = { h: string; from: number; to: number; ai: ReactNode };
const DEMO_SECTIONS: DemoSection[] = [
  { h: "Темы", from: 0, to: 240, ai: <p style={{ margin: 0 }}>Обсуждали модель <b>«1 управляющий на N точек»</b>: где предел нагрузки, что делегировать.</p> },
  { h: "Решения", from: 240, to: 450, ai: <ul style={{ margin: 0, paddingLeft: 18 }}><li>Пилот в <b>KZ</b> на 3 точках.</li><li>Метрика — себестоимость смены.</li></ul> },
  { h: "Задачи", from: 450, to: 600, ai: <ul style={{ margin: 0, paddingLeft: 18 }}><li>Чек-лист управляющего — <b>Ксения, до 30 июня</b>.</li></ul> },
];
function demoSectionIndex(sec: number): number {
  const i = DEMO_SECTIONS.findIndex((s) => sec >= s.from && sec < s.to);
  return i === -1 ? DEMO_SECTIONS.length - 1 : i;
}

// ── /api (cookie-сессия как у остального приложения) ──────────────────────────
async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api${path}`, { credentials: "include" });
  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(await res.text().catch(() => "err"));
  return res.json();
}
async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: "POST", credentials: "include",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (res.status === 401) throw new Error("AUTH");
  if (!res.ok) throw new Error(await res.text().catch(() => "err"));
  return res.json();
}

// лёгкий парсер тезисов (наш стабильный markdown: ### Тема / - пункт)
function renderTheses(md: string): ReactNode {
  const out: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => { if (bullets.length) { out.push(<ul key={`u${k}`} style={{ margin: "0 0 8px", paddingLeft: 18 }}>{bullets.map((b, i) => <li key={i} style={{ margin: "4px 0" }}>{b}</li>)}</ul>); bullets = []; } };
  md.split("\n").forEach((ln, i) => {
    const t = ln.trim();
    if (t.startsWith("### ")) { flush(i); out.push(<h3 key={`h${i}`} style={{ ...MONO, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)", margin: "14px 0 9px" }}>{t.slice(4)}</h3>); }
    else if (t.startsWith("- ") || t.startsWith("• ")) bullets.push(t.slice(2));
    else if (t) { flush(i); out.push(<p key={`p${i}`} style={{ margin: "0 0 8px" }}>{t.replace(/^#+\s*/, "")}</p>); }
  });
  flush(9999);
  return out;
}

export default function LivePage() {
  // ?m=<id> — нейтральный параметр (НЕ ?meeting=, который основное приложение ловит как deep-link).
  const meetingId = useMemo(() => {
    if (typeof window === "undefined") return null;
    const p = new URLSearchParams(window.location.search);
    return p.get("m") ?? p.get("meeting");
  }, []);
  const recorderHost = useMemo(() => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("host") === "recorder" : false), []);
  const real = !!meetingId && !recorderHost;

  const [phase, setPhase] = useState<"capture" | "result">("capture");
  const [notes, setNotes] = useState<Note[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState(false);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // реальный режим
  const [title, setTitle] = useState("Встреча");
  const [thesesMd, setThesesMd] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<"AUTH" | "ERR" | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (phase !== "capture") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);
  useEffect(() => {
    const apply = () => setInline(window.innerWidth < 720);
    apply(); window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  // реальный режим: грузим встречу + существующие пометки
  useEffect(() => {
    if (!real || !meetingId) { setLoaded(true); return; }
    (async () => {
      try {
        const m = await apiGet<{ title?: string; draft_notes_md?: string | null }>(`/agent-meetings/${meetingId}`);
        setTitle(m.title || "Встреча");
        setThesesMd(m.draft_notes_md ?? null);
        const ns = await apiGet<Array<{ offset_sec: number; text: string }>>(`/agent-meetings/${meetingId}/notes`);
        setNotes(ns.map((n) => ({ sec: n.offset_sec, text: n.text })));
      } catch (e) {
        setLoadErr(e instanceof Error && e.message === "AUTH" ? "AUTH" : "ERR");
      } finally { setLoaded(true); }
    })();
  }, [real, meetingId]);

  const addNote = async () => {
    const t = draft.trim();
    if (!t || saving) return;
    const note: Note = { sec: elapsed, text: t };
    setNotes((n) => [...n, note]);
    setDraft("");
    inputRef.current?.focus();
    // режим рекордера → в нативный буфер (meetingId появится на стопе)
    if (recorderHost) {
      try {
        (window as unknown as { webkit?: { messageHandlers?: { royNotes?: { postMessage: (m: unknown) => void } } } })
          .webkit?.messageHandlers?.royNotes?.postMessage({ offset_sec: note.sec, text: note.text });
      } catch { /* не в нативной панели */ }
      return;
    }
    // реальный режим → автосейв в /api
    if (real && meetingId) {
      setSaving(true);
      try { await apiPost(`/agent-meetings/${meetingId}/notes`, { offset_sec: note.sec, text: note.text }); }
      catch (e) { setLoadErr(e instanceof Error && e.message === "AUTH" ? "AUTH" : "ERR"); }
      finally { setSaving(false); }
    }
  };

  const demoNotesBySection = useMemo(() => {
    const map: Note[][] = DEMO_SECTIONS.map(() => []);
    [...notes].sort((a, b) => a.sec - b.sec).forEach((n) => map[demoSectionIndex(n.sec)].push(n));
    return map;
  }, [notes]);

  const card: CSSProperties = { background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16, backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)" };

  // ── авторизация в реальном режиме ──
  if (real && loadErr === "AUTH") {
    const next = encodeURIComponent(typeof window !== "undefined" ? window.location.pathname + window.location.search : `/live?m=${meetingId}`);
    return (
      <main style={wrapStyle}>
        <div style={{ ...card, padding: 26, textAlign: "center", maxWidth: 420, margin: "60px auto" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 18 }}>Нужен вход</h2>
          <p style={{ color: "var(--ink-mute)", fontSize: 13.5, margin: "0 0 16px" }}>Чтобы открыть встречу и сохранять пометки.</p>
          <a href={`/login?next=${next}`} style={{ ...btnStyle, textDecoration: "none", display: "inline-block" }}>Войти через Telegram</a>
        </div>
      </main>
    );
  }
  if (real && !loaded) {
    return <main style={wrapStyle}><div style={{ ...card, padding: 26, textAlign: "center", maxWidth: 420, margin: "60px auto", color: "var(--ink-mute)" }}>Загрузка встречи…</div></main>;
  }

  return (
    <main style={wrapStyle}>
      {/* шапка встречи */}
      <header style={{ ...card, borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", marginBottom: 14 }}>
        {phase === "capture"
          ? <span style={{ display: "flex", alignItems: "center", gap: 7, ...MONO, fontSize: 11, letterSpacing: ".1em", color: "#ff6b5e", fontWeight: 600 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff6b5e", animation: "rlPulse 1.6s infinite" }} />{real ? "ВСТРЕЧА" : "REC"}</span>
          : <span style={{ ...MONO, fontSize: 11, letterSpacing: ".1em", color: "var(--status-done)", fontWeight: 600 }}>✓ ГОТОВО</span>}
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{real ? title : "Discovery: практика «1 управляющий»"}</span>
        <span style={{ ...MONO, fontSize: 12, color: "var(--ink-soft)" }}>{fmt(elapsed)}</span>
      </header>

      {phase === "capture" ? (
        <section style={{ ...card, padding: "15px 17px 17px" }}>
          <p style={{ margin: "0 0 13px", fontSize: 12, color: "var(--ink-mute)", display: "flex", gap: 8 }}>
            <span>📝</span><span><b style={{ color: "var(--ink-soft)", fontWeight: 600 }}>Пометки на полях</b> — пиши свободно. Каждая запоминает время.{real ? " Сохраняются к встрече сразу." : ""}</span>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 130, marginBottom: 13 }}>
            {notes.length === 0 && <div style={{ ...MONO, fontSize: 11.5, color: "var(--ink-mute)", padding: "10px 0", letterSpacing: ".02em" }}>пометок пока нет — пиши ниже</div>}
            {notes.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span style={{ ...MONO, fontSize: 10.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent-soft)", borderRadius: 6, padding: "3px 7px", flex: "none" }}>{fmt(n.sec)}</span>
                <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{n.text}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addNote(); }} placeholder="пометка на полях…" style={{ flex: 1, background: "color-mix(in srgb, var(--ink) 6%, transparent)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px", color: "var(--ink)", fontSize: 13.5, outline: "none" }} />
            <button onClick={addNote} disabled={saving} style={{ ...btnStyle, opacity: saving ? 0.6 : 1 }}>+</button>
          </div>
          {loadErr === "ERR" && <p style={{ color: "var(--status-prog)", fontSize: 12, margin: "9px 0 0" }}>Не удалось сохранить — проверь сеть.</p>}
          {recorderHost ? (
            <p style={{ ...MONO, textAlign: "center", fontSize: 11, color: "var(--ink-mute)", margin: "13px 0 0", lineHeight: 1.5 }}>пометки сохраняются к встрече автоматически<br />тезисы появятся после завершения записи</p>
          ) : (
            <>
              <button onClick={() => setPhase("result")} style={{ ...btnStyle, width: "100%", marginTop: 13, padding: "12px" }}>{real ? "✦ Показать тезисы + мои пометки" : "✦ Готово — собрать тезисы"}</button>
              <p style={{ ...MONO, textAlign: "center", fontSize: 10.5, color: "var(--ink-mute)", margin: "11px 0 0" }}>транскрипт идёт фоном · показывается ПОСЛЕ встречи</p>
            </>
          )}
        </section>
      ) : (
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <h1 style={{ fontSize: 21, margin: 0, letterSpacing: "-.01em" }}>{real ? title : "Discovery: практика «1 управляющий»"}</h1>
            <span style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4, background: "color-mix(in srgb, var(--ink) 8%, transparent)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 }}>
              {([["margin", "На полях"], ["inline2", "Инлайн"]] as const).map(([k, label]) => {
                const active = (k === "inline2") === inline;
                return <button key={k} onClick={() => setInline(k === "inline2")} style={{ border: "none", background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--accent-ink)" : "var(--ink-soft)", fontWeight: 600, fontSize: 12, padding: "7px 12px", borderRadius: 7, cursor: "pointer" }}>{label}</button>;
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "0 0 16px", fontSize: 12, color: "var(--ink-mute)" }}>
            <span><i style={legendBar("var(--ink-soft)")} />тезисы ИИ</span>
            <span><i style={legendBar("var(--primary)")} /><b style={{ color: "var(--accent-ink)" }}>твои пометки</b> — жирные</span>
          </div>

          <div style={{ ...card, padding: "22px 26px" }}>
            {real ? <RealResult thesesMd={thesesMd} notes={notes} inline={inline} />
                  : <DemoResult notesBySection={demoNotesBySection} inline={inline} />}
          </div>
          <button onClick={() => setPhase("capture")} style={{ ...btnGhost, marginTop: 16 }}>← Вернуться к записи</button>
        </section>
      )}

      <style>{`@keyframes rlPulse{0%{box-shadow:0 0 0 0 rgba(255,107,94,.5)}70%{box-shadow:0 0 0 8px rgba(255,107,94,0)}100%{box-shadow:0 0 0 0 rgba(255,107,94,0)}}`}</style>
    </main>
  );
}

// Реальный результат: тезисы из draft_notes_md + все пометки (по времени) на полях/инлайн.
function RealResult({ thesesMd, notes, inline }: { thesesMd: string | null; notes: Note[]; inline: boolean }) {
  const sorted = [...notes].sort((a, b) => a.sec - b.sec);
  const margin = (
    <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
      {!inline && <div style={{ ...MONO, fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 1 }}>твои пометки</div>}
      {sorted.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ink-mute)" }}>пометок не было</div>}
      {sorted.map((n, j) => (
        <div key={j} style={inline ? { background: "var(--accent-soft)", borderLeft: "3px solid var(--primary)", borderRadius: 8, padding: "8px 11px" } : { borderLeft: "2px solid var(--primary)", padding: "2px 0 2px 12px" }}>
          <span style={{ ...MONO, fontSize: 10, fontWeight: 600, color: "var(--primary)" }}>{fmt(n.sec)}</span>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent-ink)", marginTop: 4, lineHeight: 1.4 }}>{n.text}</div>
        </div>
      ))}
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: inline ? "1fr" : "1fr 250px", gap: inline ? 14 : 26, alignItems: "start" }}>
      <div style={{ color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.55 }}>
        {thesesMd ? renderTheses(thesesMd) : <p style={{ color: "var(--ink-mute)" }}>Тезисы ещё не готовы (или встреча без расшифровки).</p>}
      </div>
      {margin}
    </div>
  );
}

// Демо-результат: пометки разложены по секциям ПО ВРЕМЕНИ (мок-тезисы).
function DemoResult({ notesBySection, inline }: { notesBySection: Note[][]; inline: boolean }) {
  return (
    <>
      {DEMO_SECTIONS.map((s, i) => {
        const mns = notesBySection[i];
        return (
          <div key={i} style={{ display: "grid", gridTemplateColumns: inline ? "1fr" : "1fr 250px", gap: inline ? 10 : 26, padding: "16px 0", borderTop: i === 0 ? "none" : "1px solid var(--line)", alignItems: "start" }}>
            <div>
              <h3 style={{ ...MONO, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)", margin: "0 0 11px" }}>{s.h} <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}> · {fmt(s.from)}–{fmt(s.to)}</span></h3>
              <div style={{ color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.55 }}>{s.ai}</div>
            </div>
            {mns.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!inline && <div style={{ ...MONO, fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-mute)" }}>твои пометки</div>}
                {mns.map((n, j) => (
                  <div key={j} style={inline ? { background: "var(--accent-soft)", borderLeft: "3px solid var(--primary)", borderRadius: 8, padding: "8px 11px" } : { borderLeft: "2px solid var(--primary)", padding: "2px 0 2px 12px" }}>
                    <span style={{ ...MONO, fontSize: 10, fontWeight: 600, color: "var(--primary)" }}>{fmt(n.sec)}</span>
                    <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent-ink)", marginTop: 4, lineHeight: 1.4 }}>{n.text}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

const wrapStyle: CSSProperties = { minHeight: "100dvh", color: "var(--ink)", padding: "20px 16px 64px", maxWidth: 920, margin: "0 auto" };
const btnStyle: CSSProperties = { border: "none", borderRadius: 9, padding: "10px 14px", cursor: "pointer", fontWeight: 700, fontSize: 13, whiteSpace: "nowrap", background: "linear-gradient(180deg, color-mix(in srgb, var(--primary) 80%, white), var(--primary))", color: "#1a1305" };
const btnGhost: CSSProperties = { border: "1px solid var(--line)", borderRadius: 9, padding: "9px 14px", cursor: "pointer", fontWeight: 600, fontSize: 13, background: "transparent", color: "var(--ink-soft)" };
function legendBar(c: string): CSSProperties { return { display: "inline-block", width: 22, height: 0, borderTop: `3px solid ${c}`, verticalAlign: "middle", marginRight: 7, borderRadius: 2 }; }
