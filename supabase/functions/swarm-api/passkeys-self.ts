// Свои ключи входа в профиле (решение владельца 17.10.2026, docs/decisions/2026-10-17-passkey-add-device.md):
//   GET    /me/passkeys              — список: название устройства, даты; `can_manage` — пройден ли шаг
//   DELETE /me/passkeys/:id          — снять СВОЙ ключ
//   POST   /me/passkeys/device-link  — одноразовая ссылка «Добавить устройство» (токен в ответе один раз)
// Менять (удалять ключ, выдавать ссылку) можно только из сессии, где второй шаг пройден ключом:
// иначе украденная сессия сняла бы ключи и завела свой (правило 14.10 «под неподтверждённой сессией
// новый ключ не заводим»). Сообщений никому не уходит — ссылку показывает только экран.
import type { PasskeyStore } from "../_shared/passkeys/store.ts";
import type { SecondStepState } from "../_shared/passkeys/second-step.ts";
import { issueDeviceLink } from "../_shared/passkeys/device-link.ts";
import { serverError } from "./client-error.ts";
import { apiErr, json } from "./http.ts";

const ONE_KEY = /^\/me\/passkeys\/([^/]+)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type SelfPasskeyCtx = { telegramId: number; secondStep: SecondStepState; origin: string };

export async function handleSelfPasskeyRoutes(
  store: PasskeyStore,
  req: Request,
  routePath: string,
  ctx: SelfPasskeyCtx,
): Promise<Response | null> {
  if (routePath !== "/me/passkeys" && !routePath.startsWith("/me/passkeys/")) return null;
  const { origin, secondStep } = ctx;
  // Шаг неприменим (демо, Mini App, короткий токен, вне пилота) — ключей у такой сессии нет.
  if (!secondStep.applies) return json({ error: "not_applicable" }, 403, origin);

  try {
    if (req.method === "GET" && routePath === "/me/passkeys") {
      const keys = await store.describeForPerson(ctx.telegramId);
      return json(
        {
          keys: keys.map((k) => ({ id: k.id, name: k.name, created_at: k.createdAt, last_used_at: k.lastUsedAt })),
          can_manage: secondStep.done,
        },
        200,
        origin,
      );
    }

    if (req.method === "POST" && routePath === "/me/passkeys/device-link") {
      const r = await issueDeviceLink({ store }, { telegramId: ctx.telegramId, secondStepDone: secondStep.done });
      if (r.ok) return json({ token: r.token, expires_at: new Date(r.expiresAt).toISOString() }, 200, origin);
      if (r.reason === "throttled") return json({ error: "throttled" }, 429, origin);
      return json({ error: r.reason }, 403, origin);
    }

    const one = routePath.match(ONE_KEY);
    if (req.method === "DELETE" && one) {
      if (!secondStep.done) return json({ error: "second_step_required" }, 403, origin);
      const id = decodeURIComponent(one[1]);
      if (!UUID.test(id)) return apiErr(404, "Not found", origin);
      const removed = await store.deleteOwn(ctx.telegramId, id);
      return removed ? json({ ok: true }, 200, origin) : apiErr(404, "Not found", origin);
    }
  } catch (e) {
    return serverError(origin, "me: passkeys", e);
  }
  return null;
}
