/**
 * Опрос по кругу для входов оркестратора (приглашения из веба, задания календаря): следующий
 * опрос — через интервал после конца предыдущего, так что медленный сервер не наслаивает опросы
 * друг на друга; остановка доводит идущий опрос до конца — забранное не бросается.
 */
export class PollLoop {
  private timer: NodeJS.Timeout | undefined;

  private running: Promise<void> | null = null;

  private isStarted = false;

  private readonly pollOnce: () => Promise<void>;

  private readonly intervalMs: number;

  private readonly what: string;

  constructor(what: string, pollOnce: () => Promise<void>, intervalMs: number) {
    this.what = what;
    this.pollOnce = pollOnce;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.isStarted) throw new Error(`${this.what}: опрос уже запущен`);
    this.isStarted = true;
    const cycle = async (): Promise<void> => {
      await this.pollOnce();
      this.running = null;
      if (this.isStarted) this.timer = setTimeout(loop, this.intervalMs);
    };
    const loop = (): void => {
      this.running = cycle();
    };
    loop();
  }

  async close(): Promise<void> {
    this.isStarted = false;
    clearTimeout(this.timer);
    this.timer = undefined;
    await this.running;
  }
}
