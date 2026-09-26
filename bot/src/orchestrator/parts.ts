/**
 * Части записи: от списка сегментов ffmpeg до очереди выгрузки.
 *
 * ffmpeg (`-segment_list … -segment_list_type csv`) дописывает строку в список, когда часть
 * ЗАКРЫТА: `part-000.m4a,0.000000,900.021333`. Значит, всё, что есть в списке, можно
 * отдавать в очередь сразу, не дожидаясь конца встречи, — и если контейнер умрёт посреди
 * встречи, закрытые части уже лежат в очереди на томе, который его переживает.
 */

export interface SegmentEntry {
  readonly file: string;
  /**
   * Начало части от старта записи, секунды: это и есть `offset` в манифесте meeting-ingest.
   */
  readonly start: number;
}

/**
 * Разбор списка сегментов. Недописанная последняя строка (ffmpeg пишет её прямо сейчас)
 * пропускается — она придёт целой в следующий раз. Имя с путём внутри отвергается: часть
 * читается из своего каталога, и `../` в имени увёл бы чтение за его пределы.
 */
export function parseSegmentList(text: string): SegmentEntry[] {
  const entries: SegmentEntry[] = [];
  const lines = text.split("\n");
  const isComplete = text.endsWith("\n");
  const usable = isComplete ? lines : lines.slice(0, -1);

  for (const line of usable) {
    const [file = "", start = ""] = line.trim().split(",", 2);
    if (file === "" || file.includes("/") || file.includes("\\")) continue;
    const offset = Number(start);
    if (start === "" || !Number.isFinite(offset) || offset < 0) continue;
    entries.push({ file, start: offset });
  }
  return entries;
}

export interface PartStagerOptions {
  /**
   * Прочитать список сегментов; `null` — списка ещё нет (ни одна часть не закрыта).
   */
  readonly readList: () => Promise<string | null>;
  /**
   * Отдать часть в очередь. Бросает — часть остаётся неотданной и уйдёт в следующий раз.
   */
  readonly stage: (entry: SegmentEntry) => Promise<void>;
}

/**
 * Отдаёт в очередь каждую закрытую часть ровно один раз. Прогоны не пересекаются: второй
 * вызов ждёт первого, иначе одна часть ушла бы в очередь дважды.
 */
export class PartStager {
  private readonly staged = new Set<string>();

  private running: Promise<void> = Promise.resolve();

  constructor(private readonly options: PartStagerOptions) {}

  private async flushOnce(): Promise<void> {
    const text = await this.options.readList();
    if (text === null) return;
    for (const entry of parseSegmentList(text)) {
      if (this.staged.has(entry.file)) continue;
      await this.options.stage(entry);
      this.staged.add(entry.file);
    }
  }

  get count(): number {
    return this.staged.size;
  }

  async flush(): Promise<void> {
    const previous = this.running;
    const current = (async (): Promise<void> => {
      try {
        await previous;
      } catch {
        // Сбой прошлого прогона уже отдан тому, кто его звал; цепочку он не заклинивает.
      }
      await this.flushOnce();
    })();
    this.running = current;
    return current;
  }
}
