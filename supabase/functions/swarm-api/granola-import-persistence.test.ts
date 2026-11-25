import { assertEquals } from "jsr:@std/assert@1";
import { apiErr, corsHeaders, json } from "./http.ts";
import { INTERNAL_ERROR_MESSAGE, serverError } from "./client-error.ts";

// Run the real legacy route body, without booting Deno.serve or its external clients.
// Only I/O ports are fixtures; no copy of the persistence branch lives in this test.
const index = await Deno.readTextFile(new URL("./index.ts", import.meta.url));
const start = index.indexOf("  const granolaImportMatch = routePath.match(");
const end = index.indexOf("  // ── POST /feedback", start);
if (start < 0 || end < start) throw new Error("Granola import route boundary changed");
const moduleSource = [
  "export async function run(ports) {",
  "const { req, routePath, supabase, telegram_id, groupId, origin, externalFetch,",
  "openIntegrationKey, openAIKeyHandle, extractEntryMeta, applyGeneralSentinel,",
  "embed, buildEmbeddingInput, usageOf, wrapUntrustedForModel, findDuplicateMeeting,",
  "VIA_GRANOLA, VIA_OPENAI_CHAT, UNTRUSTED_DATA_RULE, isDemo, userEmail,",
  "json, apiErr, corsHeaders, serverError } = ports;",
  index.slice(start, end),
  "throw new Error('Fixture did not enter the import route');",
  "}",
].join("\n");
const { run } = await import("data:application/typescript," + encodeURIComponent(moduleSource)) as {
  run: (ports: Record<string, unknown>) => Promise<Response>;
};

type Fixture = {
  insertError?: { message: string };
  duplicate?: { id: string; title: string };
  updateError?: { message: string };
  skipped?: string[];
};

function fixture(options: Fixture = {}) {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const calls: string[] = [];
  const logs: string[] = [];
  const noteId = "synthetic-note";
  const note = {
    title: "Synthetic meeting",
    created_at: "2026-11-14T08:00:00Z",
    content: "Synthetic content",
    attendees: [],
  };
  const profile = { first_name: "Synthetic person" };
  const integration = { api_key: "synthetic-fixture", skipped_note_ids: options.skipped ?? [] };
  function table(name: string) {
    const chain = {
      select: (_columns: string) => chain,
      eq: (_column: string, _value: unknown) => chain,
      maybeSingle: () => Promise.resolve({ data: name === "user_profiles" ? profile : integration, error: null }),
      insert: (payload: Record<string, unknown>) => {
        assertEquals(name, "entries");
        inserts.push(payload);
        return Promise.resolve({ error: options.insertError ?? null });
      },
      update: (payload: Record<string, unknown>) => {
        assertEquals(name, "user_integrations");
        updates.push(payload);
        return {
          eq: (_column: string, _value: unknown) => ({
            eq: (_column2: string, _value2: unknown) => Promise.resolve({ error: options.updateError ?? null }),
          }),
        };
      },
    };
    return chain;
  }
  return {
    inserts,
    updates,
    calls,
    logs,
    noteId,
    ports: {
      req: new Request("https://fixture.invalid/granola/notes/" + noteId + "/import", {
        method: "POST",
        body: JSON.stringify({ visibility: "private" }),
      }),
      routePath: "/granola/notes/" + noteId + "/import",
      supabase: { from: table },
      telegram_id: 99178001,
      groupId: "synthetic-workspace",
      origin: "https://fixture.invalid",
      externalFetch: (url: string) => {
        calls.push(url);
        if (url.startsWith("https://public-api.granola.ai/")) return Promise.resolve(json(note));
        if (url === "https://api.openai.com/v1/chat/completions") {
          return Promise.resolve(json({ choices: [{ message: { content: "Synthetic summary" } }] }));
        }
        throw new Error("Unexpected fixture request");
      },
      openIntegrationKey: () => Promise.resolve("synthetic-fixture"),
      openAIKeyHandle: () => Promise.resolve({ key: "synthetic-fixture", noteResponse: () => Promise.resolve() }),
      extractEntryMeta: () => Promise.resolve({ countries: [] }),
      applyGeneralSentinel: (value: unknown) => value,
      embed: () => Promise.resolve([1, 0]),
      buildEmbeddingInput: (value: string) => value,
      usageOf: () => ({}),
      wrapUntrustedForModel: (value: string) => value,
      findDuplicateMeeting: () => Promise.resolve(options.duplicate ?? null),
      VIA_GRANOLA: {},
      VIA_OPENAI_CHAT: {},
      UNTRUSTED_DATA_RULE: "synthetic-rule",
      isDemo: false,
      userEmail: "fixture@example.invalid",
      json,
      apiErr,
      corsHeaders,
      serverError: (origin: string, where: string, error: unknown) =>
        serverError(origin, where, error, (line) => logs.push(line)),
    },
  };
}

