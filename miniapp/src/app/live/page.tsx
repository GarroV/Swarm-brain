"use client";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

// «Рой Live» — companion-экран встречи (Granola-режим).
// Фаза 1: реальный standalone-роут /live с локальными данными — захват свободных
// «пометок на полях» с тайм-штампами + результат, где тезисы ИИ склеены с пометками
// ПО ВРЕМЕНИ (пометка ложится в секцию, чей временной диапазон её содержит).
// Захват звука — за нативным рекордером; этот экран ляжет в его WKWebView и
// одновременно открывается напрямую на /live. Бэкенд/авторизация — Фаза 2.

type Note = { sec: number; text: string };
type Section = { h: string; from: number; to: number; ai: React.ReactNode };

const MONO: CSSProperties = { fontFamily: "var(--font-geist-mono), ui-monospace, Menlo, monospace" };
const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

// Тезисы ИИ (Фаза 1 — пример; в Фазе 2 придут из транскрипта). Диапазоны — смещение в записи.
const SECTIONS: Section[] = [
  { h: "Темы", from: 0, to: 240, ai: (
    <p style={{ margin: 0 }}>Обсуждали модель <b>«1 управляющий на N точек»</b>: где предел нагрузки, что делегировать, как мерить эффект.</p>
  ) },
  { h: "Решения", from: 240, to: 450, ai: (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>Запускаем <b>пилот в KZ</b> на 3 точках.</li>
      <li>Метрика пилота — себестоимость смены.</li>
    </ul>
  ) },
  { h: "Задачи", from: 450, to: 600, ai: (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      <li>Подготовить чек-лист управляющего — <b>Ксения, до 30 июня</b>.</li>
      <li>Собрать данные по текущей нагрузке точек.</li>
    </ul>
  ) },
];

// Пусто на старте — пометки только те, что напишет пользователь (никаких чужих примеров).
const INITIAL_NOTES: Note[] = [];

function sectionIndexForTime(sec: number): number {
  const i = SECTIONS.findIndex((s) => sec >= s.from && sec < s.to);
  return i === -1 ? SECTIONS.length - 1 : i; // позже конца → последняя секция
}

