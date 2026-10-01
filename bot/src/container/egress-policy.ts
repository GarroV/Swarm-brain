/**
 * Куда контейнеру встречи можно выйти наружу — единственное правило egress-прокси.
 *
 * Контейнер встречи открывает страницу звонка и держит в браузере живую сессию аккаунта бота
 * (T175). Сеть у него internal: маршрута наружу нет, внешние имена не резолвятся (проверено на
 * MUSPELHEIM 2026-09-28), и единственная дверь — прокси, который спрашивает это правило про
 * каждый CONNECT. Всё, чего нет в списке, закрыто.
 *
 * Состав (Google, «Prepare your network for Meet», knowledge.workspace.google.com, 2026-09-28):
 * медиа Meet — IPv4 74.125.250.0/24, 74.125.247.128/32 (Workspace), 142.250.82.0/24 (личные
 * аккаунты), SNI `workspace.turns.goog` / `meet.turns.goog`, порты UDP 3478 и 19302–19309, при
 * закрытом UDP — TCP. UDP через прокси не ходит, поэтому браузер шлёт медиа по TCP/TLS: Google это
 * поддерживает, качество видео хуже, звук для записи — в норме. Веб Meet и вход — домены Google
 * на 443. Свой Swarm — ровно host:port из адреса.
 *
 * Контур.Толк (T111, D040; разведка 30.09.2026 — боевой образ открыл несуществующую комнату
 * `dodobrands.ktalk.ru/<случайный код>` и записал хосты всех запросов): страница, скрипты, шрифты,
 * API и WebSocket — всё на хосте самого пространства `<имя>.ktalk.ru:443`. Поэтому открыт суффикс
 * `ktalk.ru` и хосты `talk.kontur.<зона>` (вторая форма ссылок Толка), только на 443. Аналитика и
 * сборщик ошибок Контура (`metrika.kontur.ru`, `sentry.kontur.host`) закрыты: странице они не
 * нужны, а данные из браузера бота уносят. Медиасерверы Толка — `*.ktalk.host:443` (TURN по TLS,
 * имена вида `sd2-talk-stun4.ktalk.host`): найдены живым звонком 30.09.2026, пока их не было в
 * списке, бот стоял в звонке и писал тишину. UDP из сети встречи наружу нет, поэтому звук идёт
 * только так. `kontur.host` (сборщик ошибок) — другой домен и остаётся закрыт.
 *
 * Домены Google открыты суффиксом, но хосты, куда чужая страница может сама записать данные
 * и прочитать их снаружи (Apps Script, Документы, Диск, Сайты, облачное хранилище и т.п.),
 * закрыты явно: это те места, куда сессию можно было бы вынести, не покидая Google.
 */

export interface EgressPolicy {
  readonly exactTargets: ReadonlySet<string>;
}

interface EgressDenied {
  readonly allowed: false;
  readonly reason: string;
}

interface RuleAllowed {
  readonly allowed: true;
  readonly rule: string;
}

interface EgressAllowed extends RuleAllowed {
  /**
   * Куда соединяться: имя в нижнем регистре без точки в конце.
   */
  readonly host: string;
  readonly port: number;
}

export type EgressVerdict = EgressDenied | EgressAllowed;
type RuleVerdict = EgressDenied | RuleAllowed;

export interface EgressPolicyInput {
  /**
   * Корень функций Swarm, каким его видит контейнер (`SCRIBA_CONTAINER_SWARM_URL`).
   */
  readonly swarmUrl: string;
  /**
   * Добавка без правки кода — только точные `host:port`: хост, которого не хватило живой встрече.
   */
  readonly extraTargets?: readonly string[];
}

const WEB_PORT = 443;
const MEDIA_PORTS: readonly (readonly [number, number])[] = [
  [443, 443],
  [3478, 3478],
  [19_302, 19_309],
];

const WEB_SUFFIXES = ["google.com", "gstatic.com", "googleapis.com", "googleusercontent.com"];

const DENIED_SUFFIXES = [
  // Приложения и хранилища, куда страница пишет сама, а автор читает снаружи.
  "script.google.com",
  "script.googleusercontent.com",
  "docs.google.com",
  "drive.google.com",
  "sites.google.com",
  "mail.google.com",
  "groups.google.com",
  "calendar.google.com",
  "keep.google.com",
  "photos.google.com",
  "chat.google.com",
  "colab.research.google.com",
  // Переводчик тянет любой адрес от своего имени — это прокси наружу.
  "translate.google.com",
  "storage.googleapis.com",
  "firestore.googleapis.com",
  "firebasestorage.googleapis.com",
  "firebaseio.googleapis.com",
  "drive.googleapis.com",
  "docs.googleapis.com",
  "sheets.googleapis.com",
  "script.googleapis.com",
  "gmail.googleapis.com",
  "forms.googleapis.com",
  "pubsub.googleapis.com",
  "logging.googleapis.com",
  "bigquery.googleapis.com",
];

const MEDIA_HOST_SUFFIX = "turns.goog";

/**
Пространства Контур.Толка: `<имя>.ktalk.ru`.
*/
const KONTUR_SUFFIX = "ktalk.ru";
/**
Медиасерверы Толка (TURN по TLS): `<имя>.ktalk.host`.
*/
const KONTUR_MEDIA_SUFFIX = "ktalk.host";
const KONTUR_TALK_LABELS = 3;

/**
Вторая форма хоста Толка: ровно `talk.kontur.<зона>`, метки сверяются поштучно.
*/
function isKonturTalkHost(host: string): boolean {
  const labels = host.split(".");
  return labels.length === KONTUR_TALK_LABELS && labels[0] === "talk" && labels[1] === "kontur";
}

