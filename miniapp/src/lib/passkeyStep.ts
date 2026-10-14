// Второй шаг входа — палец (ключ доступа, #955), чистая логика без браузерных API.
// Первый шаг всегда Google (или Telegram); сразу после него приложение само просит палец:
// метка `swarm.passkey.here` в браузере + ключи у человека → подтвердить (get), иначе → сохранить (create).
// Без кнопок; если окно не открылось (браузер хочет жест) или его закрыли — одна строка-ссылка,
// отказ помнится до следующего входа.
import type { Me } from "@/types";

/** Метка «ключ тут сохранён»: ключ живёт в том браузере, где создан, — в другом окно показало бы QR. */
export const HERE_KEY = "swarm.passkey.here";
/** За какой вход (me.second_step.session) авто-попытка уже была: на каждой странице не дёргаем. */
export const TRIED_KEY = "swarm.passkey.tried";

export type SecondStep = NonNullable<Me["second_step"]>;

/** Нужно ли вообще что-то делать в этой сессии. */
export function stepPending(me: Me | null): SecondStep | null {
  const s = me?.second_step;
  if (!s || me?.is_demo || !s.applies || s.done) return null;
  return s;
}

/** Авто-попытка — один раз на вход; повтор только по клику на строку-ссылку. */
export function shouldAutoStart(session: number | null, triedFor: string | null): boolean {
  return triedFor !== String(session);
}

/** «Chrome · Mac»: имя ключа по браузеру и системе, чтобы не спрашивать его у человека. */
export function deviceName(ua: string): string {
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}

/** Что делать после осечки окна. */
export type StepFailure = "already_here" | "retry_link";

/**
 * InvalidStateError при сохранении — на этом устройстве ключ уже есть, просто метка потерялась:
 * ставим метку и подтверждаем им. Всё остальное (закрыли окно, браузер не дал открыть без жеста,
 * сервер отказал) — тихая строка-ссылка.
 */
export function classifyFailure(mode: "create" | "get", errName: string | undefined): StepFailure {
  return mode === "create" && errName === "InvalidStateError" ? "already_here" : "retry_link";
}
