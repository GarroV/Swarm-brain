import { assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  avatarSigPayload,
  avatarUpdate,
  nameSigPayload,
  normalizeAvatarUrl,
  normalizeName,
  profileNameUpdate,
  verifiedAvatar,
} from "./google-profile.ts";

Deno.test("normalizeName: пусто и мусор → null", () => {
  assertEquals(normalizeName(undefined), null);
  assertEquals(normalizeName(null), null);
  assertEquals(normalizeName("   "), null);
  assertEquals(normalizeName("\n\t"), null);
});

Deno.test("normalizeName: тримит и режет по длине колонки", () => {
  assertEquals(normalizeName("  Вадим  "), "Вадим");
  assertEquals(normalizeName("x".repeat(200))?.length, 120);
});

Deno.test("nameSigPayload: имя входит в подписываемую строку", () => {
  assertEquals(
    nameSigPayload("v.garro@dodobrands.io", { given: "Вадим", family: "Гарро" }),
    "v.garro@dodobrands.io|Вадим|Гарро",
  );
});

Deno.test("nameSigPayload: пустые части дают стабильную строку, а не undefined", () => {
  assertEquals(nameSigPayload("a@b.io", {}), "a@b.io||");
  assertEquals(nameSigPayload("a@b.io", { given: " Anna ", family: null }), "a@b.io|Anna|");
});

Deno.test("profileNameUpdate: профиля нет → заполняем оба поля", () => {
  assertEquals(
    profileNameUpdate(null, { given: "Anna", family: "Petrova" }),
    { first_name: "Anna", last_name: "Petrova" },
  );
});

Deno.test("profileNameUpdate: заполненное руками НЕ перетираем", () => {
  assertEquals(
    profileNameUpdate({ first_name: "Аня", last_name: "П." }, { given: "Anna", family: "Petrova" }),
    null,
  );
});

Deno.test("profileNameUpdate: дозаполняем только пустое поле", () => {
  assertEquals(
    profileNameUpdate({ first_name: "Аня", last_name: null }, { given: "Anna", family: "Petrova" }),
    { last_name: "Petrova" },
  );
  assertEquals(
    profileNameUpdate({ first_name: "", last_name: "П." }, { given: "Anna", family: "Petrova" }),
    { first_name: "Anna" },
  );
});

Deno.test("profileNameUpdate: имени от Google нет → писать нечего", () => {
  assertEquals(profileNameUpdate(null, {}), null);
  assertEquals(profileNameUpdate({ first_name: null, last_name: null }, { given: "  " }), null);
});

Deno.test("profileNameUpdate: пробелы в существующем значении считаются пустотой", () => {
  assertEquals(
    profileNameUpdate({ first_name: "   ", last_name: null }, { given: "Anna", family: null }),
    { first_name: "Anna" },
  );
});

Deno.test("profileNameUpdate: заглушка из почты («a.petrova») заменяется именем из Google", () => {
  assertEquals(
    profileNameUpdate({ first_name: "a.petrova", last_name: null }, { given: "Anna", family: "Petrova" }, "A.Petrova"),
    { first_name: "Anna", last_name: "Petrova" },
  );
});

Deno.test("profileNameUpdate: имя, совпавшее с заглушкой не целиком, — ручное, не трогаем", () => {
  assertEquals(
    profileNameUpdate({ first_name: "Anna", last_name: null }, { given: "Anya", family: null }, "anna.petrova"),
    null,
  );
});

// ── Аватарка ──────────────────────────────────────────────────────────────────
const PIC = "https://lh3.googleusercontent.com/a/ACg8ocK=s96-c";

// Тестовый HMAC: детерминированная подпись, зависящая от всей строки (хватает, чтобы ловить
// подмену полей; настоящий HMAC-SHA256 живёт в auth-resolve).
const fakeHmac = (secret: string) => (data: string) => Promise.resolve(`${secret}:${data}`);

Deno.test("normalizeAvatarUrl: https и *.googleusercontent.com проходят", () => {
  assertEquals(normalizeAvatarUrl(PIC), PIC);
  assertEquals(normalizeAvatarUrl(`  ${PIC} `), PIC);
});

Deno.test("normalizeAvatarUrl: чужой хост, http, javascript, длина, мусор — игнор", () => {
  for (
    const bad of [
      "http://lh3.googleusercontent.com/a.png",
      "https://evil.example.com/a.png",
      "https://googleusercontent.com.evil.com/a.png",
      "https://evilgoogleusercontent.com/a.png",
      "https://user:pw@lh3.googleusercontent.com/a.png",
      "https://lh3.googleusercontent.com:8443/a.png",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "not a url",
      "",
      "   ",
      `https://lh3.googleusercontent.com/${"a".repeat(500)}`,
    ]
  ) assertEquals(normalizeAvatarUrl(bad), null, bad);
  assertEquals(normalizeAvatarUrl(undefined), null);
  assertEquals(normalizeAvatarUrl(null), null);
});

Deno.test("avatarSigPayload: домен подписи отделён от подписи имени, URL входит в строку", () => {
  assertEquals(avatarSigPayload("a@b.io", PIC), `avatar|a@b.io|${PIC}`);
  assertNotEquals(avatarSigPayload("a@b.io", PIC), nameSigPayload("a@b.io", { given: PIC }));
});

Deno.test("verifiedAvatar: подпись над тем же email и URL принимается", async () => {
  const hm = fakeHmac("s");
  const sig = await hm(avatarSigPayload("a@b.io", PIC));
  assertEquals(await verifiedAvatar("a@b.io", PIC, sig, hm), PIC);
});

Deno.test("verifiedAvatar: подмена картинки без подписи отвергается", async () => {
  const hm = fakeHmac("s");
  const sigForMine = await hm(avatarSigPayload("a@b.io", PIC));
  const other = "https://lh3.googleusercontent.com/a/OTHER=s96-c";
  assertEquals(await verifiedAvatar("a@b.io", other, sigForMine, hm), null); // реплей чужой подписи
  assertEquals(await verifiedAvatar("a@b.io", PIC, undefined, hm), null); // подписи нет
  assertEquals(await verifiedAvatar("a@b.io", PIC, "", hm), null);
  assertEquals(await verifiedAvatar("x@b.io", PIC, sigForMine, hm), null); // чужой email
  assertEquals(await verifiedAvatar("a@b.io", PIC, await hm("a@b.io"), hm), null); // подпись голого email
});

Deno.test("verifiedAvatar: подписанный, но чужой хост или схема — всё равно игнор", async () => {
  const hm = fakeHmac("s");
  for (const bad of ["https://evil.example.com/a.png", "javascript:alert(1)", "http://lh3.googleusercontent.com/a"]) {
    const sig = await hm(`avatar|a@b.io|${bad}`);
    assertEquals(await verifiedAvatar("a@b.io", bad, sig, hm), null, bad);
  }
});

Deno.test("avatarUpdate: пишем при смене, молчим при том же и при невалидном", () => {
  assertEquals(avatarUpdate(null, PIC), PIC);
  assertEquals(avatarUpdate("https://lh3.googleusercontent.com/old", PIC), PIC);
  assertEquals(avatarUpdate(PIC, PIC), null);
  assertEquals(avatarUpdate(PIC, null), null); // нет картинки в ответе — старую не стираем
  assertEquals(avatarUpdate(null, "https://evil.example.com/a.png"), null);
});
