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
      <div className="mb-1.5 flex items-center gap-1.5">
        <ToolBtn label="Раздел" title="Заголовок раздела (###)" onClick={() => prefixLines("### ")} />
        <ToolBtn label="Пункт" title="Пункт списка (-)" onClick={() => prefixLines("- ")} />
        <ToolBtn label="Ж" title="Жирный (**)" bold onClick={() => wrap("**")} />
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

function ToolBtn({ label, title, onClick, bold }: { label: string; title: string; onClick: () => void; bold?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center justify-center rounded-[9px] border border-line bg-surface text-ink-soft transition-[transform,border-color,background] duration-150 hover:scale-[1.04] hover:border-line-2 hover:bg-surface-2 active:scale-[0.96]"
      style={{ padding: "5px 11px", fontSize: 12.5, fontWeight: bold ? 800 : 600, minWidth: bold ? 34 : undefined }}
    >
      {label}
    </button>
  );
}
