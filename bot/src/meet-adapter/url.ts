/**
 * Ссылка на встречу Google Meet: проверка площадки и пиннинг языка интерфейса.
 *
 * `?hl=en` — половина защиты от чужого языка; вторая половина — `--lang=en-US` у Chromium
 * (`chromiumLaunchOptions` блока container). Без пары текстовые селекторы («Ask to join»)
 * ломаются у пользователя с другим языком интерфейса, и бот молча стоит у двери, которую
 * не узнал. Приём взят у Vexa (Apache-2.0): там это закрывало живые инциденты с венгерским
 * лобби.
 */

export const MEET_HOST = "meet.google.com";
export const MEET_LOCALE = "en";

/**
 * Возвращает ту же ссылку с принудительным `hl=en`. Чужая площадка, не-https и мусор
 * отвергаются с внятной причиной: бот, ушедший не туда, хуже бота, который не пошёл.
 */
export function pinMeetLocale(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`ссылка на встречу не разобрана: ${rawUrl}`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`ссылка на встречу обязана быть https, а не «${url.protocol}»: ${rawUrl}`);
  }

  if (url.hostname !== MEET_HOST) {
    throw new Error(
      `адаптер знает только ${MEET_HOST}, а ссылка ведёт на «${url.hostname}»: ${rawUrl}`,
    );
  }

  url.searchParams.set("hl", MEET_LOCALE);
  return url.toString();
}
