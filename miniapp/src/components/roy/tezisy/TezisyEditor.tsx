"use client";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  applyAskAnswer, clearedLines, linesToTezisy, replaceAllWithChar, replaceAllWithText, tezisyToLines, type TezisyLine,
} from "@/lib/tezisyLines";
import { useDt } from "../nav";
import { AskChip, AskPopover, type AskAnchor, type AskApply } from "./AskPopover";

// Правка тезисов на месте (решение владельца 2026-09-30: «при нажатии редактирования у нас
// текст как есть будет»). Вместо поля с сырой разметкой — те же заголовки и пункты, что при
// чтении (TezisyBlocks), тем же шрифтом и с теми же отступами; каждая строка — растущее поле.
// Enter — новый пункт, Backspace в начале — склеить с предыдущим, Tab — заголовок ⇄ пункт,
// ⌘/Ctrl+Enter — сохранить, Esc — отменить. Хранится тот же markdown (lib/tezisyLines.ts).
// Выделение не переходит через строки-поля, поэтому «выделить всё и заменить» — отдельный режим
// (жалоба владельца 2026-10-15): ⌘/Ctrl+A выделяет строку, повторное — все строки (allSelected,
// подсветка). В нём вставка заменяет все тезисы, Backspace/Delete/Enter очищает, печатный символ
// заменяет всё одной строкой, ⌘C/⌘X берут весь markdown; Esc снимает выделение (отмена — вторым
// Esc), клик, стрелки, Tab и уход фокуса выходят без изменений. Кнопка «Очистить всё» — то же
// очищение без клавиатуры; «Отмена» вернёт исходный текст (вызывающие держат черновик отдельно).
// data-panel-edit — DetailPanel не закрывает панель по Esc, пока фокус внутри правки.

type Focus = { index: number; caret: number };
type Selected = { index: number; text: string; anchor: AskAnchor };

const LINE_FONT = { fontSize: 14, lineHeight: 1.625 } as const;

function gapBefore(lines: readonly TezisyLine[], i: number): number {
  if (i === 0) return 0;
  const cur = lines[i].kind;
  if (cur === "heading") return 14;
  return cur === "bullet" && lines[i - 1].kind === "bullet" ? 4 : 9;
}

