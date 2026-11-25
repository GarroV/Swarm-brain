import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { UploadQueue } from "../swarm-client/queue.ts";
import { touchAlive } from "./run-directories.ts";
import { recoverUploads } from "./upload-recovery-run.ts";

const state = { directory: "" };
function quiet(): void {
  // No human notifications in this test.
}
function inputURL(input: Parameters<typeof globalThis.fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input);
}
afterEach(async () => {
  if (state.directory) await rm(state.directory, { recursive: true, force: true });
});
const unused = {
  ingest: () => Promise.reject(new Error("not used")),
  statuses: () => Promise.resolve(new Map()),
};
const person = 7;
const id = "11111111-1111-4111-8111-111111111111";

it("old unsealed recording uploads without another meeting; current recording stays untouched", async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "scriba-recovery-"));
  const root = path.join(state.directory, "queue", String(person));
  const dead = path.join(root, "old-call");
  const busy = path.join(root, "current-call");
  const orphan = new UploadQueue({ root: dead, client: unused });
  const active = new UploadQueue({ root: busy, client: unused });
  await orphan.stagePart(id, new Blob(["saved audio"]), 0);
  await active.stagePart("busy-id", new Blob(["still recording"]), 0);
  await touchAlive(dead, new Date(Date.now() - 10 * 60_000));
  await touchAlive(busy);
  const calls: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = inputURL(input);
    calls.push(url.pathname);
    if (url.pathname.endsWith("/meeting-upload-recovery")) {
      expect(init?.headers).toMatchObject({ Authorization: "Bearer service-secret" });
      expect(JSON.parse(init?.body as string)).toEqual({ person, meeting_id: id });
      return Response.json({ ok: true, upload_token: "sru_upload-only" });
    }
    expect(init?.headers).not.toMatchObject({ Authorization: "Bearer service-secret" });
    if (url.pathname.endsWith("/meeting-ingest")) {
      const form = init?.body as FormData;
      expect(form.get("meeting_id")).toBe(id);
      expect(await (form.get("sys_0") as Blob).text()).toBe("saved audio");
      return Response.json(
        {
          ok: true,
          meeting_id: id,
          web_url: "https://web.test/meeting",
          summary_status: "processing",
        },
        { status: 202 },
      );
    }
    expect(url.pathname).toMatch(/meeting-status$/u);
    return Response.json({
      ok: true,
      statuses: [{ id, status: "in_base", summary_status: "done" }],
    });
  };
  await recoverUploads({
    directory: state.directory,
    person,
    baseUrl: "https://api.test",
    serviceToken: "service-secret",
    fetch,
    log: quiet,
  });
  expect(calls).toEqual(["/meeting-upload-recovery", "/meeting-ingest", "/meeting-status"]);
  const activeEntries = await active.entries();
  expect(activeEntries[0]?.sealed).toBe(false);
  expect(await orphan.entries()).toHaveLength(0);
});

it("unavailable recovery authority preserves audio and never claims a new meeting", async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "scriba-recovery-"));
  const dead = path.join(state.directory, "queue", String(person), "old-call");
  const queue = new UploadQueue({ root: dead, client: unused });
  await queue.stagePart(id, new Blob(["saved audio"]), 0);
  await queue.seal(id, []);
  await touchAlive(dead, new Date(Date.now() - 10 * 60_000));
  const fetch: typeof globalThis.fetch = (input) => {
    expect(inputURL(input).href).toBe("https://api.test/meeting-upload-recovery");
    return Promise.resolve(Response.json({ error: "unavailable" }, { status: 503 }));
  };
  await recoverUploads({
    directory: state.directory,
    person,
    baseUrl: "https://api.test",
    serviceToken: "service-secret",
    fetch,
    log: quiet,
  });
  const roots = await readdir(path.join(state.directory, "queue", String(person)));
  const recoveryRoot = roots.find((name) => name.startsWith("resend-"));
  if (!recoveryRoot) throw new Error("recovery queue missing");
  const retained = await new UploadQueue({
    root: path.join(state.directory, "queue", String(person), recoveryRoot),
    client: unused,
  }).entries();
  expect(retained).toHaveLength(1);
  expect(retained[0]?.uploaded).toBe(false);
});

