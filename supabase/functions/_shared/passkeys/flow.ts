// Второй шаг входа ключом доступа (#955): ядро доступа. Две операции, обе под сессией человека
// (после Google или Telegram), ни одна не открывает сессию с нуля.
//   startStep  — выдать вызов: сохранить новый ключ (create) или подтвердить сохранённый (get).
//   finishStep — принять ответ браузера и сказать, прошёл ли шаг.
// Правила, ради которых файл — ядро: вызов живёт 2 минуты и снимается при первом предъявлении
// ДО разбора ответа; origin — строго по списку; ключ должен принадлежать этому человеку; счётчик
// подписей только растёт; осечки наружу — один ответ, без различий («failed»).
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "npm:@simplewebauthn/server@14";
import { isDemoSession } from "../demo-session.ts";
import {
  CHALLENGE_TTL_MS,
  CLIENT_DEVICE_HINTS,
  MAX_CHALLENGES_PER_WINDOW,
  relyingPartyFor,
  RP_NAME,
  THROTTLE_WINDOW_MS,
} from "./rp.ts";
import type { PasskeyStore } from "./store.ts";

export type StepDeps = { store: PasskeyStore; now?: () => number };

export type StartResult =
  | { ok: true; mode: "create" | "get"; options: Record<string, unknown> }
  | { ok: false; reason: "origin" | "throttled" | "not_applicable" };

export type FinishResult =
  | { ok: true; mode: "create" | "get" }
  | { ok: false; reason: "origin" | "not_applicable" | "failed" };

const NAME_MAX = 64;
const enc = new TextEncoder();

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const norm = text.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(norm + "=".repeat((4 - (norm.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function cleanDeviceName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, NAME_MAX) : "";
  return name || "Browser";
}

/**
 * Выдать вызов. Правило владельца 19.10.2026 («если там ещё нет Touch ID — логично запустить привязку»,
 * пересмотр решения 14.10.2026): режим зависит от того, есть ли ключ В ЭТОМ браузере (`here` — метка
 * `swarm.passkey.here`, которую шлёт веб):
 *   • ключи у человека есть И браузер говорит «ключ здесь» — подтверждение (get, с перечнем ключей);
 *   • иначе (ключей нет вовсе, или в этом браузере ключа нет) — сохранить палец сам (create), с
 *     excludeCredentials = уже заведённые ключи, чтобы тот же датчик не завёл двойник.
 * Новый браузер так не упирается в QR и «нет подходящих ключей» (docs/decisions/2026-10-19-passkey-new-browser-binds.md).
 */
export async function startStep(
  deps: StepDeps,
  input: { telegramId: number; origin: unknown; userName: string; here: boolean },
): Promise<StartResult> {
  const now = deps.now ?? Date.now;
  const rp = relyingPartyFor(input.origin);
  if (!rp) return { ok: false, reason: "origin" };
  if (isDemoSession(input.telegramId)) return { ok: false, reason: "not_applicable" };

  const issued = await deps.store.countChallengesSince(input.telegramId, now() - THROTTLE_WINDOW_MS);
  if (issued >= MAX_CHALLENGES_PER_WINDOW) return { ok: false, reason: "throttled" };

  const keys = await deps.store.listForPerson(input.telegramId);
  const confirm = keys.length > 0 && input.here === true;
  const descriptors = keys.map((k) => ({ id: k.credentialId, transports: k.transports }));

  if (confirm) {
    const options = await generateAuthenticationOptions({
      rpID: rp.rpID,
      allowCredentials: descriptors,
      userVerification: "required",
      timeout: CHALLENGE_TTL_MS,
    });
    await deps.store.putChallenge(input.telegramId, "authenticate", options.challenge, now() + CHALLENGE_TTL_MS);
    // Библиотека поля `hints` не знает: окно должно предложить встроенный датчик, а не QR.
    return { ok: true, mode: "get", options: { ...options, hints: [...CLIENT_DEVICE_HINTS] } };
  }

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: input.userName,
    userID: enc.encode(String(input.telegramId)),
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
    excludeCredentials: descriptors,
    timeout: CHALLENGE_TTL_MS,
  });
  await deps.store.putChallenge(input.telegramId, "register", options.challenge, now() + CHALLENGE_TTL_MS);
  return { ok: true, mode: "create", options: { ...options, hints: [...CLIENT_DEVICE_HINTS] } };
}