export function TezisyEditor({ value, onChange, onSave, onCancel, busy, label, ask }: {
  value: string;
  onChange: (md: string) => void;
  onSave: () => void;
  onCancel: () => void;
  busy?: boolean;
  label: string;
  /** Точечный вопрос по выделенному; нет — кнопка «Спросить» не появляется. */
  ask?: (fragment: string, question: string) => Promise<string>;
}) {
  const dt = useDt();
  const [lines, setLinesState] = useState<TezisyLine[]>(() => tezisyToLines(value));
  const refs = useRef<Array<HTMLTextAreaElement | null>>([]);
  // Открыли правку — курсор в конец последней строки, как у прежнего поля с autoFocus.
  const pending = useRef<Focus | null>({ index: lines.length - 1, caret: lines[lines.length - 1].text.length });
  const [selected, setSelected] = useState<Selected | null>(null);
  const [asking, setAsking] = useState<Selected | null>(null);
  const [allSelected, setAllSelected] = useState(false);

  const setLines = useCallback((next: TezisyLine[], focus?: Focus) => {
    pending.current = focus ?? null;
    setLinesState(next);
    onChange(linesToTezisy(next));
  }, [onChange]);

  const focusLine = (f: Focus) => {
    const el = refs.current[f.index];
    if (!el) return;
    el.focus();
    el.setSelectionRange(f.caret, f.caret);
  };

  useLayoutEffect(() => {
    const f = pending.current;
    if (!f) return;
    pending.current = null;
    focusLine(f);
  }, [lines]);

  const replaceAll = (next: TezisyLine[]) => {
    setAllSelected(false);
    setSelected(null);
    setLines(next, { index: next.length - 1, caret: next[next.length - 1].text.length });
  };

  const update = (i: number, text: string) => {
    // Ввод мимо keydown (раскладка, IME): строка была выделена целиком, браузер заменил только её —
    // в режиме «выделено всё» остальное тоже уходит, как при печатном символе.
    if (allSelected) { replaceAll(replaceAllWithChar(text)); return; }
    setLines(lines.map((l, j) => (j === i ? { ...l, text: text.replace(/\n/g, " ") } : l)));
  };

  const onKeyDown = (i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return;
    const el = e.currentTarget;
    const { selectionStart: start, selectionEnd: end } = el;
    const line = lines[i];
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Enter" && mod) { e.preventDefault(); if (!busy) onSave(); return; }
    if (allSelected) {
      if (e.key === "Escape") { e.preventDefault(); setAllSelected(false); return; }
      if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); return; }
      if (e.key === "Backspace" || e.key === "Delete" || e.key === "Enter") { e.preventDefault(); replaceAll(clearedLines()); return; }
      if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); replaceAll(replaceAllWithChar(e.key)); return; }
      // ⌘C/⌘X обрабатывают onCopy/onCut; остальные клавиши (стрелки, Tab…) выводят из режима.
      if (!mod && e.key !== "Shift" && e.key !== "Alt" && e.key !== "Control" && e.key !== "Meta") setAllSelected(false);
    }
    if (e.key === "Escape") { e.preventDefault(); onCancel(); return; }
    if (mod && e.key.toLowerCase() === "a" && start === 0 && end === line.text.length) {
      e.preventDefault();
      setSelected(null);
      setAllSelected(true);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const head = { ...line, text: line.text.slice(0, start) };
      const tail: TezisyLine = { kind: line.kind === "heading" ? "bullet" : line.kind, text: line.text.slice(end) };
      setLines([...lines.slice(0, i), head, tail, ...lines.slice(i + 1)], { index: i + 1, caret: 0 });
      return;
    }
    if (e.key === "Backspace" && start === 0 && end === 0) {
      if (i === 0 && line.text) return;
      e.preventDefault();
      if (lines.length === 1) { setLines([{ kind: "bullet", text: "" }], { index: 0, caret: 0 }); return; }
      if (i === 0) { setLines(lines.slice(1), { index: 0, caret: 0 }); return; }
      const prev = lines[i - 1];
      const merged = { ...prev, text: prev.text + line.text };
      setLines([...lines.slice(0, i - 1), merged, ...lines.slice(i + 1)], { index: i - 1, caret: prev.text.length });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const kind = e.shiftKey || line.kind === "heading" ? "bullet" : "heading";
      setLines(lines.map((l, j) => (j === i ? { ...l, kind } : l)), { index: i, caret: start });
      return;
    }
    if (e.key === "ArrowUp" && start === 0 && end === 0 && i > 0) {
      e.preventDefault();
      focusLine({ index: i - 1, caret: lines[i - 1].text.length });
      return;
    }
    if (e.key === "ArrowDown" && start === line.text.length && end === start && i < lines.length - 1) {
      e.preventDefault();
      focusLine({ index: i + 1, caret: 0 });
    }
  };

  // Вставка нескольких строк (из заметок, из буфера) разбирается как тезисы, а не склеивается.
  const onPaste = (i: number, e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData("text/plain");
    if (allSelected) { e.preventDefault(); replaceAll(replaceAllWithText(text)); return; }
    if (!text.includes("\n")) return;
    e.preventDefault();
    const { selectionStart: start, selectionEnd: end } = e.currentTarget;
    const line = lines[i];
    const pasted = tezisyToLines(text).filter((l) => l.text);
    if (!pasted.length) return;
    const first = { ...line, text: line.text.slice(0, start) + pasted[0].text };
    const rest = pasted.slice(1);
    const lastIdx = rest.length - 1;
    const after = line.text.slice(end);
    const tailed = lastIdx >= 0
      ? rest.map((l, j) => (j === lastIdx ? { ...l, text: l.text + after } : l))
      : [];
    const head = lastIdx >= 0 ? first : { ...first, text: first.text + after };
    const caretLine = lastIdx >= 0 ? rest[lastIdx] : pasted[0];
    const caret = (lastIdx >= 0 ? 0 : start) + caretLine.text.length;
    setLines([...lines.slice(0, i), head, ...tailed, ...lines.slice(i + 1)], { index: i + rest.length, caret });
  };

  // ⌘C/⌘X в режиме «выделено всё» берут весь markdown, а не одну строку.
  const onCopyCut = (e: React.ClipboardEvent, cut: boolean) => {
    if (!allSelected) return;
    e.preventDefault();
    e.clipboardData.setData("text/plain", linesToTezisy(lines));
    if (cut) replaceAll(clearedLines());
  };

  const onSelect = (i: number, el: HTMLTextAreaElement) => {
    if (!ask) return;
    const text = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    if (text.length < 3) { setSelected(null); return; }
    const r = el.getBoundingClientRect();
    setSelected({ index: i, text, anchor: { top: r.top, bottom: r.bottom, left: r.left } });
  };

  const apply = (answer: string, mode: AskApply) => {
    const at = asking?.index ?? -1;
    const next = applyAskAnswer(lines, at, answer, mode);
    setAsking(null);
    setLines(next, { index: Math.min(at + 1, next.length - 1), caret: 0 });
  };

  return (
    <div data-panel-edit className="mb-4 flex flex-col">
      <div role="group" aria-label={label} data-all-selected={allSelected || undefined}
        className="flex flex-col rounded-[10px] px-4 py-3.5"
        onMouseDown={() => setAllSelected(false)}
        onCopy={(e) => onCopyCut(e, false)}
        onCut={(e) => onCopyCut(e, true)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setAllSelected(false); }}
        style={{ background: "var(--accent-soft)", border: "1px dashed var(--accent-line)" }}>
        {lines.map((l, i) => (
          <div key={i} className={l.kind === "bullet" ? "flex items-start" : "flex"}
            style={{ marginTop: gapBefore(lines, i), gap: 8 }}>
            {l.kind === "bullet" && <span className="select-none text-ink-mute" style={{ ...LINE_FONT, marginTop: 1 }}>•</span>}
            <GrowingLine
              value={l.text}
              heading={l.kind === "heading"}
              highlighted={allSelected}
              placeholder={l.kind === "heading" ? dt("Заголовок", "Heading") : dt("Пункт", "Point")}
              inputRef={(el) => { refs.current[i] = el; }}
              onChange={(t) => update(i, t)}
              onKeyDown={(e) => onKeyDown(i, e)}
              onPaste={(e) => onPaste(i, e)}
              onSelect={(el) => onSelect(i, el)}
              onBlur={() => setSelected(null)}
            />
          </div>
        ))}
      </div>
      <p className="mt-1.5 px-1 text-ink-mute" style={{ fontSize: 11 }}>
        {ask
          ? dt("Enter — новый пункт · Tab — заголовок · выдели текст, чтобы спросить", "Enter — new point · Tab — heading · select text to ask about it")
          : dt("Enter — новый пункт · Tab — заголовок", "Enter — new point · Tab — heading")}
      </p>
      <div className="sticky bottom-0 mt-2 flex items-center gap-2 bg-background py-2">
        <button type="button" onClick={onSave} disabled={busy} title="⌘/Ctrl+Enter"
          className="flex-1 rounded-full bg-primary py-2.5 font-semibold text-primary-foreground disabled:opacity-60" style={{ fontSize: 14 }}>
          {busy ? dt("Сохраняю…", "Saving…") : dt("Сохранить", "Save")}
        </button>
        <button type="button" onClick={() => replaceAll(clearedLines())}
          className="rounded-full border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>
          {dt("Очистить всё", "Clear all")}
        </button>
        <button type="button" onClick={onCancel} title="Esc"
          className="rounded-full border border-line-2 px-4 py-2.5 font-semibold text-ink-soft" style={{ fontSize: 14 }}>
          {dt("Отмена", "Cancel")}
        </button>
      </div>
      {ask && selected && !asking && <AskChip anchor={selected.anchor} onOpen={() => setAsking(selected)} />}
      {ask && asking && (
        <AskPopover anchor={asking.anchor} fragment={asking.text} ask={ask} onApply={apply} onClose={() => setAsking(null)} />
      )}
    </div>
  );
}