const MAX_PORT = 65_535;
const IPV4_OCTETS = 4;
const OCTET_MAX = 255;
const BITS = 32;
const HOSTNAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]*$/u;
const DOTTED_IPV4 = /^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/u;
const PORT = /^[1-9]\d{0,4}$/u;

export function parseAuthority(
  authority: string,
): { readonly host: string; readonly port: number } | null {
  let host: string;
  let portText: string;
  if (authority.startsWith("[")) {
    const close = authority.indexOf("]:");
    if (close === -1) return null;
    host = authority.slice(1, close);
    portText = authority.slice(close + 2);
  } else {
    const colon = authority.lastIndexOf(":");
    if (colon === -1) return null;
    host = authority.slice(0, colon);
    portText = authority.slice(colon + 1);
  }
  if (host === "" || !PORT.test(portText)) return null;
  const port = Number(portText);
  return port > MAX_PORT ? null : { host, port };
}

function ipv4ToNumber(address: string): number | null {
  if (!DOTTED_IPV4.test(address)) return null;
  const octets = address.split(".").map(Number);
  if (octets.length !== IPV4_OCTETS || octets.some((octet) => octet > OCTET_MAX)) return null;
  return octets.reduce((sum, octet) => sum * (OCTET_MAX + 1) + octet, 0);
}

function span(
  a: number,
  b: number,
  c: number,
  d: number,
  prefix: number,
): readonly [number, number] {
  const start = ((a * 256 + b) * 256 + c) * 256 + d;
  return [start, start + 2 ** (BITS - prefix)];
}

/**
 * Диапазоны медиа Meet: [первый адрес, адрес за последним).
 */
const MEET_MEDIA_SPANS = [
  span(74, 125, 250, 0, 24),
  span(74, 125, 247, 128, 32),
  span(142, 250, 82, 0, 24),
];

function isMeetMedia(address: number): boolean {
  return MEET_MEDIA_SPANS.some(([start, end]) => address >= start && address < end);
}

function isMediaPort(port: number): boolean {
  return MEDIA_PORTS.some(([from, to]) => port >= from && port <= to);
}

function isUnderSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function normalizeHost(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function decideHost(host: string, port: number): RuleVerdict {
  if (!HOSTNAME.test(host)) return { allowed: false, reason: "не имя и не адрес медиа Meet" };
  if (isUnderSuffix(host, MEDIA_HOST_SUFFIX)) {
    return isMediaPort(port)
      ? { allowed: true, rule: "медиа Meet (TURN)" }
      : { allowed: false, reason: "порт не медиа" };
  }
  if (isUnderSuffix(host, KONTUR_MEDIA_SUFFIX)) {
    return port === WEB_PORT
      ? { allowed: true, rule: "медиа Контур.Толка (TURN)" }
      : { allowed: false, reason: "у медиа Контур.Толка только 443" };
  }
  if (isUnderSuffix(host, KONTUR_SUFFIX) || isKonturTalkHost(host)) {
    return port === WEB_PORT
      ? { allowed: true, rule: "веб Контур.Толка" }
      : { allowed: false, reason: "у веба Контур.Толка только 443" };
  }
  if (DENIED_SUFFIXES.some((suffix) => isUnderSuffix(host, suffix))) {
    return { allowed: false, reason: "хост Google, куда страница может записать данные" };
  }
  if (WEB_SUFFIXES.every((suffix) => !isUnderSuffix(host, suffix))) {
    return { allowed: false, reason: "хост не в списке" };
  }
  return port === WEB_PORT
    ? { allowed: true, rule: "веб Google" }
    : { allowed: false, reason: "у веба Google только 443" };
}

function decideRule(host: string, port: number, policy: EgressPolicy): RuleVerdict {
  if (policy.exactTargets.has(`${host}:${String(port)}`)) {
    return { allowed: true, rule: "точный адрес (Swarm или добавка)" };
  }
  const address = ipv4ToNumber(host);
  if (address !== null) {
    return isMeetMedia(address) && isMediaPort(port)
      ? { allowed: true, rule: "медиа Meet (IP)" }
      : { allowed: false, reason: "IP вне медиа Meet" };
  }
  return decideHost(host, port);
}

export function decideEgress(target: string, policy: EgressPolicy): EgressVerdict {
  const parsed = parseAuthority(target);
  if (parsed === null) return { allowed: false, reason: "адрес не host:port" };
  const host = normalizeHost(parsed.host);
  const verdict = decideRule(host, parsed.port, policy);
  return verdict.allowed ? { ...verdict, host, port: parsed.port } : verdict;
}

function swarmTarget(swarmUrl: string): string {
  let url: URL;
  try {
    url = new URL(swarmUrl);
  } catch {
    throw new Error(`SCRIBA_CONTAINER_SWARM_URL не адрес: ${swarmUrl}`);
  }
  const defaultPort = { "http:": "80", "https:": "443" }[url.protocol];
  if (defaultPort === undefined) {
    throw new Error(`SCRIBA_CONTAINER_SWARM_URL не http(s): ${swarmUrl}`);
  }
  return `${normalizeHost(url.hostname)}:${url.port === "" ? defaultPort : url.port}`;
}

export function egressPolicy(input: EgressPolicyInput): EgressPolicy {
  const extra = (input.extraTargets ?? []).map((target) => {
    const parsed = parseAuthority(target);
    if (parsed === null) throw new Error(`добавка к списку egress не host:port: ${target}`);
    return `${normalizeHost(parsed.host)}:${String(parsed.port)}`;
  });
  return { exactTargets: new Set([swarmTarget(input.swarmUrl), ...extra]) };
}
