// Сторож дрейфа между кодом и базой: превью списка режет SQL, а длину превью объявляет
// LIST_PREVIEW_CHARS в коде (issue #490).
//
// Почему это не юнит-тест: число 400 живёт в ДВУХ местах — в generated-колонке
// (миграция 20260925090000) и в константе кода. Юнит-тест проверил бы константу саму против
// себя. Разойтись они могут молча: список просто начнёт отдавать другой кусок текста, никакой
// ошибки при этом не возникнет. Поэтому спрашиваем живую базу.
//
// Пропускаться тест не умеет: базы нет — прогон падает и говорит, что поднять.
import { assertEquals } from "@std/assert";
import { Client } from "postgres";
import { LIST_PREVIEW_CHARS } from "./meetings-payload.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

// group_id намеренно не заполняем: это FK на workspaces, а проверяются здесь generated-колонки,
// а не связи. Строка живёт внутри одного теста и удаляется в finally.
async function withRow<T>(
  content: string,
  summary: string | null,
  fn: (row: Record<string, unknown>) => T,
): Promise<T> {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    const ins = await db.queryObject<{ id: string }>`
      insert into entries (content, summary, entry_type, source, added_by)
      values (${content}, ${summary}, 'meeting', 'test', 'test')
      returning id`;
    const id = ins.rows[0].id;
    try {
      const got = await db.queryObject<Record<string, unknown>>`
        select content_preview, summary_preview, list_truncated
        from entries where id = ${id}`;
      return fn(got.rows[0]);
    } finally {
      await db.queryArray`delete from entries where id = ${id}`;
    }
  } finally {
    await db.end();
  }
}

Deno.test("база режет превью ровно на LIST_PREVIEW_CHARS", async () => {
  await withRow("x".repeat(LIST_PREVIEW_CHARS * 3), "y".repeat(LIST_PREVIEW_CHARS * 3), (r) => {
    assertEquals((r.content_preview as string).length, LIST_PREVIEW_CHARS);
    assertEquals((r.summary_preview as string).length, LIST_PREVIEW_CHARS);
  });
});

Deno.test("длинный текст помечается усечённым — иначе список покажет кусок как целое", async () => {
  await withRow("x".repeat(LIST_PREVIEW_CHARS + 1), null, (r) => {
    assertEquals(r.list_truncated, true);
  });
});

Deno.test("текст ровно в размер превью усечённым НЕ считается", async () => {
  // Граница: 400 символов влезли целиком, до-загружать нечего.
  await withRow("x".repeat(LIST_PREVIEW_CHARS), null, (r) => {
    assertEquals(r.list_truncated, false);
  });
});

Deno.test("длинный summary при коротком content тоже даёт усечение", async () => {
  await withRow("коротко", "y".repeat(LIST_PREVIEW_CHARS + 1), (r) => {
    assertEquals(r.list_truncated, true);
  });
});

Deno.test("summary = null не ломает признак усечения", async () => {
  await withRow("коротко", null, (r) => {
    assertEquals(r.list_truncated, false);
  });
});

// ── meetings.has_draft_notes (issue #491) ────────────────────────────────────

async function draftFlag(notes: string | null): Promise<boolean> {
  const db = new Client(DB_URL);
  await db.connect();
  try {
    const ins = await db.queryObject<{ has_draft_notes: boolean }>`
      insert into meetings (status, identity_kind, identity_key, draft_notes_md)
      values ('awaiting_review', 'manual', ${crypto.randomUUID()}, ${notes})
      returning id, has_draft_notes`;
    const row = ins.rows[0] as unknown as { id: string; has_draft_notes: boolean };
    await db.queryArray`delete from meetings where id = ${row.id}`;
    return row.has_draft_notes;
  } finally {
    await db.end();
  }
}

Deno.test("has_draft_notes: текст есть — признак true", async () => {
  assertEquals(await draftFlag("### Тезисы\n- пункт"), true);
});

Deno.test("has_draft_notes: текста нет — признак false", async () => {
  assertEquals(await draftFlag(null), false);
});

Deno.test("has_draft_notes: пустая строка = НЕ готово (иначе список врёт «готово»)", async () => {
  assertEquals(await draftFlag("   \n  "), false);
});