function GrowingLine({ value, heading, highlighted, placeholder, inputRef, onChange, onKeyDown, onPaste, onSelect, onBlur }: {
  value: string;
  heading: boolean;
  highlighted: boolean;
  placeholder: string;
  inputRef: (el: HTMLTextAreaElement | null) => void;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onSelect: (el: HTMLTextAreaElement) => void;
  onBlur: () => void;
}) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  // Высота по содержимому: поле растёт вместе с текстом, как абзац при чтении. Ширина панели
  // меняется (ресайз окна) — перемеряем.
  useLayoutEffect(() => {
    const el = own.current;
    if (!el) return;
    const fit = () => { el.style.height = "0px"; el.style.height = `${el.scrollHeight}px`; };
    fit();
    // Следим только за шириной: высоту меняет сам fit, иначе наблюдатель будил бы себя.
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return (
    <textarea
      ref={(el) => { own.current = el; inputRef(el); }}
      value={value}
      rows={1}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onSelect={(e) => onSelect(e.currentTarget)}
      onBlur={onBlur}
      className={`block w-full flex-1 resize-none overflow-hidden border-0 bg-transparent p-0 text-ink outline-none placeholder:text-ink-mute ${heading ? "font-semibold" : ""}`}
      style={{
        ...LINE_FONT,
        letterSpacing: heading ? "-0.01em" : undefined,
        // «Выделено всё»: подсветка как у выделения, тем же токеном в обеих темах.
        ...(highlighted ? { background: "var(--accent-line)", borderRadius: 3 } : null),
      }}
    />
  );
}