export default function LivePage() {
  const [phase, setPhase] = useState<"capture" | "result">("capture");
  const [notes, setNotes] = useState<Note[]>(INITIAL_NOTES);
  const [elapsed, setElapsed] = useState(0);
  const [draft, setDraft] = useState("");
  const [inline, setInline] = useState(false);
  const [recorderHost, setRecorderHost] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Открыт в панели нативного рекордера? (?host=recorder) — тогда пометки уходят в нативный
  // буфер, а meetingId появится только на стопе (claim). Иначе — обычный веб-режим.
  useEffect(() => {
    setRecorderHost(new URLSearchParams(window.location.search).get("host") === "recorder");
  }, []);

  // Тикающий таймер записи (фаза захвата) — даёт «время» новым пометкам.
  useEffect(() => {
    if (phase !== "capture") return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Узкая ширина (док-панель рекордера) → маргиналии сворачиваются в инлайн.
  useEffect(() => {
    const apply = () => setInline(window.innerWidth < 720);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const addNote = () => {
    const t = draft.trim();
    if (!t) return;
    setNotes((n) => [...n, { sec: elapsed, text: t }]);
    // В панели рекордера дублируем пометку в нативный буфер: на стопе (когда claim даст
    // meetingId) рекордер сольёт буфер к встрече. window.webkit есть только в WKWebView.
    if (recorderHost) {
      try {
        (window as unknown as {
          webkit?: { messageHandlers?: { royNotes?: { postMessage: (m: unknown) => void } } };
        }).webkit?.messageHandlers?.royNotes?.postMessage({ offset_sec: elapsed, text: t });
      } catch { /* не в нативной панели — игнор */ }
    }
    setDraft("");
    inputRef.current?.focus();
  };

  // Склейка по времени: пометки группируются по секции, чей диапазон их содержит.
  const notesBySection = useMemo(() => {
    const map: Note[][] = SECTIONS.map(() => []);
    [...notes].sort((a, b) => a.sec - b.sec).forEach((n) => map[sectionIndexForTime(n.sec)].push(n));
    return map;
  }, [notes]);

  const card: CSSProperties = {
    background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 16,
    backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
  };

  return (
    <main style={{ minHeight: "100dvh", color: "var(--ink)", padding: "20px 16px 64px", maxWidth: 920, margin: "0 auto" }}>
      {/* шапка встречи */}
      <header style={{ ...card, borderColor: "color-mix(in srgb, var(--primary) 30%, transparent)", display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", marginBottom: 14 }}>
        {phase === "capture" ? (
          <span style={{ display: "flex", alignItems: "center", gap: 7, ...MONO, fontSize: 11, letterSpacing: ".1em", color: "#ff6b5e", fontWeight: 600 }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#ff6b5e", animation: "rlPulse 1.6s infinite" }} />REC
          </span>
        ) : (
          <span style={{ ...MONO, fontSize: 11, letterSpacing: ".1em", color: "var(--status-done)", fontWeight: 600 }}>✓ ГОТОВО</span>
        )}
        <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Discovery: практика «1 управляющий»
        </span>
        <span style={{ ...MONO, fontSize: 12, color: "var(--ink-soft)" }}>{fmt(elapsed)}</span>
      </header>

      {phase === "capture" ? (
        <section style={{ ...card, padding: "15px 17px 17px" }}>
          <p style={{ margin: "0 0 13px", fontSize: 12, color: "var(--ink-mute)", display: "flex", gap: 8 }}>
            <span>📝</span>
            <span><b style={{ color: "var(--ink-soft)", fontWeight: 600 }}>Пометки на полях</b> — пиши свободно. Каждая запоминает время, чтобы потом лечь рядом с нужным тезисом.</span>
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 130, marginBottom: 13 }}>
            {notes.length === 0 && (
              <div style={{ ...MONO, fontSize: 11.5, color: "var(--ink-mute)", padding: "10px 0", letterSpacing: ".02em" }}>
                пометок пока нет — пиши ниже, каждая поймает время записи
              </div>
            )}
            {notes.map((n, i) => (
              <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span style={{ ...MONO, fontSize: 10.5, fontWeight: 600, color: "var(--accent-ink)", background: "var(--accent-soft)", borderRadius: 6, padding: "3px 7px", flex: "none" }}>{fmt(n.sec)}</span>
                <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.45 }}>{n.text}</span>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addNote(); }}
              placeholder="пометка на полях…"
              style={{ flex: 1, background: "color-mix(in srgb, var(--ink) 6%, transparent)", border: "1px solid var(--line)", borderRadius: 9, padding: "10px 12px", color: "var(--ink)", fontSize: 13.5, outline: "none" }}
            />
            <button onClick={addNote} style={btnStyle}>+</button>
          </div>

          {recorderHost ? (
            <p style={{ ...MONO, textAlign: "center", fontSize: 11, color: "var(--ink-mute)", margin: "13px 0 0", letterSpacing: ".02em", lineHeight: 1.5 }}>
              пометки сохраняются к встрече автоматически<br />тезисы появятся после завершения записи
            </p>
          ) : (
            <>
              <button onClick={() => setPhase("result")} style={{ ...btnStyle, width: "100%", marginTop: 13, padding: "12px" }}>
                ✦ Готово — собрать тезисы
              </button>
              <p style={{ ...MONO, textAlign: "center", fontSize: 10.5, color: "var(--ink-mute)", margin: "11px 0 0", letterSpacing: ".02em" }}>
                транскрипт идёт фоном · показывается ПОСЛЕ встречи, не по ходу
              </p>
            </>
          )}
        </section>
      ) : (
        <section>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 6 }}>
            <h1 style={{ fontSize: 21, margin: 0, letterSpacing: "-.01em" }}>Discovery: практика «1 управляющий»</h1>
            <span style={{ ...MONO, fontSize: 11.5, color: "var(--ink-mute)" }}>26 июня · 28 мин · KZ</span>
            <span style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 4, background: "color-mix(in srgb, var(--ink) 8%, transparent)", border: "1px solid var(--line)", borderRadius: 10, padding: 3 }}>
              {([["margin", "На полях"], ["inline2", "Инлайн"]] as const).map(([k, label]) => {
                const active = (k === "inline2") === inline;
                return (
                  <button key={k} onClick={() => setInline(k === "inline2")}
                    style={{ border: "none", background: active ? "var(--accent-soft)" : "transparent", color: active ? "var(--accent-ink)" : "var(--ink-soft)", fontWeight: 600, fontSize: 12, padding: "7px 12px", borderRadius: 7, cursor: "pointer" }}>
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", margin: "12px 0 16px", fontSize: 12, color: "var(--ink-mute)" }}>
            <span><i style={legendBar("var(--ink-soft)")} />тезисы ИИ (из транскрипта)</span>
            <span><i style={legendBar("var(--primary)")} /><b style={{ color: "var(--accent-ink)" }}>твои пометки</b> — жирные, привязаны по времени</span>
          </div>

          <div style={{ ...card, padding: "22px 26px" }}>
            {SECTIONS.map((s, i) => {
              const mns = notesBySection[i];
              return (
                <div key={i} style={{
                  display: "grid",
                  gridTemplateColumns: inline ? "1fr" : "1fr 240px",
                  gap: inline ? 10 : 26,
                  padding: "16px 0",
                  borderTop: i === 0 ? "none" : "1px solid var(--line)",
                  alignItems: "start",
                }}>
                  <div>
                    <h3 style={{ ...MONO, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--primary)", margin: "0 0 11px" }}>
                      {s.h} <span style={{ color: "var(--ink-mute)", fontWeight: 400 }}> · {fmt(s.from)}–{fmt(s.to)}</span>
                    </h3>
                    <div style={{ color: "var(--ink-soft)", fontSize: 14.5, lineHeight: 1.55 }}>{s.ai}</div>
                  </div>

                  {mns.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {!inline && <div style={{ ...MONO, fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--ink-mute)", marginBottom: 1 }}>твои пометки</div>}
                      {mns.map((n, j) => (
                        <div key={j} style={inline
                          ? { background: "var(--accent-soft)", borderLeft: "3px solid var(--primary)", borderRadius: 8, padding: "8px 11px" }
                          : { borderLeft: "2px solid var(--primary)", padding: "2px 0 2px 12px" }}>
                          <span style={{ ...MONO, fontSize: 10, fontWeight: 600, color: "var(--primary)" }}>{fmt(n.sec)}</span>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--accent-ink)", marginTop: 4, lineHeight: 1.4 }}>{n.text}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button onClick={() => setPhase("capture")} style={{ ...btnGhost, marginTop: 16 }}>← Вернуться к записи</button>
        </section>
      )}

      <style>{`@keyframes rlPulse{0%{box-shadow:0 0 0 0 rgba(255,107,94,.5)}70%{box-shadow:0 0 0 8px rgba(255,107,94,0)}100%{box-shadow:0 0 0 0 rgba(255,107,94,0)}}`}</style>
    </main>
  );
}

const btnStyle: CSSProperties = {
  border: "none", borderRadius: 9, padding: "10px 14px", cursor: "pointer",
  fontWeight: 700, fontSize: 13, whiteSpace: "nowrap",
  background: "linear-gradient(180deg, color-mix(in srgb, var(--primary) 80%, white), var(--primary))",
  color: "#1a1305",
};
const btnGhost: CSSProperties = {
  border: "1px solid var(--line)", borderRadius: 9, padding: "9px 14px", cursor: "pointer",
  fontWeight: 600, fontSize: 13, background: "transparent", color: "var(--ink-soft)",
};
function legendBar(c: string): CSSProperties {
  return { display: "inline-block", width: 22, height: 0, borderTop: `3px solid ${c}`, verticalAlign: "middle", marginRight: 7, borderRadius: 2 };
}
