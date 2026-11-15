// #1248 recovery contract, not a diagnosis of the historical supervisor cancellations.
import { assert, assertEquals, AssertionError, assertRejects } from "@std/assert";
import { Client } from "postgres";
import { LEASE_STALE_MS } from "../_shared/meeting-processing-lease.ts";

const CHILD = new URL("./testing/termination-child.ts", import.meta.url);
const CONFIG = new URL("../../../deno.json", import.meta.url);
const PROCESSOR = new URL("../_shared/meeting-processor.ts", import.meta.url);
const LEASE = new URL("../_shared/meeting-processing-lease.ts", import.meta.url);
const CRON = new URL("./index.ts", import.meta.url);
const decoder = new TextDecoder();

type Row = {
  summary_status: string;
  processing_lease: string | null;
  process_state: { stage: string; gen: string; parts: Array<{ done: boolean; attempts: number }> };
  transcript: { segments: unknown[] } | null;
};
type Receipt = {
  stage: string;
  status: number;
  result: { ok: boolean; candidates: number; processed: number; finished: number };
  counters: Record<string, number>;
};

function config() {
  assertEquals(Deno.env.get("GITHUB_ACTIONS"), "true", "isolated CI only; never start a local stand");
  const db = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const api = Deno.env.get("SUPABASE_URL");
  assert(api && Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), "isolated API configuration required");
  for (const raw of [db, api]) {
    assert(["127.0.0.1", "localhost", "[::1]"].includes(new URL(raw).hostname), "loopback only");
  }
  assertEquals(new URL(db).pathname, "/postgres");
  return { db, api: new URL(api) };
}

function spawn(mode: "kill" | "cron", id: string, api: URL, module?: string) {
  const args = ["run", "--cached-only", "--no-check", "--config", CONFIG.pathname];
  args.push("--allow-env", "--allow-read", `--allow-net=${api.host}`, CHILD.pathname, mode, id);
  if (module) args.push(module);
  return new Deno.Command(Deno.execPath(), { args, stdin: "null", stdout: "piped", stderr: "piped" }).spawn();
}

async function killAfterCheckpoint(id: string, api: URL, verifyCommitted: () => Promise<void>) {
  const child = spawn("kill", id, api);
  const reader = child.stdout.getReader();
  const stderr = new Response(child.stderr).text();
  let buffer = "", timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        while (true) {
          const { value, done } = await reader.read();
          if (done) throw new Error("child_exited_before_checkpoint");
          buffer += decoder.decode(value, { stream: true });
          if (buffer.includes("\n")) {
            assertEquals(JSON.parse(buffer.split("\n")[0]).stage, "checkpoint_committed");
            return;
          }
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("checkpoint_deadline")), 15_000);
      }),
    ]);
    await verifyCommitted(); // independent DB connection, before the actual SIGKILL
    child.kill("SIGKILL");
    const status = await child.status;
    assertEquals(status.signal, "SIGKILL");
    assertEquals(status.success, false);
  } finally {
    if (timer) clearTimeout(timer);
    try {
      child.kill("SIGKILL");
    } catch { /* already reaped */ }
    await child.status;
    await reader.cancel();
    reader.releaseLock();
    await stderr;
  }
}

async function cron(id: string, api: URL, module?: string): Promise<Receipt> {
  const child = spawn("cron", id, api, module);
  const completion = child.output();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const output = await Promise.race([
      completion,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("cron_deadline")), 15_000);
      }),
    ]);
    assertEquals(output.success, true, "fixture must execute valid source, not crash on imports or syntax");
    const receipt = JSON.parse(decoder.decode(output.stdout).trim()) as Receipt;
    assertEquals(receipt.stage, "cron_result");
    assertEquals(receipt.status, 200);
    assertEquals(receipt.result.ok, true);
    return receipt;
  } finally {
    if (timer) clearTimeout(timer);
    try {
      child.kill("SIGKILL");
    } catch { /* already reaped */ }
    await child.status;
    await completion;
  }
}

function noExternal(receipt: Receipt) {
  for (const kind of ["models", "messages", "storageDownloads", "unknown"]) {
    assertEquals(receipt.counters[kind], 0, `forbidden IO: ${kind}`);
  }
}
function resumed(receipt: Receipt, row: Row) {
  noExternal(receipt);
  assertEquals(receipt.result.processed, 1, "expired lease must be claimed by the actual step");
  assertEquals(receipt.result.finished, 1);
  assertEquals(receipt.counters.queueLists, 1, "actual finish checks its empty queued metadata once");
  assertEquals(receipt.counters.checkpointWrites, 0, "resume uses the durable stage rather than restarting it");
  assertEquals(row.summary_status, "done");
  assertEquals(row.processing_lease, null);
  assertEquals(row.transcript?.segments, []);
}

