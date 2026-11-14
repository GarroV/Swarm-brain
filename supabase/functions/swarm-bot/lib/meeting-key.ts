// Ключ встречи из колбэка/сессии бота попадает в строку фильтра PostgREST (`.or(...)`), где
// запятая, скобки и кавычка — служебные: чужой ключ с `,` дописал бы к фильтру своё условие
// (GHSA-pr5g-c685-px97, issue #1067). Колбэк-данные приходят от клиента Telegram, поэтому ключ
// проверяется перед подстановкой, а не доверяется.
const UNSAFE_FILTER_CHARS = /[,()"'\\\s*%]/;
const MAX_MEETING_KEY_LENGTH = 128;

export function isSafeMeetingKey(key: string): boolean {
  return key.length > 0 && key.length <= MAX_MEETING_KEY_LENGTH && !UNSAFE_FILTER_CHARS.test(key);
}

/** Условие, которое не находит ни одной записи: для небезопасного ключа вместо его подстановки. */
const MATCH_NOTHING = "id.eq.00000000-0000-0000-0000-000000000000";

/** Условие «запись этой встречи» для `.or(...)`; для небезопасного ключа — условие без совпадений. */
export function meetingEntryFilter(meetingId: string): string {
  if (!isSafeMeetingKey(meetingId)) return MATCH_NOTHING;
  return `metadata->>meeting_id.eq.${meetingId},id.eq.${meetingId}`;
}
