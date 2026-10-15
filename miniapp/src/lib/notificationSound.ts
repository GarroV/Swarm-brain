// Звук нового уведомления (issue #803). Только в интерфейсе самого человека: вкладка открыта и
// опрос колокольчика увидел, что непрочитанных стало больше. Никаких отправок наружу. Звук —
// WebAudio, двухтоновый «динь» без файлов.

const STORAGE_KEY = "swarm.notificationSound";

/** Выключатель в Настройках; по умолчанию включён. Хранилище недоступно → включён. */
export function isChimeEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setChimeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* приватный режим: выбор не сохранится, звук останется включённым */
  }
}

/** Звонить, когда счётчик вырос по сравнению с прошлым опросом; первая загрузка (prev=null) молчит. */
export function shouldChime(prev: number | null, next: number): boolean {
  return prev !== null && next > prev;
}

/**
 * Помнит последний увиденный счётчик. Колокольчик смонтирован в нескольких местах оболочки, и у
 * каждого свой опрос, поэтому память одна на модуль: второй экземпляр видит то же число и молчит.
 */
export function createUnreadObserver() {
  let last: number | null = null;
  return {
    /** Записать новое значение; true — стоит позвонить. */
    observe(next: number): boolean {
      const chime = shouldChime(last, next);
      last = next;
      return chime;
    },
  };
}

export const unreadObserver = createUnreadObserver();

let ctx: AudioContext | null = null;

/** Короткий двухтоновый «динь». Браузер без жеста пользователя звук не отдаёт — отказ тихо глотаем. */
export function playChime(): void {
  if (!isChimeEnabled()) return;
  try {
    const Ctor = window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    if (ctx.state !== "running") return; // жеста ещё не было — молчим, а не копим очередь
    const start = ctx.currentTime;
    // E6 → A6: мягкий восходящий интервал, затухание за ~0.5 с.
    [[1318.5, 0], [1760, 0.12]].forEach(([freq, delay]) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = start + delay;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.45);
    });
  } catch {
    /* автоплей запрещён или звук недоступен — уведомление всё равно видно на колокольчике */
  }
}