/** Принять ответ браузера. Любая осечка — `failed`: по различиям перебирающий узнавал бы, что заведено. */
export async function finishStep(
  deps: StepDeps,
  input: { telegramId: number; origin: unknown; name?: unknown; credential: unknown },
): Promise<FinishResult> {
  const now = deps.now ?? Date.now;
  const rp = relyingPartyFor(input.origin);
  if (!rp) return { ok: false, reason: "origin" };
  if (isDemoSession(input.telegramId)) return { ok: false, reason: "not_applicable" };

  // Вызов снимается ВСЕГДА, до разбора ответа: попытка потрачена, повторить тем же вызовом нельзя.
  const challenge = await deps.store.takeChallenge(input.telegramId, now());
  if (!challenge) return { ok: false, reason: "failed" };

  try {
    const credential = input.credential as { id?: unknown };
    if (!credential || typeof credential.id !== "string") return { ok: false, reason: "failed" };
    return challenge.purpose === "register"
      ? await finishRegistration(deps, input, rp, challenge.challenge)
      : await finishConfirmation(deps, input, rp, challenge.challenge);
  } catch (_e) {
    // Битый ответ, чужая подпись, откат счётчика — наружу одно и то же.
    return { ok: false, reason: "failed" };
  }
}

type Rp = { rpID: string; origin: string };
type FinishInput = { telegramId: number; credential: unknown; name?: unknown };

async function finishRegistration(
  deps: StepDeps,
  input: FinishInput,
  rp: Rp,
  expectedChallenge: string,
): Promise<FinishResult> {
  // deno-lint-ignore no-explicit-any
  const response = input.credential as any;
  const verified = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    requireUserVerification: true,
  });
  if (!verified.verified) return { ok: false, reason: "failed" };
  const cred = verified.registrationInfo.credential;
  // Номер уже занят — тот же ключ сохранён раньше (двойной клик): шаг всё равно пройден,
  // но ЧУЖОЙ ключ под своим именем так не присвоить: проверяем владельца.
  const stored = await deps.store.insertPasskey({
    telegramId: input.telegramId,
    credentialId: cred.id,
    publicKey: toBase64Url(cred.publicKey),
    signCount: cred.counter,
    transports: cred.transports ?? [],
    name: cleanDeviceName(input.name),
  });
  if (!stored) {
    const existing = await deps.store.findByCredential(cred.id);
    if (existing?.telegramId !== input.telegramId) return { ok: false, reason: "failed" };
  }
  return { ok: true, mode: "create" };
}

async function finishConfirmation(
  deps: StepDeps,
  input: FinishInput,
  rp: Rp,
  expectedChallenge: string,
): Promise<FinishResult> {
  // deno-lint-ignore no-explicit-any
  const response = input.credential as any;
  const key = await deps.store.findByCredential(response.id);
  // Ключ должен быть заведён ЭТИМ человеком: чужой ключ с чужой подписью сессию не подтверждает.
  if (!key || key.telegramId !== input.telegramId) return { ok: false, reason: "failed" };
  const verified = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: rp.origin,
    expectedRPID: rp.rpID,
    credential: {
      id: key.credentialId,
      publicKey: fromBase64Url(key.publicKey),
      counter: key.signCount,
      transports: key.transports as never,
    },
    requireUserVerification: true,
  });
  if (!verified.verified) return { ok: false, reason: "failed" };
  const accepted = await deps.store.touchPasskey(key.id, key.signCount, verified.authenticationInfo.newCounter);
  return accepted ? { ok: true, mode: "get" } : { ok: false, reason: "failed" };
}
