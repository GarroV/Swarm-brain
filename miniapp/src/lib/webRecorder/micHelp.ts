// Отказ в микрофоне: разбор причины и конкретные шаги для браузера человека. Чистый модуль без DOM.
// Формулировки меню сверены с Apple (Safari → Настройки → Веб-сайты → Микрофон) и Google (Настройки сайтов →
// Микрофон); где точный пункт у версий браузера отличается, шаг сформулирован общо.

export type MicDenialCode = "permission-denied" | "mic-blocked-site" | "mic-blocked-os";

/** Состояние `navigator.permissions.query({name:"microphone"})`; undefined — API нет или он не знает «microphone». */
export type MicPermState = "granted" | "denied" | "prompt" | undefined;

export function isMicDenial(code: string | null): code is MicDenialCode {
  return code === "permission-denied" || code === "mic-blocked-site" || code === "mic-blocked-os";
}

/** Ошибки старта, после которых «Попробовать снова» имеет смысл (человек может что-то поправить). */
export function isRetryableMicError(code: string | null): boolean {
  return isMicDenial(code) || code === "no-mic" || code === "mic-failed";
}

/**
 * NotAllowedError → какая именно стена.
 * - сайту запретили (state denied) → mic-blocked-site;
 * - система браузеру запретила: Chrome пишет «by system», либо сайт разрешён (granted), а звука всё равно нет → mic-blocked-os;
 * - окно разрешения закрыли без выбора («dismissed») или API недоступен → общий permission-denied.
 */
export function classifyMicDenial(permState: MicPermState, message: string): MicDenialCode {
  const msg = message.toLowerCase();
  if (permState === "denied") return "mic-blocked-site";
  if (msg.includes("by system")) return "mic-blocked-os";
  if (msg.includes("dismissed")) return "permission-denied";
  if (permState === "granted") return "mic-blocked-os";
  return "permission-denied";
}

export type MicBrowser = "chrome" | "edge" | "firefox" | "safari" | "other";
export type MicOs = "ios" | "mac" | "windows" | "other";
export interface MicEnv { browser: MicBrowser; os: MicOs }

export interface NavLike {
  userAgent: string;
  platform?: string;
  maxTouchPoints?: number;
  userAgentData?: { brands?: { brand: string }[]; platform?: string };
}

export function detectMicEnv(nav: NavLike): MicEnv {
  const ua = nav.userAgent;
  const brands = (nav.userAgentData?.brands ?? []).map((b) => b.brand);
  const uaPlatform = nav.userAgentData?.platform ?? "";
  // iPadOS 13+ выдаёт себя за Macintosh — отличаем по тачам.
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  const os: MicOs = isIos ? "ios"
    : /Mac/i.test(uaPlatform || nav.platform || ua) ? "mac"
    : /Win/i.test(uaPlatform || nav.platform || ua) ? "windows" : "other";
  let browser: MicBrowser = "other";
  if (/Firefox|FxiOS/.test(ua)) browser = "firefox";
  else if (/Edg(e|A|iOS)?\//.test(ua) || brands.includes("Microsoft Edge")) browser = "edge";
  else if (/Chrome|CriOS|Chromium/.test(ua) || brands.includes("Google Chrome") || brands.includes("Chromium")) browser = "chrome";
  else if (/Safari/.test(ua)) browser = "safari";
  return { browser, os };
}

export interface MicStep { ru: string; en: string }

const iosSafari: MicStep[] = [
  { ru: "Нажмите «аА» в адресной строке", en: "Tap “aA” in the address bar" },
  { ru: "Настройки веб-сайта → Микрофон", en: "Website Settings → Microphone" },
  { ru: "Выберите «Разрешить»", en: "Choose “Allow”" },
];

const iosOtherBrowser: MicStep[] = [
  { ru: "Откройте «Настройки» iPhone и найдите свой браузер в списке приложений", en: "Open the iPhone Settings app and find your browser in the app list" },
  { ru: "Включите «Микрофон»", en: "Turn on “Microphone”" },
  { ru: "Вернитесь в Swarm", en: "Come back to Swarm" },
];

/** Шаги, если запретили сайту (или причина неясна). */
export function siteSteps(env: MicEnv): MicStep[] {
  if (env.os === "ios") return env.browser === "safari" ? iosSafari : iosOtherBrowser;
  switch (env.browser) {
    case "chrome":
    case "edge":
      return [
        { ru: "Нажмите значок слева от адреса", en: "Click the icon to the left of the address" },
        { ru: "Разрешения (Настройки сайта) → Микрофон", en: "Permissions (Site settings) → Microphone" },
        { ru: "Выберите «Разрешить»", en: "Choose “Allow”" },
      ];
    case "safari":
      return [
        { ru: "Safari → Настройки → Веб-сайты", en: "Safari → Settings → Websites" },
        { ru: "Слева выберите «Микрофон»", en: "Select “Microphone” on the left" },
        { ru: "Напротив этого сайта выберите «Разрешить»", en: "Next to this site, choose “Allow”" },
      ];
    case "firefox":
      return [
        { ru: "Нажмите значок разрешений слева от адреса", en: "Click the permissions icon to the left of the address" },
        { ru: "Уберите блокировку микрофона для этого сайта", en: "Remove the microphone block for this site" },
        { ru: "Обновите страницу", en: "Reload the page" },
      ];
    default:
      return [
        { ru: "Откройте настройки сайта в вашем браузере (значок слева от адреса)", en: "Open the site settings in your browser (the icon left of the address)" },
        { ru: "Для микрофона выберите «Разрешить»", en: "Set the microphone to “Allow”" },
      ];
  }
}

/** Шаги, если микрофон закрыт на уровне системы для самого браузера. */
export function osSteps(env: MicEnv): MicStep[] {
  if (env.os === "mac") {
    return [
      { ru: "Системные настройки → Конфиденциальность и безопасность → Микрофон", en: "System Settings → Privacy & Security → Microphone" },
      { ru: "Включите свой браузер в списке", en: "Turn on your browser in the list" },
      { ru: "Полностью перезапустите браузер (⌘Q)", en: "Fully quit and reopen the browser (⌘Q)" },
    ];
  }
  if (env.os === "windows") {
    return [
      { ru: "Параметры → Конфиденциальность и безопасность → Микрофон", en: "Settings → Privacy & security → Microphone" },
      { ru: "Включите доступ к микрофону и разрешите его приложениям (в том числе браузеру)", en: "Turn on microphone access and let apps (including your browser) use it" },
      { ru: "Перезапустите браузер", en: "Restart the browser" },
    ];
  }
  if (env.os === "ios") return iosOtherBrowser;
  return [
    { ru: "Откройте настройки системы → Конфиденциальность → Микрофон", en: "Open system settings → Privacy → Microphone" },
    { ru: "Разрешите доступ браузеру и перезапустите его", en: "Allow your browser and restart it" },
  ];
}

export function micSteps(code: MicDenialCode, env: MicEnv): MicStep[] {
  return code === "mic-blocked-os" ? osSteps(env) : siteSteps(env);
}
