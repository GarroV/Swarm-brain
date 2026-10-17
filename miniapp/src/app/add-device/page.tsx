"use client";
// «Добавить устройство» (решение владельца 17.10.2026, docs/decisions/2026-10-17-passkey-add-device.md):
// сюда ведёт одноразовая ссылка `/add-device#t=<токен>` из профиля устройства, где вход подтверждён
// ключом. Под СВОЕЙ сессией того же человека телефон заводит свой ключ (Face ID), и второй шаг этой
// сессии засчитывается. Нет сессии — просим войти; токен ждёт в localStorage и возвращается после входа.
// Окно ключа открывается по нажатию: Safari не открывает его без жеста.
import { useEffect, useRef, useState } from "react";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { fetchMe } from "@/lib/api";
import { deviceName } from "@/lib/passkeyStep";
import {
  ADD_DEVICE_PATH,
  encodePending,
  type EnrollFailure,
  enrollFailure,
  PENDING_KEY,
  readPending,
  tokenFromHash,
} from "@/lib/passkeyDevices";
import { useDt } from "@/components/roy/nav";
import { Button } from "@/components/ui/button";

type CreationOptions = Parameters<typeof startRegistration>[0]["optionsJSON"];

type Stage =
  | "loading"
  | "no_link"
  | "login"
  | "not_applicable"
  | "unsupported"
  | "ready"
  | "busy"
  | "done"
  | EnrollFailure;

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // приватное окно: токен живёт только в адресе
  }
}

async function postJson(url: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) as Record<string, unknown> };
}

/** Один проход: вызов → окно устройства → приём. Успех — null, иначе что показать. */
async function enroll(token: string): Promise<EnrollFailure | null> {
  const opts = await postJson("/api/auth/passkey/enroll-options", { token });
  if (opts.status !== 200 || !opts.data.options) return enrollFailure("options", opts.status);
  let credential: unknown;
  try {
    credential = await startRegistration({ optionsJSON: opts.data.options as CreationOptions });
  } catch (e: unknown) {
    return enrollFailure("device", 0, (e as { name?: string }).name);
  }
  const res = await postJson("/api/auth/passkey/enroll-verify", {
    token,
    name: deviceName(navigator.userAgent),
    credential,
  });
  return res.status === 200 ? null : enrollFailure("verify", res.status);
}

export default function AddDevicePage() {
  const dt = useDt();
  const [stage, setStage] = useState<Stage>("loading");
  const token = useRef<string | null>(null);

  useEffect(() => {
    const store = storage();
    const fromHash = tokenFromHash(window.location.hash);
    if (fromHash) {
      store?.setItem(PENDING_KEY, encodePending(fromHash, Date.now()));
      // Токен уходит из адресной строки: не попадёт в историю и в скриншот.
      window.history.replaceState(null, "", ADD_DEVICE_PATH);
    }
    token.current = fromHash ?? readPending(store?.getItem(PENDING_KEY) ?? null, Date.now());
    if (!token.current) {
      setStage("no_link");
      return;
    }
    fetchMe()
      .then((me) => {
        if (!me.second_step?.applies) setStage("not_applicable");
        else if (!browserSupportsWebAuthn()) setStage("unsupported");
        else setStage("ready");
      })
      .catch((err: unknown) => {
        setStage((err as { status?: number }).status === 401 ? "login" : "failed");
      });
  }, []);

  async function save(): Promise<void> {
    if (!token.current) return;
    setStage("busy");
    const failure = await enroll(token.current).catch(() => "failed" as const);
    if (failure === null || failure === "invalid" || failure === "exists") storage()?.removeItem(PENDING_KEY);
    setStage(failure ?? "done");
  }

  const text: Record<Stage, string> = {
    loading: dt("Загрузка…", "Loading…"),
    no_link: dt(
      "Ссылка не найдена. Откройте профиль на устройстве, где ключ есть, и нажмите «Добавить устройство».",
      "No link found. Open your profile on a device that has a key and tap “Add device”.",
    ),
    login: dt(
      "Сначала войдите тем же аккаунтом — после входа вы вернётесь сюда. Если нет, откройте ссылку снова.",
      "Sign in with the same account first — you'll come back here afterwards. If not, open the link again.",
    ),
    not_applicable: dt("Для этого входа ключи не используются.", "Keys aren't used for this sign-in."),
    unsupported: dt(
      "Этот браузер не умеет сохранять ключи. Откройте ссылку в Safari или Chrome.",
      "This browser can't save keys. Open the link in Safari or Chrome.",
    ),
    ready: dt(
      "Сохраните ключ на этом устройстве — дальше вход здесь будет подтверждаться Face ID или Touch ID.",
      "Save a key on this device — from then on sign-in here is confirmed with Face ID or Touch ID.",
    ),
    busy: dt("Сохраняю ключ…", "Saving the key…"),
    done: dt("Готово: ключ сохранён, вход на этом устройстве подтверждён.", "Done: the key is saved and sign-in on this device is confirmed."),
    invalid: dt(
      "Ссылка недействительна: истекла, уже использована или выдана другому аккаунту. Получите новую в профиле.",
      "This link is no longer valid: it expired, was already used, or belongs to another account. Get a new one in your profile.",
    ),
    exists: dt("На этом устройстве ключ уже есть.", "This device already has a key."),
    cancelled: dt("Ключ не сохранён. Можно попробовать ещё раз.", "The key wasn't saved. You can try again."),
    failed: dt("Не получилось. Попробуйте ещё раз.", "Something went wrong. Please try again."),
  };

  const canSave = stage === "ready" || stage === "cancelled" || stage === "failed";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-4 rounded-2xl border border-line bg-surface p-6 text-center">
        <h1 className="text-lg font-bold text-ink">{dt("Добавить устройство", "Add device")}</h1>
        <p role="status" className="text-sm text-ink-soft">{text[stage]}</p>
        {canSave && token.current && (
          <Button onClick={() => void save()} className="w-full">
            {dt("Сохранить ключ", "Save key")}
          </Button>
        )}
        {stage === "login" && (
          <Button onClick={() => { window.location.href = `/login?next=${encodeURIComponent(ADD_DEVICE_PATH)}`; }} className="w-full">
            {dt("Войти", "Sign in")}
          </Button>
        )}
        {(stage === "done" || stage === "exists") && (
          <Button onClick={() => { window.location.href = "/"; }} className="w-full">
            {dt("Открыть Swarm", "Open Swarm")}
          </Button>
        )}
      </div>
    </main>
  );
}
