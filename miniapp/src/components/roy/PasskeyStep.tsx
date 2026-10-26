"use client";
// Второй шаг входа — палец (ключ доступа, #955). Ничего не рисует, пока всё идёт само: сразу после
// Google/Telegram на первой загрузке приложения сам открывает окно Touch ID — подтвердить сохранённый
// палец (в браузере с меткой) или сохранить новый (без метки). Без кнопки и без вопроса. Если окно
// не открылось или его закрыли — одна тихая строка-ссылка, клик повторяет; за один вход авто-попытка
// одна (lib/passkeyStep.ts). Логика выбора — там; здесь только браузерные вызовы.
// Подтверждение не удалось (ключ из этого браузера удалили, окно отменено) — метка снимается, и
// повтор сохраняет новый палец (решение 19.10.2026); QR и «другое устройство» не предлагаем.
import { useEffect, useRef, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Me } from "@/types";
import { useDt } from "./nav";
import {
  deviceName,
  failureNotice,
  HERE_KEY,
  shouldAutoStart,
  STEP_DONE_EVENT,
  STEP_REQUEST_EVENT,
  type StepNotice,
  stepPending,
  TRIED_KEY,
} from "@/lib/passkeyStep";

type CreationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];
type RequestOptions = Parameters<typeof startAuthentication>[0]["optionsJSON"];

function readKey(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // приватное окно: без метки — только без автозапуска
  }
}

function writeKey(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch { /* хранилище закрыто — переживём */ }
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) as Record<string, unknown> };
}

class StepFailed extends Error {}

/** Один проход: вызов → окно устройства → проверка. Режим (create/get) выбирает сервер по ключам человека.
 *  Им же пользуется экран-замок SecondStepGate (шаг обязателен — внутрь без него не пускаем). */
export async function runStep(): Promise<{ done: boolean; notice?: StepNotice }> {
  // Метка «ключ есть здесь» решает режим: без неё сервер всегда просит сохранить палец (create).
  const opts = await postJson("/api/auth/passkey/options", { here: readKey(HERE_KEY) === "1" });
  const mode = opts.data.mode as "create" | "get" | undefined;
  if (!opts.ok || !mode || !opts.data.options) return { done: false, notice: "enable_link" };
  try {
    const credential = mode === "create"
      ? await startRegistration({ optionsJSON: opts.data.options as CreationOptions })
      : await startAuthentication({ optionsJSON: opts.data.options as RequestOptions });
    const res = await postJson("/api/auth/passkey/verify", { name: deviceName(navigator.userAgent), credential });
    if (!res.ok) throw new StepFailed();
    writeKey(HERE_KEY, "1");
    return { done: true };
  } catch {
    // Закрыли окно, нет ключа на устройстве, браузер не дал открыть без жеста, сервер отказал.
    // Подтверждение не вышло — метка устарела (ключ удалили): снимаем, следующий заход пойдёт как create.
    if (mode === "get") writeKey(HERE_KEY, null);
    return { done: false, notice: failureNotice(mode) };
  }
}

export function PasskeyStep({ me }: { me: Me | null }) {
  const dt = useDt();
  const pending = stepPending(me);
  const [done, setDone] = useState(false);
  const [notice, setNotice] = useState<StepNotice | null>(null);
  const busy = useRef(false);
  const started = useRef(false);

  async function attempt(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setNotice(null);
    try {
      const r = await runStep();
      if (r.done) {
        setDone(true);
        window.dispatchEvent(new Event(STEP_DONE_EVENT));
      } else setNotice(r.notice ?? "enable_link");
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    if (!pending || started.current || !browserSupportsWebAuthn()) return;
    started.current = true;
    if (shouldAutoStart(pending.session, readKey(TRIED_KEY))) {
      writeKey(TRIED_KEY, String(pending.session));
      void attempt();
    } else {
      setNotice("enable_link");
    }
    // attempt читает только ref-ы и localStorage: зависимость от него зациклила бы эффект.
  }, [pending]);

  // Стикер-напоминание на главной (home/StickerBoard.tsx) просит ту же привязку — вызов один и тот же.
  useEffect(() => {
    if (!pending || done) return;
    const onRequest = () => void attempt();
    window.addEventListener(STEP_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(STEP_REQUEST_EVENT, onRequest);
    // attempt читает только ref-ы и localStorage: зависимость от него пересоздавала бы слушатель зря.
  }, [pending, done]);

  if (!pending || done || !notice) return null;
  return (
    <div className="shrink-0 px-4 py-1 text-center text-muted-foreground" style={{ fontSize: 12 }}>
      <button type="button" onClick={() => void attempt()} className="underline underline-offset-2">
        {dt("Включить вход по Touch ID в этом браузере", "Turn on Touch ID sign-in in this browser")}
      </button>
    </div>
  );
}
