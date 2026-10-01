// Лиз ОБРАБОТКИ встречи (meetings.processing_lease) — кто из воркеров сейчас двигает встречу.
// Не путать с лизом права транскрибации (meetings.lease_expires_at, `meeting-lease.ts`): тот говорит,
// чья встреча, этот — какой воркер её прямо сейчас транскрибирует и сводит.
//
// Зачем модуль (issue #578): лиз ставился один раз при взятии встречи и не продлевался, а снимался
// любым воркером без проверки, что он его. Обработка длиннее LEASE_STALE_MS (долгий Whisper, тезисы
// на длинной стенограмме) — и cron брал ту же встречу вторым воркером: двойная транскрибация, двойные
// тезисы и уведомления, двойной расход OpenAI. Первый воркер в своём `finally` ещё и обнулял лиз
// второго, открывая дорогу третьему.
//
// Правило теперь одно: значение processing_lease и есть токен держателя. Взятие, продление, любая
// запись воркера и снятие — условная UPDATE «по id И ожидаемому токену». Продление ставит новый момент
// (он же новый токен), поэтому свежесть и владение живут в одной колонке, без миграции. Пульс продлевает
// лиз, пока идёт долгий вызов модели; потерявший лиз воркер прерывает сетевые вызовы и не пишет ничего.

