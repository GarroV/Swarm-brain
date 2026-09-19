/**
 * Параметры запуска Chromium внутри контейнера.
 *
 * `ignoreDefaultArgs: ["--mute-audio"]` — страховка на случай, если Playwright когда-нибудь
 * начнёт добавлять `--mute-audio` в аргументы Chromium по умолчанию: тогда наш ignore его
 * снимет. В версии 1.63 на Linux этого флага в дефолтах НЕТ (проверено 2026-09-19 запуском
 * Chromium в контейнере и осмотром живых args через ps), поэтому реальная защита от
 * молчаливой тишины лежит в другом месте: `set-default-sink` в entrypoint.sh и проверка
 * `Default Sink == наш sink` в inspectAudioEnvironment. Строка ниже дешёвая и вреда не
 * несёт — оставлена как страховка. Всё, что знает про вёрстку площадки, живёт в адаптере;
 * здесь только окружение.
 */

export const MUTE_AUDIO_ARG = "--mute-audio";

export interface ChromiumLaunchOptions {
  readonly headless: false;
  readonly ignoreDefaultArgs: readonly string[];
  readonly args: readonly string[];
}

export interface ChromiumLaunchInput {
  readonly lang?: string;
  readonly extraArgs?: readonly string[];
  /**
   * Песочница Chromium требует user namespaces, которых в контейнере под чужим seccomp может
   * не быть; контейнер эфемерный и живёт одну встречу, поэтому по умолчанию она выключена.
   */
  readonly sandbox?: boolean;
}

export function chromiumLaunchOptions(input: ChromiumLaunchInput = {}): ChromiumLaunchOptions {
  const extra = input.extraArgs ?? [];
  if (extra.includes(MUTE_AUDIO_ARG)) {
    throw new Error(
      `${MUTE_AUDIO_ARG} передан снаружи: с ним запись будет тишиной, и ни одна проверка ` +
        "этого не заметит — аргумент запрещён явно",
    );
  }

  return {
    headless: false,
    // Страховка от возможного будущего дефолта Playwright (см. шапку файла).
    ignoreDefaultArgs: [MUTE_AUDIO_ARG],
    args: [
      ...(input.sandbox === true ? [] : ["--no-sandbox"]),
      `--lang=${input.lang ?? "en-US"}`,
      // Жать «играть» в звонке некому: бот заходит без человека.
      "--autoplay-policy=no-user-gesture-required",
      // /dev/shm в контейнере по умолчанию 64 МБ — Chromium на этом падает посреди встречи.
      "--disable-dev-shm-usage",
      ...extra,
    ],
  };
}
