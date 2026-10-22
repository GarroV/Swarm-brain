import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanShortText, transcribeShortClip } from "./short-transcribe.ts";

// deno-lint-ignore no-explicit-any
const auth = { supabase: {}, groupId: "g" } as any;
const clip = new Blob(["x"], { type: "audio/mp4" });

function fake(replies: Array<{ status: number; body: unknown }>) {
  const models: string[] = [];
  const fetcher = (_a: unknown, _u: string, init: RequestInit) => {
    models.push(String((init.body as FormData).get("model")));
    const r = replies.shift()!;
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  };
  // deno-lint-ignore no-explicit-any
  return { models, fetcher: fetcher as any };
}

Deno.test("основная модель отвечает — фолбэка нет", async () => {
  const f = fake([{ status: 200, body: { text: " по Словении подключить агрегаторов " } }]);
  const r = await transcribeShortClip(auth, clip, "a.m4a", { fetcher: f.fetcher });
  assertEquals(r, { text: "по Словении подключить агрегаторов", model: "gpt-transcribe", fallback: false });
  assertEquals(f.models, ["gpt-transcribe"]);
});

Deno.test("4xx про модель → один фолбэк на whisper-1", async () => {
  const f = fake([{ status: 400, body: { error: { message: "bad param" } } }, {
    status: 200,
    body: { text: "привет" },
  }]);
  const r = await transcribeShortClip(auth, clip, "a.m4a", { fetcher: f.fetcher });
  assertEquals(r.fallback, true);
  assertEquals(f.models, ["gpt-transcribe", "whisper-1"]);
});

Deno.test("5xx и 401 не уводят на фолбэк — ошибка наружу", async () => {
  for (const status of [401, 500]) {
    const f = fake([{ status, body: { error: { message: "no" } } }]);
    await assertRejects(() => transcribeShortClip(auth, clip, "a.m4a", { fetcher: f.fetcher }));
    assertEquals(f.models, ["gpt-transcribe"]);
  }
});

Deno.test("оба отказали — ошибка, третьей попытки нет", async () => {
  const f = fake([{ status: 400, body: {} }, { status: 400, body: {} }]);
  await assertRejects(() => transcribeShortClip(auth, clip, "a.m4a", { fetcher: f.fetcher }));
  assertEquals(f.models.length, 2);
});

Deno.test("тишина и «титры» превращаются в пустую расшифровку", () => {
  assertEquals(cleanShortText("   "), "");
  assertEquals(cleanShortText("Субтитры сделал DimaTorzok"), "");
  assertEquals(cleanShortText(undefined), "");
  assertEquals(cleanShortText("добавить задачу"), "добавить задачу");
});
