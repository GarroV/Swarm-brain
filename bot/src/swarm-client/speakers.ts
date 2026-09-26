/**
 * Таймлайн говорящих: из кого сервер потом сделает имена в стенограмме вместо «собеседник».
 *
 * Источник — адаптер площадки (`activeSpeaker()`), который знает вёрстку звонка. Мы его
 * периодически опрашиваем и превращаем последовательность снимков в интервалы. Точность
 * ограничена шагом опроса, и это честная граница: смена говорящего приписывается тому
 * моменту, когда её ЗАМЕТИЛИ, а не тому, когда она случилась.
 *
 * Сервер (`ingest-speakers`) разрешает и дыры, и промахи: не нашлось имени на сегмент —
 * остаётся прежняя метка. Поэтому здесь ничего не додумывается: не знаем — не пишем.
 */
import type { SpeakerSpan } from "./contract.ts";

/**
 * Снимок: в момент `at` (секунды от начала записи) говорил `name`; `null` — никто.
 */
export interface SpeakerSample {
  readonly at: number;
  readonly name: string | null;
}

/**
 * Всё, что нужно от адаптера площадки. Узкий интерфейс со стороны потребителя, а не импорт
 * `PlatformAdapter`: блоки строятся параллельно, и зависеть от чужого файла раньше времени
 * значит зависеть от того, чего ещё нет. `PlatformAdapter` этому интерфейсу удовлетворяет.
 */
export interface SpeakerSource {
  activeSpeaker(): Promise<string | null>;
}

export interface CollectorOptions {
  /**
   * Шаг опроса. Он же — точность границ интервалов.
   */
  readonly intervalMs?: number;
  /**
   * Часы, в миллисекундах. Подменяются в тестах.
   */
  readonly now?: () => number;
  /**
   * Сбой опроса. Молчать нельзя (принцип №1), но и валить запись из-за него — тоже:
   * встреча важнее разметки.
   */
  readonly onError?: (error: unknown) => void;
}

const DEFAULT_INTERVAL_MS = 1000;

/**
 * Имя, которому можно верить: пустая строка и пробелы — это «не знаем», а не участник.
 */
function cleanName(raw: string | null): string | null {
  const name = raw?.trim() ?? "";
  return name.length > 0 ? name : null;
}

/**
 * Свести снимки в интервалы. Чистая функция — её и проверяют тестами в первую очередь.
 *
 * @param samples снимки опроса; порядок не обязателен, упорядочим сами
 * @param endAt   конец записи в секундах от её начала: им закрывается последний интервал
 */
export function spansFromSamples(samples: readonly SpeakerSample[], endAt: number): SpeakerSpan[] {
  const ordered = samples.toSorted((a, b) => a.at - b.at);
  const spans: SpeakerSpan[] = [];

  let openName: string | null = null;
  let openStart = 0;

  const close = (at: number): void => {
    if (openName === null) return;
    const end = Math.min(at, endAt);
    if (end > openStart) spans.push({ start: openStart, end, name: openName });
    openName = null;
  };

  for (const raw of ordered) {
    const name = cleanName(raw.name);
    if (name === openName) continue;
    close(raw.at);
    if (name !== null && raw.at < endAt) {
      openName = name;
      openStart = raw.at;
    }
  }
  close(endAt);

  return spans;
}

/**
 * Опрашивает источник, пока идёт запись, и по `stop()` отдаёт готовый таймлайн.
 *
 * Опросы не накладываются друг на друга: следующий заводится только после того, как
 * предыдущий ответил. Медленная страница даёт разреженный таймлайн, а не очередь
 * висящих запросов.
 */
export class SpeakerTimelineCollector {
  private readonly samples: SpeakerSample[] = [];
  private readonly intervalMs: number;
  private readonly now: () => number;
  private startedAtMs = 0;
  private running = false;
  private timer: NodeJS.Timeout | undefined;
  /**
   * Разбудить ожидание между опросами. Без него `stop()` гасит таймер, и цикл висит вечно.
   */
  private wake: (() => void) | undefined;
  private loop: Promise<void> = Promise.resolve();

  constructor(
    private readonly source: SpeakerSource,
    private readonly options: CollectorOptions = {},
  ) {
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.now = options.now ?? Date.now;
  }

  private stopped(): boolean {
    return !this.running;
  }

  private elapsedSeconds(): number {
    return (this.now() - this.startedAtMs) / 1000;
  }

  private async pollForever(): Promise<void> {
    // Состояние читается вызовом, а не полем: поле после `await` считается сужённым типом
    // и проверка «уже остановили?» выглядела бы для линтера всегда ложной.
    while (!this.stopped()) {
      await this.pollOnce();
      if (this.stopped()) break;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
        this.timer = setTimeout(resolve, this.intervalMs);
      });
      this.wake = undefined;
    }
  }

  private async pollOnce(): Promise<void> {
    const at = this.elapsedSeconds();
    try {
      const name = await this.source.activeSpeaker();
      this.samples.push({ at, name });
    } catch (error) {
      // Сбой опроса — это «не знаем», а не «никто не говорит»: закрываем текущий интервал
      // снимком `null` и говорим о сбое наружу, а не проглатываем его.
      this.samples.push({ at, name: null });
      this.options.onError?.(error);
    }
  }

  /**
   * Начать опрос. Повторный вызов ничего не делает: таймлайн один на запись.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAtMs = this.now();
    this.loop = this.pollForever();
  }

  /**
   * Остановить опрос и свести снимки в интервалы. Можно звать и без `start()`.
   */
  async stop(): Promise<SpeakerSpan[]> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.wake?.();
    await this.loop;
    return spansFromSamples(this.samples, this.elapsedSeconds());
  }
}
