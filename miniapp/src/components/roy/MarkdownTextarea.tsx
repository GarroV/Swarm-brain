"use client";
import { useRef } from "react";

// Textarea для markdown-тезисов + мини-тулбар форматирования по ВЫДЕЛЕНИЮ.
// Тезисы хранятся как markdown (его рендерит TezisyBlocks: «### Тема» — раздел, «- » — пункт,
// «**текст**» — жирный), поэтому кнопки вставляют именно markdown в текущее выделение/строку.
// Важно: на кнопках onMouseDown→preventDefault, иначе клик уводит фокус из textarea и сбрасывает
// выделение до того, как мы его прочитаем.

type Props = {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
};

export function MarkdownTextarea({ value, onChange, disabled, autoFocus }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // После programmatic-изменения value возвращаем фокус и выделение (React успевает перерисовать
  // textarea к следующему кадру → setSelectionRange попадает в уже обновлённое значение).
  const restore = (a: number, b: number) => {
    const ta = ref.current;
    if (!ta) return;
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(a, b); });
  };

  // Обернуть выделение парными маркерами (**жирный**). Без выделения — плейсхолдер «текст».
  const wrap = (marker: string) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e) || "текст";
    onChange(v.slice(0, s) + marker + sel + marker + v.slice(e));
    restore(s + marker.length, s + marker.length + sel.length);
  };

  // Префикс к началу каждой строки в выделении (### / - ). Берём ЦЕЛЫЕ строки, задетые выделением.
  const prefixLines = (prefix: string) => {
    const ta = ref.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const lineStart = v.lastIndexOf("\n", s - 1) + 1;
    const nl = v.indexOf("\n", e);
    const lineEnd = nl === -1 ? v.length : nl;
    const block = v.slice(lineStart, lineEnd);
    const replaced = block.split("\n").map((ln) => prefix + ln).join("\n");
    onChange(v.slice(0, lineStart) + replaced + v.slice(lineEnd));
    restore(lineStart, lineStart + replaced.length);
  };

  return (
    <div>
      <div className="mb-2 inline-flex items-center gap-0.5 rounded-[10px] border border-line bg-surface px-1 py-0.5">
        <IcoBtn title="Жирный" d={ICON.bold} onClick={() => wrap("**")} />
        <span className="mx-0.5 self-stretch w-px bg-line-2" style={{ marginTop: 5, marginBottom: 5 }} />
        <IcoBtn title="Заголовок раздела" d={ICON.heading} onClick={() => prefixLines("### ")} />
        <IcoBtn title="Список" d={ICON.list} onClick={() => prefixLines("- ")} />
      </div>
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full resize-y rounded-[14px] border border-line-2 bg-surface px-4 py-3 text-ink outline-none focus:border-primary disabled:opacity-50"
        style={{ minHeight: "clamp(300px, 52vh, 680px)", fontSize: 14, lineHeight: 1.6, fontFamily: "ui-monospace, monospace" }}
      />
      <p className="mt-1 text-ink-mute" style={{ fontSize: 11 }}>
        Выделите текст и нажмите кнопку. Markdown: «### Тема» — раздел, «- » — пункт, «**текст**» — жирный.
      </p>
    </div>
  );
}

// Минимальные иконки тулбара (Lucide-style, stroke, viewBox 24). Только самое необходимое.
const ICON = {
  bold: "M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z",
  heading: "M6 12h12 M6 20V4 M18 20V4",
  list: "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
};

function IcoBtn({ title, d, onClick }: { title: string; d: string; onClick: () => void }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-[8px] text-ink-soft transition-colors hover:bg-surface-2 hover:text-ink active:scale-[0.94]"
      style={{ width: 30, height: 30 }}
    >
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={d} />
      </svg>
    </button>
  );
}
