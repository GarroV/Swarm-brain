// Зеркало `miniapp/functions/_lib/google-name.ts` обязано совпадать с каноном
// `supabase/functions/_shared/google-profile.ts`: расхождение подписи ломает вход через Google
// (auth-resolve вернёт 403 на валидного человека). Тест держит обе реализации в одной точке.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import * as mirror from "../../functions/_lib/google-name.ts";
import * as canon from "../../../supabase/functions/_shared/google-profile.ts";
import * as canonScopes from "../../../supabase/functions/_shared/google-scopes.ts";

const cases: Array<[string, mirror.GoogleName]> = [
  ["v.garro@dodobrands.io", { given: "Вадим", family: "Гарро" }],
  ["a@b.io", {}],
  ["a@b.io", { given: "  Anna  ", family: null }],
  ["a@b.io", { given: null, family: "Petrova" }],
  ["a@b.io", { given: "   ", family: "   " }],
  ["a@b.io", { given: "x".repeat(300), family: "y".repeat(300) }],
  ["a@b.io", { given: "Ünal", family: "Ilić" }],
];

Deno.test("зеркало google-name совпадает с каноном google-profile по подписи", () => {
  for (const [email, name] of cases) {
    assertEquals(
      mirror.nameSigPayload(email, name),
      canon.nameSigPayload(email, name),
      `разъезд подписи на ${email} / ${JSON.stringify(name)}`,
    );
  }
});

Deno.test("зеркало google-name совпадает с каноном по нормализации", () => {
  for (const raw of [undefined, null, "", "   ", " Anna ", "x".repeat(300), "Ilić"]) {
    assertEquals(mirror.normalizeName(raw), canon.normalizeName(raw), `разъезд normalizeName на ${JSON.stringify(raw)}`);
  }
});

Deno.test("зеркало scope совпадает с каноном google-scopes", () => {
  assertEquals(mirror.CALENDAR_SCOPE, canonScopes.CALENDAR_SCOPE);
  assertEquals(mirror.LOGIN_SCOPES, canonScopes.LOGIN_SCOPES);
});

Deno.test("зеркало hasCalendarScope совпадает с каноном", () => {
  const inputs = [
    undefined, null, "", "openid email profile",
    canonScopes.LOGIN_SCOPES,
    canonScopes.CALENDAR_SCOPE,
    "https://www.googleapis.com/auth/calendar.events",
    "https://www.googleapis.com/auth/calendar.readonly",
    `  openid\t${canonScopes.CALENDAR_SCOPE}\n `,
  ];
  for (const g of inputs) {
    assertEquals(mirror.hasCalendarScope(g), canonScopes.hasCalendarScope(g), `разъезд на ${JSON.stringify(g)}`);
  }
});
