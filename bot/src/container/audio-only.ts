/**
 * Режим «только звук» (#1049): бот пишет звук, а Chromium под Xvfb без GPU принимает,
 * декодирует и рисует видео всех участников — это ~1,8 ядра на встречу. Всё за одним
 * переключателем `SCRIBA_AUDIO_ONLY=1`, по умолчанию выключено: сперва живая проверка.
 *
 * Что включает переключатель:
 *  - `blockIncomingVideo` — видео-трансиверы страницы переводятся в `inactive`, и сервер
 *    площадки перестаёт слать видео вовсе (нечего декодировать и рисовать);
 *  - флаги Chromium `AUDIO_ONLY_ARGS` (в `browser.ts`);
 *  - `--disable-dev-shm-usage` в `browser.ts` снимается: оркестратор и так отдаёт каждому
 *    контейнеру `/dev/shm` в 1 ГиБ (`SHM_BYTES`), а с этим флагом общая память рендереров
 *    уходила бы в `/tmp` — на диск слоя контейнера, вместо ОЗУ.
 */

export const AUDIO_ONLY_ENV = "SCRIBA_AUDIO_ONLY";

type Environment = Readonly<Record<string, string | undefined>>;

/**
 * Переключатель включён только значением «1» или «true»: опечатка не включает режим молча.
 */
export function isAudioOnly(environment: Environment = process.env): boolean {
  const raw = environment[AUDIO_ONLY_ENV]?.trim().toLowerCase() ?? "";
  return raw === "1" || raw === "true";
}

/**
 * Без GPU-процесса, без пересчёта под HiDPI и без фонового сетевого шума Chromium. Картинки
 * и вёрстку не трогаем: адаптеры читают DOM площадки.
 */
export const AUDIO_ONLY_ARGS: readonly string[] = [
  "--disable-gpu",
  "--force-device-scale-factor=1",
  "--disable-background-networking",
];

/**
 * Не принимать входящее видео. Исполняется в странице (`addInitScript`), поэтому
 * самодостаточна: ни импортов, ни внешних констант.
 *
 * Почему трансиверы, а не правка SDP или `track.enabled`:
 *  - `direction = "inactive"` — штатный способ сказать «этот m-line не нужен»: ответ на
 *    любой оффер площадки получится с `a=inactive`, и сервер видео не шлёт. SDP не
 *    переписывается руками, поэтому нет риска рассинхрона с внутренним состоянием
 *    соединения (Chrome ругается на обрезанные m-line и на правки bundle);
 *  - `track.enabled = false` декодирование не останавливает — трафик и CPU остаются.
 * Звуковые трансиверы не трогаются: фильтр — `receiver.track.kind === "video"`.
 *
 * Направление выставляется перед каждым `createOffer`, `createAnswer`, `setLocalDescription`
 * и после `setRemoteDescription`: площадка добавляет m-line на переговорах по ходу встречи
 * (новый участник), и неявный `setLocalDescription()` обходит `createAnswer`. Это методы
 * прототипа, поэтому обёртка конструктора `pinTurnRelays` (Толк) им не мешает.
 */
export function blockIncomingVideo(): void {
  interface TransceiverLike {
    direction: string;
    readonly stopped?: boolean;
    readonly receiver?: { readonly track?: { readonly kind?: string } };
  }
  interface PeerLike {
    getTransceivers?: () => TransceiverLike[];
  }
  type Method = (this: PeerLike, ...arguments_: unknown[]) => unknown;

  const scope = globalThis as unknown as {
    RTCPeerConnection?: { prototype: Record<string, unknown> };
  };
  const prototype = scope.RTCPeerConnection?.prototype;
  if (prototype === undefined) return;

  const silence = (peer: PeerLike): void => {
    const transceivers = peer.getTransceivers?.() ?? [];
    for (const transceiver of transceivers) {
      if (transceiver.stopped === true) continue;
      if (transceiver.receiver?.track?.kind !== "video") continue;
      if (transceiver.direction === "inactive") continue;
      try {
        transceiver.direction = "inactive";
      } catch {
        // Остановленный посреди вызова трансивер: площадка сама его закрывает.
      }
    }
  };

  for (const name of ["createOffer", "createAnswer", "setLocalDescription"]) {
    const original = prototype[name] as Method | undefined;
    if (typeof original !== "function") continue;
    prototype[name] = function patched(this: PeerLike, ...arguments_: unknown[]): unknown {
      silence(this);
      return original.apply(this, arguments_);
    };
  }

  const remote = prototype.setRemoteDescription as Method | undefined;
  if (typeof remote === "function") {
    prototype.setRemoteDescription = async function patched(
      this: PeerLike,
      ...arguments_: unknown[]
    ): Promise<unknown> {
      const result = await (remote.apply(this, arguments_) as Promise<unknown>);
      silence(this);
      return result;
    };
  }
}
