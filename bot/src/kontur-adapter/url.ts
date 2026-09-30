/**
 * Ссылка на комнату Контур.Толка: проверка площадки до открытия браузера.
 *
 * Толк живёт и как `<пространство>.ktalk.ru`, и как `talk.kontur.<зона>` — ровно так же площадку
 * распознаёт сервер (`supabase/functions/meeting-current/join-link.ts`). Метки сверяются
 * поштучно: «кончается на ktalk.ru» пропустило бы `evilktalk.ru`, «начинается на talk.kontur.» —
 * `talk.kontur.ru.evil.com`. Язык интерфейса ссылкой не пиннится (параметра у Толка нет), его
 * держит `--lang=ru-RU` браузера и локаль контекста.
 *
 * Ссылка не переписывается: сервер сверяет комнату, в которую пришёл бот, с приглашением по
 * хосту и пути, и лишний параметр ему не мешает, но и пользы от него нет.
 */

const KONTUR_DOMAIN = "ktalk.ru";
const KONTUR_TALK_LABELS = 3;

function isKonturHost(host: string): boolean {
  if (host === KONTUR_DOMAIN || host.endsWith(`.${KONTUR_DOMAIN}`)) return true;
  const labels = host.split(".");
  return labels.length === KONTUR_TALK_LABELS && labels[0] === "talk" && labels[1] === "kontur";
}

/**
 * Возвращает ссылку в том виде, в каком её откроет браузер (без фрагмента). Чужая площадка,
 * не-https, учётные данные в ссылке и площадка без комнаты отвергаются с внятной причиной.
 */
export function checkKonturUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`ссылка на встречу не разобрана: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`ссылка на встречу обязана быть https, а не «${url.protocol}»: ${rawUrl}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`в ссылке на встречу учётные данные — бот их не предъявляет: ${url.hostname}`);
  }
  const host = url.hostname.toLowerCase();
  if (!isKonturHost(host)) {
    throw new Error(
      `адаптер знает только Контур.Толк (${KONTUR_DOMAIN}, talk.kontur.*), а ссылка ведёт на «${host}»: ${rawUrl}`,
    );
  }
  if (url.pathname.replaceAll("/", "") === "") {
    throw new Error(`в ссылке нет комнаты — только адрес пространства: ${rawUrl}`);
  }
  url.hash = "";
  return url.href;
}