import { type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/** Лиз протух → воркер, взявший встречу, считается мёртвым, и её можно перехватить. */
export const LEASE_STALE_MS = 5 * 60_000;
/** Как часто живой воркер продлевает лиз. Сильно меньше LEASE_STALE_MS: пропущенный удар не роняет лиз. */
export const LEASE_RENEW_EVERY_MS = 60_000;

/** Лиз перехватил другой воркер: этот обязан остановиться и ничего не писать. */
export class LeaseLostError extends Error {
  constructor(meetingId: string) {
    super(`meeting ${meetingId}: лиз обработки перехвачен другим воркером`);
    this.name = "LeaseLostError";
  }
}

export function isLeaseLost(e: unknown): e is LeaseLostError {
  return e instanceof LeaseLostError;
}

/** Пробрасывает потерю лиза из блока, который иначе глотает ошибки (попытки части, заголовок). */
export function rethrowIfLeaseLost(e: unknown): void {
  if (isLeaseLost(e)) throw e;
}

// Моменты сравниваются как моменты: база отдаёт `+00:00`, мы пишем `Z`.
const sameInstant = (a: unknown, b: string): boolean => typeof a === "string" && Date.parse(a) === Date.parse(b);

/** Ограничитель записи воркера сверх токена (поколение состояния, незамороженность). */
// deno-lint-ignore no-explicit-any
export type Guard = (q: any) => any;

export class ProcessingLease {
  #token: string;
  #renewedAt: number;
  #chain: Promise<unknown> = Promise.resolve();
  #timer: ReturnType<typeof setInterval> | undefined;
  readonly #abort = new AbortController();

  private constructor(readonly supabase: SupabaseClient, readonly meetingId: string, token: string) {
    this.#token = token;
    this.#renewedAt = Date.now();
  }

  /** Атомарно берёт лиз: только если встреча в обработке и лиз пуст или протух. null — занят. */
  static async claim(supabase: SupabaseClient, meetingId: string): Promise<ProcessingLease | null> {
    const token = new Date().toISOString();
    const staleIso = new Date(Date.now() - LEASE_STALE_MS).toISOString();
    const { data } = await supabase
      .from("meetings")
      .update({ processing_lease: token })
      .eq("id", meetingId)
      .eq("summary_status", "processing")
      .or(`processing_lease.is.null,processing_lease.lt.${staleIso}`)
      .select("id")
      .maybeSingle();
    return data ? new ProcessingLease(supabase, meetingId, token) : null;
  }

  /** Текущий токен (для тестов и логов). */
  get token(): string {
    return this.#token;
  }

  /** Сигнал отмены сетевых вызовов: срабатывает, когда лиз потерян. */
  get signal(): AbortSignal {
    return this.#abort.signal;
  }

  /** Лиз потерян — дальше этот воркер не пишет и не зовёт модель. */
  get lost(): boolean {
    return this.#abort.signal.aborted;
  }

  // Продления и записи идут строго по очереди: каждая меняет токен, параллельные сравнивали бы старый.
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.catch(() => {});
    return run;
  }

  #markLost(): LeaseLostError {
    const err = new LeaseLostError(this.meetingId);
    if (!this.#abort.signal.aborted) this.#abort.abort(err);
    this.stopHeartbeat();
    return err;
  }

  /**
   * Запись воркера в строку встречи — только пока лиз его. Запись без снятия лиза его же и продлевает
   * (новый момент = новый токен). true — строка обновлена; false — строка не прошла остальные условия
   * (поколение сменилось, встреча заморожена) при живом лизе. Лиз перехвачен — LeaseLostError.
   */
  write(patch: Record<string, unknown>, guard: Guard = (q) => q, gen?: string): Promise<boolean> {
    return this.#exclusive(async () => {
      if (this.lost) throw new LeaseLostError(this.meetingId);
      const releases = "processing_lease" in patch;
      const renewed = releases ? null : new Date().toISOString();
      const full = renewed ? { ...patch, processing_lease: renewed } : patch;
      const q = guard(this.supabase.from("meetings").update(full).eq("id", this.meetingId))
        .eq("processing_lease", this.#token);
      const { data, error } = await q.select("id");
      if (error) throw new Error(`meetings ${this.meetingId}: ${error.message}`);
      if ((data?.length ?? 0) > 0) {
        if (renewed) {
          this.#token = renewed;
          this.#renewedAt = Date.now();
        } else this.stopHeartbeat();
        return true;
      }
      if (await this.#takenOver(gen)) throw this.#markLost();
      return false;
    });
  }

  // Строка не обновилась: перехвачен ли лиз (а не сменилось поколение)? Сменившееся поколение — прежняя
  // семантика «запись вытеснена» (очередь второй записи), её решает вызывающий.
  async #takenOver(gen: string | undefined): Promise<boolean> {
    const { data } = await this.supabase.from("meetings")
      .select("processing_lease, gen:process_state->>gen")
      .eq("id", this.meetingId)
      .maybeSingle();
    const row = data as { processing_lease: string | null; gen?: string | null } | null;
    if (!row) return true;
    const sameGen = gen === undefined || row.gen === undefined || row.gen === gen;
    return sameGen && !sameInstant(row.processing_lease, this.#token);
  }

  /** Продление без прочих полей. Перехвачен — LeaseLostError; сменилось поколение — тихо. */
  async renew(gen?: string): Promise<void> {
    await this.write({}, (q) => (gen ? q.eq("process_state->>gen", gen) : q), gen);
  }

  /** Продлить, если с прошлого продления прошло достаточно. */
  async renewIfDue(gen?: string): Promise<void> {
    if (Date.now() - this.#renewedAt < LEASE_RENEW_EVERY_MS) return;
    await this.renew(gen);
  }

  /** Пульс на время шага: продлевает лиз, пока идут долгие вызовы модели. */
  startHeartbeat(gen?: string): void {
    this.stopHeartbeat();
    this.#timer = setInterval(() => {
      this.renewIfDue(gen).catch((e) => {
        if (!isLeaseLost(e)) console.error(`meeting-processing-lease: продление ${this.meetingId} упало:`, e);
      });
    }, LEASE_RENEW_EVERY_MS / 2);
  }

  stopHeartbeat(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
  }

  /** Снять свой лиз (встреча осталась в обработке). Чужой не трогается: условие по токену. */
  async release(): Promise<void> {
    this.stopHeartbeat();
    if (this.lost) return;
    await this.#exclusive(async () => {
      await this.supabase.from("meetings").update({ processing_lease: null })
        .eq("id", this.meetingId).eq("processing_lease", this.#token).select("id");
    });
  }
}
