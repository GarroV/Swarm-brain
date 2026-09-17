// Ссылка «зайти в звонок» из события Google Calendar — для кнопки «Подключиться»
// в уведомлении рекордера (#193) и для бота-участника, который по этой ссылке заходит сам.
// Смысл: человек не бежит в календарь искать ссылку руками, когда встреча уже началась.
//
// Порядок источников — от точного к догадке:
//   1. conferenceData.entryPoints[video] — Google сам говорит, где видео-вход;
//   2. hangoutLink — устаревшее поле того же Meet, живёт в старых событиях;
//   3. место проведения — сюда Ktalk/Zoom/Teams кладут ссылку руками;
//   4. описание встречи — туда ссылку кладут чаще всего, когда приглашение собрано не Google.
//
// Кроме самой ссылки блок отвечает за две вещи, без которых бот бесполезен:
// какая это площадка (по ней выбирается адаптер захода) и почему ссылки нет, если её нет.
import type { GEvent } from "./select.ts";

/** Площадки, ссылку на которые мы узнаём в лицо. Неизвестный хост — `null`, а не догадка. */
export type ConferencePlatform = "meet" | "kontur" | "zoom";

export interface ConferenceInfo {
  join_url: string | null;
  platform: ConferencePlatform | null;
  /**
   * Почему ссылки нет. Молчаливый `null` не давал отличить «ссылки в приглашении нет»
   * от «ссылку не разобрали», и человеку нельзя было сказать, почему бот не пришёл.
   */
  reason?: "no_conference_link";
}

// Только https. Приглашение в календарь может прислать кто угодно, а ссылку рекордер
// ОТКРЫВАЕТ по клику: javascript:, file:, http: — это не адрес встречи, а способ навредить.
function httpsUrl(raw: string | undefined | null): URL | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.trim());
    return u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

function httpsOnly(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  return httpsUrl(trimmed) ? trimmed : null;
}

// Хост сравнивается ЦЕЛИКОМ или по метке домена (`us02web.zoom.us`), а НЕ суффиксом строки:
// привычное `endsWith("zoom.us")` пропускает `evilzoom.us` — домен, который может
// зарегистрировать кто угодно, а приглашение в календарь присылает кто угодно.
function underDomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

// Контур.Толк живёт и как `ktalk.ru`, и как `talk.kontur.<зона>`. Метки сверяются поштучно:
// «начинается на talk.kontur.» пропустило бы `talk.kontur.ru.evil.com`.
function isKonturTalk(host: string): boolean {
  const labels = host.split(".");
  return labels.length === 3 && labels[0] === "talk" && labels[1] === "kontur";
}

/**
 * Площадка звонка по хосту ссылки. По ней оркестратор выбирает адаптер захода,
 * поэтому ошибиться здесь дороже, чем не узнать: незнакомый хост — `null`.
 */
export function conferencePlatform(url: string): ConferencePlatform | null {
  const parsed = httpsUrl(url);
  if (!parsed) return null;
  const host = parsed.hostname; // URL уже привёл хост к нижнему регистру

  if (underDomain(host, "meet.google.com")) return "meet";
  if (underDomain(host, "ktalk.ru") || isKonturTalk(host)) return "kontur";
  if (underDomain(host, "zoom.us")) return "zoom";
  return null;
}

// Все https-ссылки текста, по порядку появления.
function linksIn(text: string | undefined): string[] {
  if (!text) return [];
  return (text.match(/https:\/\/[^\s<>"')]+/g) ?? [])
    .map((m) => httpsOnly(m))
    .filter((u): u is string => u !== null);
}

// Первая https-ссылка внутри текста («Zoom: https://… (пароль в описании)»).
function firstLinkIn(text: string | undefined): string | null {
  return linksIn(text)[0] ?? null;
}

// Описание — самое шумное поле события: повестка, документы, справка Google, ссылка отписки.
// Поэтому здесь сначала ищем ссылку известной площадки и только потом соглашаемся на первую
// попавшуюся: ссылка на документ вместо звонка хуже, чем ссылка неизвестной площадки.
function linkInDescription(text: string | undefined): string | null {
  const links = linksIn(text);
  return links.find((u) => conferencePlatform(u) !== null) ?? links[0] ?? null;
}

export function joinLink(ev: GEvent): string | null {
  const video = (ev.conferenceData?.entryPoints ?? [])
    .filter((e) => e.entryPointType === "video")
    .map((e) => httpsOnly(e.uri))
    .find((uri): uri is string => uri !== null);
  if (video) return video;

  const hangout = httpsOnly(ev.hangoutLink);
  if (hangout) return hangout;

  const location = firstLinkIn(ev.location);
  if (location) return location;

  return linkInDescription(ev.description);
}

/** Ссылка + площадка + явная причина отказа — то, что уходит в ответе `meeting-current`. */
export function conferenceInfo(ev: GEvent): ConferenceInfo {
  const url = joinLink(ev);
  if (!url) {
    return { join_url: null, platform: null, reason: "no_conference_link" };
  }
  return { join_url: url, platform: conferencePlatform(url) };
}
