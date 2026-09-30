/**
 * Ссылка на встречу в том виде, в каком её откроет браузер, — по площадке. Проверку делает
 * адаптер площадки; оркестратор зовёт её ДО подъёма контейнера: бот, ушедший не туда, хуже бота,
 * который не пошёл.
 */
import { checkKonturUrl } from "../kontur-adapter/url.ts";
import { pinMeetLocale } from "../meet-adapter/url.ts";
import type { SupportedPlatform } from "./config.ts";

export function joinUrlFor(platform: SupportedPlatform, joinUrl: string): string {
  switch (platform) {
    case "meet": {
      return pinMeetLocale(joinUrl);
    }
    case "kontur": {
      return checkKonturUrl(joinUrl);
    }
  }
}
