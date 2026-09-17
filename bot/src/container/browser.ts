/**
 * Параметры запуска Chromium внутри контейнера.
 *
 * Тут закрыт главный риск проекта: Playwright добавляет `--mute-audio` в аргументы по
 * умолчанию, и звук молча не пишется — ни ошибки, ни строчки в логе. Снимается это ровно
 * одним способом: `ignoreDefaultArgs: ["--mute-audio"]`. Всё, что знает про вёрстку
 * площадки, живёт в адаптере; здесь только окружение.
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
    // Единственная строка, которая отделяет запись от тишины.
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
