// Дедуп вкладок/окон приложения при открытии встречи из уведомления «тезисы готовы».
//
// Кнопка бота — обычная ссылка `?meeting=<id>`. Telegram Desktop открывает её новой
// вкладкой браузера каждый раз. Цель: переиспользовать уже открытую вкладку/окно PWA
// вместо плодящихся вкладок.
//
// Два механизма (см. docs/superpowers/specs/2026-06-17-single-tab-reuse-design.md):
//  1. Установленный PWA — manifest `launch_handler: focus-existing` + `handle_links`
//     роутят ссылку в существующее окно; здесь подключаем launchQueue-consumer.
//  2. Обычный браузер — лидер-вкладка (navigator.locks) + BroadcastChannel:
//     новая вкладка с deep-link отдаёт встречу лидеру и закрывается.
//
// Обе ветки сходятся в событии `roy:open-meeting`, которое слушает RoyApp.

const CHANNEL = "swarm-tabs";
const LEADER_LOCK = "swarm-leader";
const HANDOFF_TIMEOUT_MS = 250;

export const OPEN_MEETING_EVENT = "roy:open-meeting";

type ClaimMsg = { type: "claim"; nonce: string; meetingId: string };
type AckMsg = { type: "ack"; nonce: string };
type TabMsg = ClaimMsg | AckMsg;

type LaunchParams = { targetURL?: string };
type LaunchQueue = { setConsumer: (cb: (params: LaunchParams) => void) => void };

// Сообщаем приложению, какую встречу открыть в этом инстансе, и синхронизируем URL
// (чтобы рефреш/«назад» были консистентны с показанной встречей).
function emitOpenMeeting(id: string): void {
  try {
    window.history.replaceState({}, "", `/?meeting=${encodeURIComponent(id)}`);
  } catch {
    /* приватный режим / запрет history — не критично */
  }
  window.dispatchEvent(new CustomEvent(OPEN_MEETING_EVENT, { detail: { id } }));
}

function parseMeetingId(rawUrl: string): string | null {
  try {
    const id = new URL(rawUrl, window.location.origin).searchParams.get("meeting");
    return id && id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

function makeNonce(): string {
  // Обычный рантайм браузера — Math.random здесь допустим (это не workflow-скрипт).
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Вызывается НОВОЙ вкладкой до тяжёлого рендера, если в URL есть deep-link.
// true → встречу подхватила другая вкладка, эту нужно закрыть.
export async function tryHandoff(meetingId: string): Promise<boolean> {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return false;
  const ch = new BroadcastChannel(CHANNEL);
  const nonce = makeNonce();
  try {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), HANDOFF_TIMEOUT_MS);
      ch.onmessage = (e: MessageEvent<TabMsg>) => {
        const m = e.data;
        if (m && m.type === "ack" && m.nonce === nonce) {
          clearTimeout(timer);
          resolve(true);
        }
      };
      const claim: ClaimMsg = { type: "claim", nonce, meetingId };
      ch.postMessage(claim);
    });
  } finally {
    // Канал хэндоффа этой вкладке больше не нужен: она либо закрывается, либо станет
    // лидером и откроет собственный канал в registerInstance().
    ch.close();
  }
}

let registered = false;

// Вызывается работающим инстансом (страница рендерится). Делает вкладку лидером, если
// лидера ещё нет, отвечает на claim'ы от новых вкладок и слушает launchQueue (PWA).
// Идемпотентна.
export function registerInstance(): void {
  if (typeof window === "undefined" || registered) return;
  registered = true;

  // Установленный PWA (focus-existing): целевой URL запуска приходит сюда.
  const lq = (window as unknown as { launchQueue?: LaunchQueue }).launchQueue;
  if (lq && typeof lq.setConsumer === "function") {
    lq.setConsumer((params) => {
      const id = params.targetURL ? parseMeetingId(params.targetURL) : null;
      if (id) {
        try { window.focus(); } catch { /* фокус не гарантирован браузером */ }
        emitOpenMeeting(id);
      }
    });
  }

  if (typeof BroadcastChannel === "undefined") return;
  const ch = new BroadcastChannel(CHANNEL);

  const serveClaims = () => {
    ch.onmessage = (e: MessageEvent<TabMsg>) => {
      const m = e.data;
      if (!m || m.type !== "claim") return;
      try { window.focus(); } catch { /* фокус не гарантирован браузером */ }
      emitOpenMeeting(m.meetingId);
      const ack: AckMsg = { type: "ack", nonce: m.nonce };
      ch.postMessage(ack);
    };
  };

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (locks && typeof locks.request === "function") {
    // Эксклюзивный лок держим всё время жизни вкладки → ровно один лидер; при его
    // закрытии лок освобождается и следующая вкладка из очереди берёт лидерство.
    locks
      .request(LEADER_LOCK, { mode: "exclusive" }, () => {
        serveClaims();
        return new Promise<void>(() => { /* держим вечно, пока вкладка жива */ });
      })
      .catch(() => { /* прервано/нет поддержки — деградируем без лидерства */ });
  } else {
    // Без Web Locks отвечают все вкладки; редкий старый браузер, дубль не критичен.
    serveClaims();
  }
}
