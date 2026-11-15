// Test-only subprocess. Never imported by a deployed function; CI loopback IO only.
import { createClient } from "@supabase/supabase-js";

type Counters = {
  forwarded: number;
  candidates: number;
  checkpointWrites: number;
  queueLists: number;
  maintenance: number;
  storageDownloads: number;
  models: number;
  messages: number;
  unknown: number;
};
const counters: Counters = {
  forwarded: 0,
  candidates: 0,
  checkpointWrites: 0,
  queueLists: 0,
  maintenance: 0,
  storageDownloads: 0,
  models: 0,
  messages: 0,
  unknown: 0,
};
const [mode, id, cronModule] = Deno.args;
const url = Deno.env.get("SUPABASE_URL");
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (Deno.env.get("GITHUB_ACTIONS") !== "true" || !url || !key || !id || !["kill", "cron"].includes(mode)) {
  throw new Error("isolated_ci_fixture_required");
}
const base = new URL(url);
if (!["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)) {
  throw new Error("loopback_only");
}
const nativeFetch = globalThis.fetch;
const encoder = new TextEncoder();
const emit = (value: unknown) => Deno.stdout.write(encoder.encode(JSON.stringify(value) + "\n"));
// Production diagnostics may include synthetic transcript data; the protocol never prints it.
console.log = () => {};
console.warn = () => {};
console.error = () => {};

const emptyList = (method: string) =>
  new Response(method === "HEAD" ? null : "[]", {
    headers: { "Content-Type": "application/json", "Content-Range": "*/0" },
  });

globalThis.fetch = async (input, init) => {
  const request = input instanceof Request ? input : new Request(input, init);
  const target = new URL(request.url);
  const method = (init?.method ?? request.method).toUpperCase();
  const body = method === "GET" || method === "HEAD"
    ? ""
    : typeof init?.body === "string"
    ? init.body
    : await request.clone().text();
  if (target.origin !== base.origin) {
    if (target.hostname === "api.telegram.org") counters.messages++;
    else counters.models++;
    throw new Error("external_io_blocked");
  }
  if (target.pathname === "/rest/v1/app_settings" && method === "GET") {
    counters.maintenance++;
    return emptyList(method); // no maintenance window in this fixture
  }
  if (target.pathname === "/rest/v1/meeting_audio_backups" && ["GET", "HEAD"].includes(method)) {
    counters.maintenance++;
    return emptyList(method); // typed list/count: no unrelated backup work
  }
  if (target.pathname === "/rest/v1/rpc/meeting_audio_expired" && method === "POST") {
    counters.maintenance++;
    return emptyList(method); // typed string[]: no retention writes
  }
  if (target.pathname === "/storage/v1/object/list/meeting-audio" && method === "POST") {
    const payload = JSON.parse(body);
    if (payload.prefix !== `${id}/queued`) {
      counters.unknown++;
      throw new Error("foreign_queue_prefix");
    }
    counters.queueLists++;
    return emptyList(method);
  }
  if (target.pathname.startsWith("/storage/v1/object/") && method === "GET") {
    counters.storageDownloads++;
    return new Response(JSON.stringify({ message: "synthetic_audio_not_available" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (target.pathname === "/rest/v1/meetings") {
    const own = target.searchParams.get("id") === `eq.${id}`;
    const candidate = method === "GET" && target.searchParams.get("select") === "id" &&
      target.searchParams.get("summary_status") === "eq.processing" &&
      target.searchParams.get("process_state") === "not.is.null";
    if ((method === "GET" && (own || candidate)) || (method === "PATCH" && own)) {
      if (candidate) counters.candidates++;
      const patch = method === "PATCH" ? JSON.parse(body) : null;
      const checkpoint = patch?.process_state?.stage === "summarize";
      if (checkpoint) counters.checkpointWrites++;
      counters.forwarded++;
      const response = await nativeFetch(input, init);
      if (mode === "kill" && checkpoint) {
        if (!response.ok || (await response.clone().json()).length !== 1) {
          throw new Error("checkpoint_not_committed");
        }
        await emit({ stage: "checkpoint_committed" });
        // The parent now kills this process. Returning/rejecting would execute finally.
        await new Promise<never>(() => {});
      }
      return response;
    }
  }
  counters.unknown++;
  throw new Error("unknown_io_blocked");
};

try {
  if (mode === "kill") {
    const { runMeetingStep } = await import("../../_shared/meeting-processor.ts");
    await runMeetingStep(createClient(url, key, { auth: { persistSession: false } }), id, 10_000);
    throw new Error("checkpoint_barrier_not_reached");
  }
  const secret = crypto.randomUUID();
  Deno.env.set("CRON_SECRET", secret);
  let handler: ((request: Request) => Response | Promise<Response>) | undefined;
  const originalServe = Deno.serve;
  const capture = ((fn: unknown) => {
    if (handler || typeof fn !== "function") throw new Error("unexpected_serve_shape");
    handler = fn as (request: Request) => Response | Promise<Response>;
    return {};
  }) as typeof Deno.serve;
  try {
    Deno.serve = capture;
    if (Deno.serve !== capture) throw new Error("serve_capture_failed");
    const module = cronModule ? new URL(cronModule) : new URL("../index.ts", import.meta.url);
    if (module.protocol !== "file:") throw new Error("local_fixture_module_required");
    await import(module.href); // actual cron body and actual step, no HTTP listener
  } finally {
    Deno.serve = originalServe;
  }
  if (!handler) throw new Error("cron_handler_missing");
  const response = await handler(
    new Request("https://fixture.invalid/meeting-process", { method: "POST", headers: { "X-Cron-Secret": secret } }),
  );
  await emit({ stage: "cron_result", status: response.status, result: await response.json(), counters });
  Deno.exit(0); // no background SDK timer can keep a completed test subprocess alive
} catch (error) {
  await emit({ stage: "fixture_error", kind: error instanceof Error ? error.name : "unknown", counters });
  Deno.exit(1);
}
