// «Добавить устройство» (решение владельца 17.10.2026, docs/decisions/2026-10-17-passkey-add-device.md):
// устройство, где вход уже подтверждён ключом, выдаёт одноразовую ссылку; телефон того же человека
// открывает её под своей сессией и заводит свой ключ (Face ID). Ядро доступа, три операции:
//   issueDeviceLink  — выдать ссылку (только сессии с пройденным вторым шагом);
//   startEnrollment  — по ссылке выдать вызов регистрации (взводит вызов на строке ссылки);
//   finishEnrollment — гасит ссылку ОДНИМ условным UPDATE и только потом разбирает ответ.
// Правило 14.10 «под неподтверждённой сессией новый ключ не заводим» не ослабляется: доказательство
// владения ключом приносит ссылка, выданная подтверждённой сессией того же человека.
import { generateRegistrationOptions, verifyRegistrationResponse } from "npm:@simplewebauthn/server@14";
import { isDemoSession } from "../demo-session.ts";
import { cleanDeviceName, toBase64Url } from "./flow.ts";
import { CHALLENGE_TTL_MS, CLIENT_DEVICE_HINTS, relyingPartyFor, RP_NAME } from "./rp.ts";
import type { PasskeyStore } from "./store.ts";

/** Ссылка живёт 10 минут. */
export const DEVICE_LINK_TTL_MS = 10 * 60 * 1000;
/** Не больше стольких ссылок на человека за окно — иначе 429. */
export const MAX_DEVICE_LINKS_PER_WINDOW = 5;
export const DEVICE_LINK_WINDOW_MS = 60 * 60 * 1000;
const TOKEN_BYTES = 32;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export type LinkDeps = { store: PasskeyStore; now?: () => number };

export type IssueResult =
  | { ok: true; token: string; expiresAt: number }
  | { ok: false; reason: "second_step_required" | "throttled" | "not_applicable" };

export type EnrollStartResult =
  | { ok: true; options: Record<string, unknown> }
  | { ok: false; reason: "origin" | "not_applicable" | "invalid" };

export type EnrollFinishResult = { ok: true } | { ok: false; reason: "origin" | "not_applicable" | "failed" };

/** SHA-256 токена (hex): в базе лежит только он, сам токен знает только ссылка. */
export async function hashDeviceToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

const enc = new TextEncoder();

/** Выдать ссылку. `secondStepDone` — метка `sf` проверенной сессии (ставится только после ключа). */
export async function issueDeviceLink(
  deps: LinkDeps,
  input: { telegramId: number; secondStepDone: boolean },
): Promise<IssueResult> {
  const now = deps.now ?? Date.now;
  if (isDemoSession(input.telegramId)) return { ok: false, reason: "not_applicable" };
  if (!input.secondStepDone) return { ok: false, reason: "second_step_required" };
  const token = newToken();
  const issued = await deps.store.issueDeviceLink(input.telegramId, await hashDeviceToken(token), {
    ttlMs: DEVICE_LINK_TTL_MS,
    maxPerWindow: MAX_DEVICE_LINKS_PER_WINDOW,
    windowMs: DEVICE_LINK_WINDOW_MS,
  });
  if (!issued) return { ok: false, reason: "throttled" };
  return { ok: true, token, expiresAt: now() + DEVICE_LINK_TTL_MS };
}

/** По ссылке выдать вызов регистрации. Ссылка чужая, просрочена или погашена — `invalid`. */
export async function startEnrollment(
  deps: LinkDeps,
  input: { telegramId: number; origin: unknown; userName: string; token: unknown },
): Promise<EnrollStartResult> {
  const rp = relyingPartyFor(input.origin);
  if (!rp) return { ok: false, reason: "origin" };
  if (isDemoSession(input.telegramId)) return { ok: false, reason: "not_applicable" };
  if (typeof input.token !== "string" || !TOKEN_RE.test(input.token)) return { ok: false, reason: "invalid" };

  const keys = await deps.store.listForPerson(input.telegramId);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpID,
    userName: input.userName,
    userID: enc.encode(String(input.telegramId)),
    attestationType: "none",
    // Ключ, который уже есть у человека (синхронизированный), второй раз не заводится.
    excludeCredentials: keys.map((k) => ({ id: k.credentialId, transports: k.transports as never })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    preferredAuthenticatorType: "localDevice",
    timeout: CHALLENGE_TTL_MS,
  });
  const armed = await deps.store.armDeviceLink(
    input.telegramId,
    await hashDeviceToken(input.token),
    options.challenge,
    CHALLENGE_TTL_MS,
  );
  if (!armed) return { ok: false, reason: "invalid" };
  return { ok: true, options: { ...options, hints: [...CLIENT_DEVICE_HINTS] } };
}

/** Принять ответ телефона. Ссылка гасится ДО разбора ответа: попытка одна. Осечки — одно `failed`. */
export async function finishEnrollment(
  deps: LinkDeps,
  input: { telegramId: number; origin: unknown; token: unknown; name?: unknown; credential: unknown },
): Promise<EnrollFinishResult> {
  const rp = relyingPartyFor(input.origin);
  if (!rp) return { ok: false, reason: "origin" };
  if (isDemoSession(input.telegramId)) return { ok: false, reason: "not_applicable" };
  if (typeof input.token !== "string" || !TOKEN_RE.test(input.token)) return { ok: false, reason: "failed" };

  const challenge = await deps.store.consumeDeviceLink(input.telegramId, await hashDeviceToken(input.token));
  if (!challenge) return { ok: false, reason: "failed" };

  try {
    const credential = input.credential as { id?: unknown };
    if (!credential || typeof credential.id !== "string") return { ok: false, reason: "failed" };
    const verified = await verifyRegistrationResponse({
      // deno-lint-ignore no-explicit-any
      response: input.credential as any,
      expectedChallenge: challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
    if (!verified.verified) return { ok: false, reason: "failed" };
    const cred = verified.registrationInfo.credential;
    const stored = await deps.store.insertPasskey({
      telegramId: input.telegramId,
      credentialId: cred.id,
      publicKey: toBase64Url(cred.publicKey),
      signCount: cred.counter,
      transports: cred.transports ?? [],
      name: cleanDeviceName(input.name),
    });
    if (!stored) {
      // Номер занят: свой ключ (уже сохранён) — шаг пройден; чужой под своё имя не присвоить.
      const existing = await deps.store.findByCredential(cred.id);
      if (existing?.telegramId !== input.telegramId) return { ok: false, reason: "failed" };
    }
    return { ok: true };
  } catch (_e) {
    return { ok: false, reason: "failed" };
  }
}