function absoluteImports(source: string, original: URL) {
  return source.replace(
    /(from\s*["'])(\.\.?\/[^"']+)(["'])/g,
    (_match, prefix, relative, suffix) => prefix + new URL(relative, original).href + suffix,
  );
}
async function mutantModule(dir: string, kind: "stale-claim" | "restart-checkpoint") {
  let processor = absoluteImports(await Deno.readTextFile(PROCESSOR), PROCESSOR);
  const target = kind === "stale-claim" ? LEASE : PROCESSOR;
  const source = await Deno.readTextFile(target);
  const before = kind === "stale-claim"
    ? ".or(`processing_lease.is.null,processing_lease.lt.${staleIso}`)"
    : "const state = m.process_state;";
  const after = kind === "stale-claim"
    ? '.is("processing_lease", null)'
    : 'const state = { ...m.process_state, stage: "transcribe" as const, parts: m.process_state.parts.map(p => ({ ...p, done: false, segments: undefined })) };';
  assertEquals(source.split(before).length, 2, "mutant must alter exactly one actual production condition");
  const modified = absoluteImports(source.replace(before, after), target);
  if (kind === "stale-claim") {
    const lease = new URL(`file://${dir}/lease.ts`);
    await Deno.writeTextFile(lease, modified);
    assert(processor.includes(LEASE.href));
    processor = processor.replaceAll(LEASE.href, lease.href);
  } else processor = modified;
  const proc = new URL(`file://${dir}/${kind}-processor.ts`);
  await Deno.writeTextFile(proc, processor);
  const index = absoluteImports(await Deno.readTextFile(CRON), CRON);
  assertEquals(index.split(PROCESSOR.href).length, 2, "temporary cron changes only its processor import");
  const entry = new URL(`file://${dir}/${kind}-cron.ts`);
  await Deno.writeTextFile(entry, index.replace(PROCESSOR.href, proc.href));
  return entry.href;
}

Deno.test("actual SIGKILL leaves a committed checkpoint; fresh cron excludes it and stale cron resumes the real step", async () => {
  const { db: database, api } = config();
  const db = new Client(database), id = crypto.randomUUID(), ws = `test-resume-1248-${crypto.randomUUID()}`;
  const originals = await Promise.all([PROCESSOR, LEASE, CRON].map((url) => Deno.readTextFile(url)));
  const dir = await Deno.makeTempDir({ prefix: "swarm-resume-1248-" });
  let connected = false;
  const read = async () =>
    (await db.queryObject<Row>`select summary_status,processing_lease::text,process_state,transcript
      from meetings where id=${id}::uuid`).rows[0];
  const age = async (checkpoint: Row["process_state"]) => {
    await db.queryArray`update meetings set summary_status='processing',transcript=null,draft_notes_md=null,
      process_state=${JSON.stringify(checkpoint)}::jsonb,
      processing_lease=${new Date(Date.now() - LEASE_STALE_MS - 1000).toISOString()}::timestamptz
      where id=${id}::uuid`;
  };
  try {
    await db.connect();
    connected = true;
    await db.queryArray("set statement_timeout = '10s'");
    await db.queryArray("set lock_timeout = '2s'");
    await db.queryArray`insert into workspaces(id,name) values (${ws},'Synthetic resume fixture')`;
    const state = {
      gen: crypto.randomUUID(),
      stage: "transcribe",
      parts: [{
        track: "sys",
        name: "synthetic.wav",
        path: `${id}/synthetic.wav`,
        offset: 0,
        done: true,
        attempts: 0,
        segments: [],
      }],
    };
    await db.queryArray`insert into meetings(id,group_id,title,status,summary_status,recorders,process_state)
      values(${id}::uuid,${ws},'Synthetic recovery fixture','awaiting_review','processing','[]'::jsonb,${
      JSON.stringify(state)
    }::jsonb)`;
    let beforeKill: Row | undefined;
    await killAfterCheckpoint(id, api, async () => {
      beforeKill = await read();
      assertEquals(beforeKill.process_state.stage, "summarize");
      assertEquals(beforeKill.process_state.gen, state.gen);
      assertEquals(beforeKill.process_state.parts, state.parts);
      assert(beforeKill.processing_lease, "independently observe the committed checkpoint before killing its owner");
    });
    const checkpoint = await read();
    assertEquals(checkpoint, beforeKill, "no finally release or state rewrite after SIGKILL");
    assertEquals(checkpoint.summary_status, "processing");
    assertEquals(checkpoint.process_state.stage, "summarize");
    assertEquals(checkpoint.process_state.gen, state.gen);
    assertEquals(checkpoint.process_state.parts, state.parts);
    assert(checkpoint.processing_lease, "SIGKILL must not execute the processor's release finally");
    const fresh = await cron(id, api);
    noExternal(fresh);
    assertEquals(fresh.counters.candidates, 1, "execute the real cron query once");
    assertEquals(fresh.result, { ok: true, candidates: 0, processed: 0, finished: 0 });
    assertEquals(await read(), checkpoint, "fresh owner remains untouched");

    await age(checkpoint.process_state);
    const normal = await cron(id, api);
    resumed(normal, await read());
    assertEquals((await read()).process_state, checkpoint.process_state);

    await age(checkpoint.process_state);
    const staleMutant = await cron(id, api, await mutantModule(dir, "stale-claim"));
    assertEquals(staleMutant.result.candidates, 1, "real SQL candidate remains eligible");
    assertEquals(staleMutant.result.processed, 0, "valid mutant refuses the non-null expired lease");
    await assertRejects(async () => resumed(staleMutant, await read()), AssertionError);

    await age(checkpoint.process_state);
    const restartMutant = await cron(id, api, await mutantModule(dir, "restart-checkpoint"));
    assert(restartMutant.counters.storageDownloads > 0, "valid restart mutant re-downloads an already finished part");
    await assertRejects(async () => resumed(restartMutant, await read()), AssertionError);
    assertEquals(restartMutant.counters.models, 0);
    assertEquals(restartMutant.counters.messages, 0);
    assertEquals(restartMutant.counters.unknown, 0);
  } finally {
    try {
      if (connected) {
        await db.queryArray`delete from meetings where id=${id}::uuid and group_id=${ws}`;
        await db.queryArray`delete from workspaces where id=${ws}`;
      }
    } finally {
      try {
        if (connected) await db.end();
      } finally {
        await Deno.remove(dir, { recursive: true });
        assertEquals(await Promise.all([PROCESSOR, LEASE, CRON].map((url) => Deno.readTextFile(url))), originals);
      }
    }
  }
});
