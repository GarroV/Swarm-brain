// Транскрипт вычитки → простой текст для буфера: ровно то, что видно на экране.
// Подпись говорящего — отдельной строкой при смене говорящего (`speakerLabelAt`), дальше строки
// «время  текст»; между блоками разных говорящих — пустая строка. Подпись и время приходят
// функциями (`speakerLabelAt`, `fmtClock` экрана) — чтобы не дублировать их здесь.

export type TranscriptSegment = { start: number; text: string; speaker?: string };

export function transcriptToText(
  segments: ReadonlyArray<TranscriptSegment>,
  opts: { speakerAt: (i: number) => string | null; fmtTime: (startSec: number) => string },
): string {
  const lines: string[] = [];
  segments.forEach((sg, i) => {
    const speaker = opts.speakerAt(i);
    if (speaker) {
      if (lines.length > 0) lines.push("");
      lines.push(speaker);
    }
    lines.push(`${opts.fmtTime(sg.start)}  ${sg.text}`);
  });
  return lines.join("\n");
}