Deno.test("Granola manual import: rejected database insert is not reported as a successful import", async () => {
  const f = fixture({ insertError: { message: "synthetic insert rejected" } });
  const response = await run(f.ports);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: INTERNAL_ERROR_MESSAGE });
  assertEquals(f.inserts.length, 1);
  assertEquals(f.updates.length, 0);
  assertEquals(f.logs.length, 1);
});

Deno.test("Granola manual import: successful insert retains the existing 204 and entry payload", async () => {
  const f = fixture();
  const response = await run(f.ports);
  assertEquals(response.status, 204);
  assertEquals(await response.text(), "");
  assertEquals(f.inserts.length, 1);
  assertEquals(f.inserts[0].metadata, { granola_note_id: f.noteId, title: "Synthetic meeting", confirmed: true });
  assertEquals(f.inserts[0].is_private, true);
  assertEquals(f.inserts[0].owner_id, 99178001);
  assertEquals(f.inserts[0].group_id, "synthetic-workspace");
  assertEquals(f.logs, []);
});

Deno.test("Granola manual import: rejected duplicate bookkeeping is not reported as saved", async () => {
  const f = fixture({
    duplicate: { id: "synthetic-entry", title: "Existing meeting" },
    updateError: { message: "synthetic update rejected" },
  });
  const response = await run(f.ports);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: INTERNAL_ERROR_MESSAGE });
  assertEquals(f.inserts, []);
  assertEquals(f.updates, [{ skipped_note_ids: [f.noteId] }]);
});

Deno.test("Granola manual import: duplicate receipt remains unchanged after successful bookkeeping", async () => {
  const duplicate = { id: "synthetic-entry", title: "Existing meeting" };
  const f = fixture({ duplicate });
  const response = await run(f.ports);
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { duplicate: true, ...duplicate });
  assertEquals(f.inserts, []);
  assertEquals(f.updates, [{ skipped_note_ids: [f.noteId] }]);
});

Deno.test("Granola manual import: an already remembered duplicate needs no additional write", async () => {
  const f = fixture({ duplicate: { id: "synthetic-entry", title: "Existing meeting" }, skipped: ["synthetic-note"] });
  const response = await run(f.ports);
  assertEquals(response.status, 200);
  assertEquals(f.inserts, []);
  assertEquals(f.updates, []);
});

Deno.test("Granola skip: rejected bookkeeping is not reported as saved", async () => {
  const f = fixture({ updateError: { message: "synthetic skip rejected" } });
  f.ports.routePath = "/granola/notes/" + f.noteId + "/skip";
  const response = await run(f.ports);
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: INTERNAL_ERROR_MESSAGE });
  assertEquals(f.inserts, []);
  assertEquals(f.updates, [{ skipped_note_ids: [f.noteId] }]);
});

Deno.test("Granola skip: saved bookkeeping keeps the existing 204 without model preparation", async () => {
  const f = fixture();
  f.ports.routePath = "/granola/notes/" + f.noteId + "/skip";
  const response = await run(f.ports);
  assertEquals(response.status, 204);
  assertEquals(f.inserts, []);
  assertEquals(f.updates, [{ skipped_note_ids: [f.noteId] }]);
  assertEquals(f.calls, []);
});

Deno.test("Granola skip: an already remembered note performs no additional write", async () => {
  const f = fixture({ skipped: ["synthetic-note"] });
  f.ports.routePath = "/granola/notes/" + f.noteId + "/skip";
  const response = await run(f.ports);
  assertEquals(response.status, 204);
  assertEquals(f.inserts, []);
  assertEquals(f.updates, []);
  assertEquals(f.calls, []);
});
