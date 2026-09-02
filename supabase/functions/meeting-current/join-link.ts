// Ссылка «зайти в звонок» из события Google Calendar — для кнопки «Подключиться»
// в уведомлении рекордера (#193). Смысл: человек не бежит в календарь искать ссылку
// руками, когда встреча уже началась.
//
// Порядок источников — от точного к догадке:
//   1. conferenceData.entryPoints[video] — Google сам говорит, где видео-вход;
//   2. hangoutLink — устаревшее поле того же Meet, живёт в старых событиях;
//   3. место проведения — сюда Ktalk/Zoom/Teams кладут ссылку руками.
import type { GEvent } from "./select.ts";

// Только https. Приглашение в календарь может прислать кто угодно, а ссылку рекордер
// ОТКРЫВАЕТ по клику: javascript:, file:, http: — это не адрес встречи, а способ навредить.
function httpsOnly(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    return new URL(raw.trim()).protocol === "https:" ? raw.trim() : null;
  } catch {
    return null;
  }
}

// Первая https-ссылка внутри текста («Zoom: https://… (пароль в описании)»).
function firstLinkIn(text: string | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https:\/\/[^\s<>"')]+/);
  return m ? httpsOnly(m[0]) : null;
}

export function joinLink(ev: GEvent): string | null {
  const video = (ev.conferenceData?.entryPoints ?? [])
    .filter((e) => e.entryPointType === "video")
    .map((e) => httpsOnly(e.uri))
    .find((uri): uri is string => uri !== null);
  if (video) return video;

  const hangout = httpsOnly(ev.hangoutLink);
  if (hangout) return hangout;

  return firstLinkIn(ev.location);
}
