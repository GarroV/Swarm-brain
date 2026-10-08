/**
 * TURN Толка для бота: какие медиасерверы брать и дошёл ли звук.
 *
 * У бота нет UDP из сети встречи, поэтому медиа звонка идёт только через TURN по TLS на 443
 * (`turns:<имя>.ktalk.host:443`). Толк выдаёт звонку по два таких сервера, и часть из них
 * соединение принимает, а медиа не пропускает: ICE «connected», за минуту приходит 5 пакетов,
 * бот пишет тишину −91 dB. Доказано живой пробой 08.10.2026 в одной комнате и одним голосом:
 * пара `sd2-talk-stun4` + `bst-talk-stun2` — тишина, пара `dtl-talk-stun5` + `bst-talk-stun7` —
 * речь −29 dB; с UDP «плохая» пара тоже даёт речь. Учётные данные TURN у Толка общие на парк
 * серверов, поэтому бот подменяет хосты `turns:` на проверенные и ничего больше не трогает
 * (issue #861).
 *
 * Обе функции уходят в браузер (`addInitScript` / `evaluate`), поэтому самодостаточны: ни
 * импортов, ни замыканий на модуль.
 */

/**
Проверенные TURN-серверы Толка (TLS, 443). Порядок — как Толк сам выдаёт их рабочим звонкам.
*/
export const KONTUR_TURN_RELAYS: readonly string[] = [
  "dtl-talk-stun5.ktalk.host",
  "bst-talk-stun7.ktalk.host",
];

/**
Имя глобала, под которым страница держит созданные соединения для `collectAudioHealth`.
*/
export const PEERS_GLOBAL = "__scribaPeers";

interface IceServerLike {
  readonly urls?: string | readonly string[];
  readonly url?: string;
  readonly [key: string]: unknown;
}

interface PeerConfigLike {
  readonly iceServers?: readonly IceServerLike[];
  readonly [key: string]: unknown;
}

type PeerConstructor = new (config?: PeerConfigLike, ...rest: unknown[]) => object;

/**
 * Подменяет `RTCPeerConnection` страницы: хост каждого `turns:*.ktalk.host` вне `relays`
 * меняется на проверенный (по кругу), остальное в конфиге остаётся как есть. Созданные
 * соединения складываются в `globalThis[peersGlobal]`, чтобы адаптер мог спросить статистику.
 */
export function pinTurnRelays(options: {
  readonly relays: readonly string[];
  readonly peersGlobal: string;
}): void {
  const scope = globalThis as unknown as Record<string, unknown>;
  const Original = scope.RTCPeerConnection as PeerConstructor | undefined;
  if (typeof Original !== "function" || options.relays.length === 0) return;
  const Peer: PeerConstructor = Original;

  const peers: object[] = [];
  scope[options.peersGlobal] = peers;
  const turns = /^turns:([^:?/]+\.ktalk\.host)(.*)$/i;

  const pin = (config: PeerConfigLike | undefined): PeerConfigLike | undefined => {
    if (config?.iceServers === undefined) return config;
    let index = 0;
    const fix = (url: string): string => {
      const match = turns.exec(url);
      if (match === null) return url;
      const host = (match[1] ?? "").toLowerCase();
      const relay = options.relays.includes(host)
        ? host
        : (options.relays[index % options.relays.length] ?? host);
      index += 1;
      return `turns:${relay}${match[2] ?? ""}`;
    };
    const iceServers = config.iceServers.map((server) => {
      const raw = server.urls ?? server.url;
      if (raw === undefined) return server;
      const urls = typeof raw === "string" ? fix(raw) : raw.map(fix);
      return { ...server, urls };
    });
    return { ...config, iceServers };
  };

  function Pinned(config?: PeerConfigLike, ...rest: unknown[]): object {
    const peer = new Peer(pin(config), ...rest);
    peers.push(peer);
    return peer;
  }
  Pinned.prototype = Peer.prototype as object;
  Object.setPrototypeOf(Pinned, Peer);
  scope.RTCPeerConnection = Pinned;
}

export interface AudioHealth {
  /**
  Сколько соединений страница создала.
  */
  readonly peers: number;
  /**
  Сумма `packetsReceived` всех входящих аудиопотоков.
  */
  readonly packets: number;
  /**
  TURN/STUN выбранной пары кандидатов, `null` — пары ещё нет.
  */
  readonly path: string | null;
}

/**
Статистика входящего звука по соединениям из `pinTurnRelays`. Выполняется в странице.
*/
export async function collectAudioHealth(peersGlobal: string): Promise<AudioHealth> {
  interface Stat {
    readonly id: string;
    readonly type: string;
    readonly kind?: string;
    readonly packetsReceived?: number;
    readonly selectedCandidatePairId?: string;
    readonly localCandidateId?: string;
    readonly url?: string;
    readonly candidateType?: string;
  }
  interface Peer {
    getStats(): Promise<{ forEach(callback: (stat: Stat) => void): void }>;
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  const peers = (scope[peersGlobal] as Peer[] | undefined) ?? [];
  let packets = 0;
  let path: string | null = null;
  for (const peer of peers) {
    const report = await peer.getStats();
    const stats: Stat[] = [];
    report.forEach((stat) => {
      stats.push(stat);
    });
    const byId = new Map(stats.map((stat) => [stat.id, stat]));
    for (const stat of stats) {
      if (stat.type === "inbound-rtp" && stat.kind === "audio")
        packets += stat.packetsReceived ?? 0;
      if (
        path === null &&
        stat.type === "transport" &&
        stat.selectedCandidatePairId !== undefined
      ) {
        const local = byId.get(byId.get(stat.selectedCandidatePairId)?.localCandidateId ?? "");
        if (local !== undefined) path = `${local.candidateType ?? "?"} ${local.url ?? ""}`.trim();
      }
    }
  }
  return { peers: peers.length, packets, path };
}