it("empty recovery pass leaves no empty run state.directory", async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "scriba-recovery-"));
  await recoverUploads({
    directory: state.directory,
    person,
    baseUrl: "https://api.test",
    serviceToken: "service-secret",
    log: quiet,
  });
  const personRoot = path.join(state.directory, "queue", String(person));
  expect(await readdir(personRoot)).toEqual([]);
});

it("a later recovery pass delivers retained audio after an ingest outage without another meeting", async () => {
  state.directory = await mkdtemp(path.join(tmpdir(), "scriba-recovery-"));
  const personRoot = path.join(state.directory, "queue", String(person));
  const dead = path.join(personRoot, "old-call");
  const queue = new UploadQueue({ root: dead, client: unused });
  const audio = "audio retained across the failed upload";
  await queue.stagePart(id, new Blob([audio]), 0);
  await queue.seal(id, []);
  const stale = new Date(Date.now() - 10 * 60_000);
  await touchAlive(dead, stale);

  const calls: string[] = [];
  let isAvailable = false;
  let grants = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const endpoint = inputURL(input).pathname;
    calls.push(endpoint);
    if (endpoint === "/meeting-upload-recovery") {
      expect(JSON.parse(init?.body as string)).toEqual({ person, meeting_id: id });
      grants += 1;
      return Response.json({ ok: true, upload_token: `sru_pass-${String(grants)}` });
    }
    expect(init?.headers).toMatchObject({ Authorization: `Bearer sru_pass-${String(grants)}` });
    if (endpoint === "/meeting-ingest") {
      const form = init?.body as FormData;
      expect(form.get("meeting_id")).toBe(id);
      expect(await (form.get("sys_0") as Blob).text()).toBe(audio);
      if (!isAvailable) return Response.json({ error: "temporary outage" }, { status: 503 });
      return Response.json(
        {
          ok: true,
          meeting_id: id,
          web_url: "https://web.test/meeting",
          summary_status: "processing",
        },
        { status: 202 },
      );
    }
    expect(endpoint).toBe("/meeting-status");
    return Response.json({
      ok: true,
      statuses: [{ id, status: "in_base", summary_status: "done" }],
    });
  };
  const options = {
    directory: state.directory,
    person,
    baseUrl: "https://api.test",
    serviceToken: "service-secret",
    fetch,
    log: quiet,
  };

  await recoverUploads(options);
  const roots = await readdir(personRoot);
  const retainedRoot = roots.find((name) => name.startsWith("resend-"));
  if (!retainedRoot) throw new Error("failed upload was not retained");
  const retained = new UploadQueue({ root: path.join(personRoot, retainedRoot), client: unused });
  expect(await retained.entries()).toMatchObject([
    { meetingId: id, uploaded: false, sealed: true },
  ]);
  expect(calls).toEqual(["/meeting-upload-recovery", "/meeting-ingest"]);

  await touchAlive(path.join(personRoot, retainedRoot), stale);
  isAvailable = true;
  await recoverUploads(options);
  expect(grants).toBe(2);
  expect(calls).toEqual([
    "/meeting-upload-recovery",
    "/meeting-ingest",
    "/meeting-upload-recovery",
    "/meeting-ingest",
    "/meeting-status",
  ]);
  expect(await retained.entries()).toHaveLength(0);
  const remainingRoots = await readdir(personRoot);
  for (const root of remainingRoots) {
    const remaining = new UploadQueue({ root: path.join(personRoot, root), client: unused });
    expect(await remaining.entries()).toHaveLength(0);
  }
});
