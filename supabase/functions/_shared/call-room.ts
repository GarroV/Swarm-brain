// call-room — «комната звонка» как общий ключ встречи для склейки в meeting-claim.
//
// Календарное событие и запись из комнаты видят ОДИН звонок под разными ключами (`<event>:<дата>`
// и `meet:<код>` / `kontur:<комната>`), но ссылка на звонок у них общая. Формат комнаты — тот же,
// что у рекордера (recorder BrowserRoom.swift parseRoom), чтобы ссылку из календаря можно было
// сравнивать с ключом комнаты напрямую. Время и состав склейки не решают: у личной комнаты
// (Контур.Толк) и у серии Meet одна ссылка на много созвонов, поэтому окно по времени остаётся
// в meeting-claim, а здесь — только «какая комната».

const DAY_SUFFIX = /:\d{4}-\d{2}-\d{2}$/;

/** `https://meet.google.com/abc-defg-hij?x` → `meet:abc-defg-hij`; Контур.Толк → `kontur:<комната>`; иначе null. */
export function callRoomOfUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url.trim()) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const seg = u.pathname.split("/").filter(Boolean)[0] ?? "";
  if (host.includes("meet.google.com")) {
    const looksLikeCode = seg.includes("-") && seg.length >= 10 && seg.length <= 14 &&
      /^[a-z-]+$/.test(seg);
    return looksLikeCode ? `meet:${seg}` : null;
  }
  if (host.includes("ktalk.ru") || host.includes("talk.kontur")) {
    return seg ? `kontur:${seg}` : null;
  }
  return null;
}

/** Комната из ключа идентичности: только для `room`, дневной суффикс (scopeRoomKey) снимается. */
export function callRoomOfKey(kind: string, key: string): string | null {
  if (kind !== "room") return null;
  const room = key.replace(DAY_SUFFIX, "");
  return /^(meet|kontur|zoom):.+/.test(room) ? room : null;
}
