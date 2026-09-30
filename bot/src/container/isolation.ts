/**
 * Границы контейнера встречи: сколько встреч идёт разом, сколько ресурсов хоста берёт одна
 * и чем ограничены системные вызовы.
 *
 * Контейнер встречи открывает чужую страницу звонка, поэтому считается недоверенным: он не
 * должен ни съесть хост, ни увидеть соседа.
 *
 * Профиль seccomp (`seccomp-chromium.json`) — профиль Docker по умолчанию
 * (github.com/moby/profiles, seccomp/default.json, коммит 65adc7e0 от 2026-08-25) плюс одно
 * правило: `clone`, `setns`, `unshare` разрешены без CAP_SYS_ADMIN. Профиль по умолчанию
 * пускает их только с этой capability, и тогда песочница Chromium не может создать свои
 * пространства имён — Chromium либо не стартует, либо работает без песочницы
 * (`--no-sandbox`). Проверено живым запуском 2026-09-28: под профилем по умолчанию
 * `unshare -Ur` отказывает, под этим — `chrome://sandbox` показывает «adequately sandboxed».
 * Capability SYS_ADMIN контейнеру НЕ даётся: она открыла бы гораздо больше, чем эти три вызова.
 */
import { readFileSync } from "node:fs";

export interface ContainerLimits {
  /**
   * Потолок памяти вместе с /dev/shm; своп сверх него не даётся.
   */
  readonly memoryBytes: number;
  /**
   * Доля процессора в миллиардных долях ядра (как `--cpus` у docker).
   */
  readonly nanoCpus: number;
  /**
   * Потолок процессов и потоков: Chromium держит их сотнями, но не тысячами.
   */
  readonly pids: number;
}

const MIB = 1024 * 1024;
const NANO_PER_CPU = 1_000_000_000;

/**
 * Замеры (docs/furca/blocks/container.md): смоук записи 2026-09-28 на MUSPELHEIM под этими
 * потолками — пик 317 МБ и 158 процессов/потоков; ранний замер встречи — ~0,5 ГБ. Потолки
 * взяты с запасом в разы, чтобы встреча не упёрлась в них сама, но одна сбесившаяся не
 * утянула хост.
 */
export const DEFAULT_CONTAINER_LIMITS: ContainerLimits = {
  memoryBytes: 2048 * MIB,
  nanoCpus: 2 * NANO_PER_CPU,
  pids: 1024,
};

/**
 * Одновременных встреч по умолчанию: исторический максимум — 3 за 60 дней
 * (docs/decisions/2026-08-28-meeting-bot-platform.md), одно место в запас.
 */
export const DEFAULT_MAX_MEETINGS = 4;

const SECCOMP_PROFILE_URL = new URL("seccomp-chromium.json", import.meta.url);

/**
 * Профиль seccomp строкой JSON — в таком виде его принимает Docker API (`SecurityOpt`).
 * Битый или пустой файл — громкий отказ сразу, а не контейнер без профиля.
 */
export function loadSeccompProfile(url: URL = SECCOMP_PROFILE_URL): string {
  const parsed: unknown = JSON.parse(readFileSync(url, "utf8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as { syscalls?: unknown }).syscalls)
  ) {
    throw new Error(`профиль seccomp ${url.pathname} без списка syscalls — это не профиль`);
  }
  return JSON.stringify(parsed);
}

function positiveInteger(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} должен быть целым положительным числом, получено ${String(value)}`);
  }
  return value;
}

export function validLimits(limits: ContainerLimits): ContainerLimits {
  return {
    memoryBytes: positiveInteger("memoryBytes", limits.memoryBytes),
    nanoCpus: positiveInteger("nanoCpus", limits.nanoCpus),
    pids: positiveInteger("pids", limits.pids),
  };
}

export function validMaxMeetings(value: number): number {
  return positiveInteger("maxMeetings", value);
}
