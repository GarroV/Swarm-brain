"use client";
import { useEffect, useRef, useState } from "react";
import type { TezisyCopyMeta } from "@/lib/tezisyCopy";
import { TezisyBlocks } from "../ui";
import { AskChip, AskPopover, type AskAnchor, type AskApply } from "./AskPopover";

// Тезисы в режиме чтения + точечный вопрос по выделенному (решение владельца 2026-09-30).
// Выделил кусок — у выделения кнопка «Спросить»; ответ можно вставить в тезисы: тогда карточка
// переходит в правку со вставленным ответом, сохраняет человек (onApply → родитель).

type Picked = { text: string; anchor: AskAnchor };

const MIN_SELECTION = 3;

export function TezisyReader({ text, copyMeta, ask, onApply }: {
  text: string;
  copyMeta?: TezisyCopyMeta;
  ask?: (fragment: string, question: string) => Promise<string>;
  onApply?: (answer: string, mode: AskApply, fragment: string) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [asking, setAsking] = useState<Picked | null>(null);

  useEffect(() => {
    if (!ask) return;
    const onChange = () => {
      const sel = window.getSelection();
      const box = boxRef.current;
      if (!sel || sel.isCollapsed || !box || !sel.rangeCount) { setPicked(null); return; }
      const range = sel.getRangeAt(0);
      if (!box.contains(range.commonAncestorContainer)) { setPicked(null); return; }
      const picked = sel.toString().trim();
      if (picked.length < MIN_SELECTION) { setPicked(null); return; }
      const r = range.getBoundingClientRect();
      setPicked({ text: picked, anchor: { top: r.top, bottom: r.bottom, left: r.left } });
    };
    // Прокрутка уводит выделение от кнопки — прячем, выделение остаётся.
    const onScroll = () => setPicked(null);
    document.addEventListener("selectionchange", onChange);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [ask]);

  const apply = onApply && asking
    ? (answer: string, mode: AskApply) => { const f = asking.text; setAsking(null); onApply(answer, mode, f); }
    : undefined;

  return (
    <div ref={boxRef}>
      <TezisyBlocks text={text} copyMeta={copyMeta} />
      {ask && picked && !asking && <AskChip anchor={picked.anchor} onOpen={() => setAsking(picked)} />}
      {ask && asking && (
        <AskPopover anchor={asking.anchor} fragment={asking.text} ask={ask} onApply={apply} onClose={() => setAsking(null)} />
      )}
    </div>
  );
}
