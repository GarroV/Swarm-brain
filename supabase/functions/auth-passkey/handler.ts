// auth-passkey: проверка ключа доступа для CF Pages Functions (второй шаг входа, #955).
// Аутентификация ВЫЗОВА, не человека: HMAC на WEB_JWT_SECRET поверх тела (тот же приём, что у
// auth-resolve), плюс метка времени против повтора. Сессию человека проверяет Pages Function
// (кука roj_session + GET /me) и называет его telegram_id; эта функция сессий не выдаёт —
// она только говорит, прошёл ли шаг. Куку с отметкой «шаг пройден» ставит Pages.
// Операции: start/finish — второй шаг; enroll_start/enroll_finish — ключ нового устройства по
// ссылке «Добавить устройство» (ссылку выдаёт swarm-api, POST /me/passkeys/device-link).
import { timingSafeEq } from "../_shared/timing-safe.ts";
import { finishStep, startStep, type StepDeps } from "../_shared/passkeys/flow.ts";
import { finishEnrollment, startEnrollment } from "../_shared/passkeys/device-link.ts";

/** Запрос свежее этого — принимается; старше — повтор чужого вызова. */
export const MAX_REQUEST_AGE_MS = 60 * 1000;

const enc = new TextEncoder();

export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type HandlerDeps = StepDeps & {
  secret: string;
  /** Имя для окна ключа; null — человека нет в allowed_users (удалён): шаг ему не нужен. */
  userNameOf: (telegramId: number) => Promise<string | null>;
};

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

type Body = {
  op?: unknown;
  ts?: unknown;
  telegram_id?: unknown;
  origin?: unknown;
  here?: unknown;
  name?: unknown;
  credential?: unknown;
  token?: unknown;
};

export async function handlePasskeyRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!deps.secret) return json({ error: "not configured" }, 500);
  const now = deps.now ?? Date.now;

  const raw = await req.text();
  const sig = req.headers.get("x-sig") ?? "";
  if (!sig || !timingSafeEq(sig, await hmacHex(deps.secret, raw))) return json({ error: "forbidden" }, 403);
  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (typeof body.ts !== "number" || Math.abs(now() - body.ts) > MAX_REQUEST_AGE_MS) {
    return json({ error: "stale" }, 403);
  }
  const telegramId = body.telegram_id;
  if (typeof telegramId !== "number" || !Number.isSafeInteger(telegramId)) return json({ error: "bad request" }, 400);

  const userName = await deps.userNameOf(telegramId);
  if (userName === null) return json({ ok: false, reason: "unknown_user" }, 403);

  if (body.op === "start") {
    const r = await startStep(deps, { telegramId, origin: body.origin, userName, here: body.here === true });
    if (r.ok) return json({ ok: true, mode: r.mode, options: r.options });
    return json({ ok: false, reason: r.reason }, r.reason === "throttled" ? 429 : 403);
  }
  if (body.op === "finish") {
    const r = await finishStep(deps, { telegramId, origin: body.origin, name: body.name, credential: body.credential });
    if (r.ok) return json({ ok: true, mode: r.mode });
    return json({ ok: false, reason: r.reason }, r.reason === "failed" ? 401 : 403);
  }
  // «Добавить устройство» (решение 17.10.2026): телефон по одноразовой ссылке заводит свой ключ.
  if (body.op === "enroll_start") {
    const r = await startEnrollment(deps, { telegramId, origin: body.origin, userName, token: body.token });
    if (r.ok) return json({ ok: true, options: r.options });
    return json({ ok: false, reason: r.reason }, r.reason === "invalid" ? 410 : 403);
  }
  if (body.op === "enroll_finish") {
    const r = await finishEnrollment(deps, {
      telegramId,
      origin: body.origin,
      token: body.token,
      name: body.name,
      credential: body.credential,
    });
    if (r.ok) return json({ ok: true });
    return json({ ok: false, reason: r.reason }, r.reason === "failed" ? 401 : 403);
  }
  return json({ error: "bad op" }, 400);
}
