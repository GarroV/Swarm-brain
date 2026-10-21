// Фото из Google по refresh-токену: разбор ответа userinfo и решение «писать или нет».
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AvatarDeps,
  type AvatarPerson,
  pictureFromUserinfo,
  type PictureResult,
  syncAvatars,
} from "./google-avatars.ts";

const PIC = "https://lh3.googleusercontent.com/a/abc=s96-c";
const PIC2 = "https://lh3.googleusercontent.com/a/new=s96-c";

Deno.test("userinfo: берём только https-фото с googleusercontent", () => {
  assertEquals(pictureFromUserinfo({ picture: PIC, email: "a@b.c" }), PIC);
  assertEquals(pictureFromUserinfo({ picture: "http://lh3.googleusercontent.com/a" }), null);
  assertEquals(pictureFromUserinfo({ picture: "https://evil.example.com/a.png" }), null);
  assertEquals(pictureFromUserinfo({ picture: 42 }), null);
  assertEquals(pictureFromUserinfo({}), null);
  assertEquals(pictureFromUserinfo(null), null);
  assertEquals(pictureFromUserinfo("picture"), null);
});

function run(people: AvatarPerson[], pictures: Record<string, PictureResult>, deadTokens: string[] = []) {
  const saved: Array<[number, string]> = [];
  const logs: string[] = [];
  const deps: AvatarDeps = {
    people: () => Promise.resolve(people),
    accessToken: (refresh) =>
      Promise.resolve(
        deadTokens.includes(refresh)
          ? { ok: false as const, deadGrant: true }
          : { ok: true as const, token: `at-${refresh}` },
      ),
    fetchPicture: (token) => Promise.resolve(pictures[token.slice(3)] ?? { ok: false as const, status: null }),
    save: (id, url) => {
      if (id === 99) return Promise.reject(new Error("db down"));
      saved.push([id, url]);
      return Promise.resolve();
    },
    log: (l) => logs.push(l),
  };
  return { deps, saved, logs };
}

Deno.test("пишем новое и изменившееся фото; то же самое и отсутствие фото — не пишем", async () => {
  const { deps, saved } = run(
    [
      { telegramId: 1, refreshToken: "r1", current: null },
      { telegramId: 2, refreshToken: "r2", current: PIC },
      { telegramId: 3, refreshToken: "r3", current: PIC },
      { telegramId: 4, refreshToken: "r4", current: null },
    ],
    {
      r1: { ok: true, picture: PIC },
      r2: { ok: true, picture: PIC },
      r3: { ok: true, picture: PIC2 },
      r4: { ok: true, picture: null },
    },
  );
  const report = await syncAvatars(deps);
  assertEquals(saved, [[1, PIC], [3, PIC2]]);
  assertEquals(report, { people: 4, updated: 2, unchanged: 2, skipped: 0, failed: 0 });
});

Deno.test("мёртвый токен, нет scope и молчание Google — тихий пропуск, остальные идут дальше", async () => {
  const { deps, saved, logs } = run(
    [
      { telegramId: 1, refreshToken: "dead", current: null },
      { telegramId: 2, refreshToken: "r2", current: null },
      { telegramId: 3, refreshToken: "r3", current: null },
      { telegramId: 4, refreshToken: "r4", current: null },
    ],
    { r2: { ok: false, status: 403 }, r3: { ok: false, status: null }, r4: { ok: true, picture: PIC } },
    ["dead"],
  );
  const report = await syncAvatars(deps);
  assertEquals(saved, [[4, PIC]]);
  assertEquals(report, { people: 4, updated: 1, unchanged: 0, skipped: 3, failed: 0 });
  assertEquals(logs, []);
});

Deno.test("сбой записи одного человека не останавливает проход и логируется без токена", async () => {
  const { deps, saved, logs } = run(
    [
      { telegramId: 99, refreshToken: "secret-refresh", current: null },
      { telegramId: 5, refreshToken: "r5", current: null },
    ],
    { "secret-refresh": { ok: true, picture: PIC }, r5: { ok: true, picture: PIC } },
  );
  const report = await syncAvatars(deps);
  assertEquals(saved, [[5, PIC]]);
  assertEquals(report.failed, 1);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].includes("secret-refresh"), false);
});
