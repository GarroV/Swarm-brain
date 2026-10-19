// Второй шаг входа — палец (ключ доступа, #955), чистая логика без браузерных API.
// Первый шаг всегда Google (или Telegram); сразу после него приложение само просит палец. Режим
// выбирает СЕРВЕР по ключам человека (решение владельца 14.10.2026): ни одного ключа — сохранить
// палец сам (create); ключи есть — только подтвердить (get), в новом браузере тоже: синхронизированный
// ключ подтянется, нового не заводим. Без кнопок; не вышло — одна тихая строка (failureNotice).
// Метка `swarm.passkey.here` ставится после успеха (место для второй части — код из аутентификатора).
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

/** Какая строка показывается после осечки окна. */
export type StepNotice = "enable_link";

/**
 * Осечка окна (закрыли, браузер не дал открыть без жеста, на устройстве нет ключа) — одна тихая
 * строка-ссылка «Включить вход по Touch ID»: клик повторяет шаг. Если осечка была при подтверждении
 * (метка стояла, а ключа здесь уже нет), веб снимает метку — повтор пойдёт как сохранение нового
 * пальца (решение 19.10.2026: никаких «используйте другое устройство»).
 */
export function failureNotice(_mode: "create" | "get"): StepNotice {
  return "enable_link";
}
