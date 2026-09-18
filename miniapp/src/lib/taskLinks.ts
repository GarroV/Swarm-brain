// Ссылки задачи на стороне веба: те же правила, что у сервера (`_shared/tasks/links.ts`).
//
// Зачем повторять проверку, раз сервер всё равно проверит. Во-первых, отказ должен приходить
// до сохранения, а не после: поле автосохраняемое, и «ошибка 400» на выходе из карточки
// человек уже не свяжет с тем, что набрал. Во-вторых и главное — ВЕБ РИСУЕТ эти адреса как
// <a href>, а `javascript:alert(1)` и `data:` — валидные URL с точки зрения конструктора и
// выполнение чужого кода в href. Сервер закрывает запись, `isSafeLinkUrl` закрывает показ:
// строка, лежащая в базе с тех времён, когда проверки не было, не должна стать кликабельной.
import type { TaskLink } from "@/types";

/** Больше двадцати ссылок у одной задачи — это уже не задача, а папка (D008). */
export const LINKS_MAX = 20;
/** Название длиннее двухсот знаков ломает строку в интерфейсе; режем, ссылку не теряем. */
export const LINK_TITLE_MAX = 200;

const ALLOWED_PROTOCOLS = ["http:", "https:"];

/** Причина отказа. Текст для человека собирает экран — он знает язык интерфейса. */
export type LinkError =
  | "empty"
  | "not-url"
  | "protocol"
  | "duplicate"
  | "limit";

export type AddLinkResult =
  | { ok: true; links: TaskLink[] }
  | { ok: false; reason: LinkError };

/** Можно ли отдавать адрес в href. Всё, что не http/https, — нельзя. */
export function isSafeLinkUrl(raw: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.includes(
      new URL(raw.trim()).protocol.toLowerCase(),
    );
  } catch {
    return false;
  }
}

/**
 * Добавляет ссылку в список. Возвращает НОВЫЙ список — исходный не меняется: он же лежит
 * в состоянии React, и правка на месте не вызвала бы перерисовку.
 */
export function addLink(
  links: readonly TaskLink[],
  url: string,
  title: string | null,
): AddLinkResult {
  const trimmed = url.trim();
  if (trimmed === "") return { ok: false, reason: "empty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "not-url" };
  }
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol.toLowerCase())) {
    return { ok: false, reason: "protocol" };
  }
  if (links.some((l) => l.url === trimmed)) {
    return { ok: false, reason: "duplicate" };
  }
  if (links.length >= LINKS_MAX) return { ok: false, reason: "limit" };

  const name = (title ?? "").trim();
  return {
    ok: true,
    links: [...links, {
      title: name === "" ? null : name.slice(0, LINK_TITLE_MAX),
      url: trimmed,
    }],
  };
}

/** Подпись ссылки: заголовок, иначе адрес без схемы и без хвоста параметров. */
export function linkLabel(link: TaskLink): string {
  if (link.title) return link.title;
  try {
    const u = new URL(link.url);
    const path = u.pathname === "/" ? "" : u.pathname;
    return `${u.host}${path}`;
  } catch {
    return link.url;
  }
}
