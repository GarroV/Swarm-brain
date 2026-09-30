// Тезисы встречи как список строк для правки на месте (TezisyEditor). Хранится по-прежнему
// markdown-текст узкого формата «### Тема» + «- тезис» — тот же, что разбирает TezisyBlocks;
// здесь только перевод туда и обратно. Канонический текст переживает круг без изменений —
// иначе одно открытие редактора молча переписывало бы тезисы.

export type TezisyLineKind = "heading" | "bullet" | "para";
export type TezisyLine = { kind: TezisyLineKind; text: string };

const HEADING = /^#{1,6}\s+(.+)$/;
const BULLET = /^[-*•]\s+(.+)$/;

export function tezisyToLines(src: string): TezisyLine[] {
  const lines: TezisyLine[] = [];
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) continue;
    const heading = t.match(HEADING);
    if (heading) { lines.push({ kind: "heading", text: heading[1].trim() }); continue; }
    const bullet = t.match(BULLET);
    lines.push(bullet ? { kind: "bullet", text: bullet[1].trim() } : { kind: "para", text: t });
  }
  return lines.length ? lines : [{ kind: "bullet", text: "" }];
}

export function linesToTezisy(lines: readonly TezisyLine[]): string {
  const out: string[] = [];
  for (const l of lines) {
    const text = l.text.trim();
    if (!text) continue;
    if (l.kind === "heading") {
      if (out.length) out.push("");
      out.push(`### ${text}`);
    } else {
      out.push(l.kind === "bullet" ? `- ${text}` : text);
    }
  }
  return out.join("\n");
}

export function insertAfter(lines: readonly TezisyLine[], index: number, extra: readonly TezisyLine[]): TezisyLine[] {
  const at = Math.min(Math.max(index + 1, 0), lines.length);
  return [...lines.slice(0, at), ...extra, ...lines.slice(at)];
}

export function replaceAt(lines: readonly TezisyLine[], index: number, extra: readonly TezisyLine[]): TezisyLine[] {
  if (index < 0 || index >= lines.length) return insertAfter(lines, lines.length - 1, extra);
  return [...lines.slice(0, index), ...extra, ...lines.slice(index + 1)];
}

const squash = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Строка, к которой относится выделенный в режиме чтения текст: последняя из строк, где
 * встречается хоть один кусок выделения (выделение может захватить несколько пунктов — ответ
 * встаёт под последним). -1 — не нашли (тогда ответ добавляется в конец).
 */
export function findLineOf(lines: readonly TezisyLine[], selection: string): number {
  let found = -1;
  for (const piece of selection.split("\n").map(squash).filter(Boolean)) {
    for (let i = lines.length - 1; i > found; i--) {
      if (squash(lines[i].text).includes(piece)) { found = i; break; }
    }
  }
  return found;
}

/**
 * Вставить ответ на точечный вопрос (пункты «- …») под строкой `index` или вместо неё.
 * index -1 (строку не нашли) — ответ встаёт в конец.
 */
export function applyAskAnswer(
  lines: readonly TezisyLine[],
  index: number,
  answer: string,
  mode: "insert" | "replace",
): TezisyLine[] {
  const extra = tezisyToLines(answer).filter((l) => l.text.trim());
  if (!extra.length) return [...lines];
  if (index < 0) return insertAfter(lines, lines.length - 1, extra);
  return mode === "replace" ? replaceAt(lines, index, extra) : insertAfter(lines, index, extra);
}

/** То же для режима чтения: строку ищем по выделенному тексту, вход и выход — markdown. */
export function applyAskAnswerToText(md: string, fragment: string, answer: string, mode: "insert" | "replace"): string {
  const lines = tezisyToLines(md);
  return linesToTezisy(applyAskAnswer(lines, findLineOf(lines, fragment), answer, mode));
}
