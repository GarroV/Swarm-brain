import { assertEquals } from "@std/assert";
import { chunkRecoveryScript } from "./chunkRecovery.ts";

function tab(
  storage = new Map<string, string>(),
  storageFailure: "read" | "write" | null = null,
) {
  let reloads = 0;
  const listeners = new Map<string, (event: unknown) => void>();
  const win = {
    location: {
      href: "https://preview.example/?tab=sprints",
      origin: "https://preview.example",
      reload: () => reloads++,
    },
    sessionStorage: {
      getItem: (key: string) => {
        if (storageFailure === "read") throw new Error("storage unavailable");
        return storage.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (storageFailure === "write") {
          throw new Error("storage quota unavailable");
        }
        storage.set(key, value);
      },
    },
    addEventListener: (type: string, listener: (event: unknown) => void) =>
      listeners.set(type, listener),
  };
  return {
    install: (build = "build-a") =>
      new Function("window", chunkRecoveryScript(build))(win),
    emit(type: string, error: unknown, target?: unknown) {
      let prevented = false;
      listeners.get(type)?.({
        error,
        reason: error,
        target,
        preventDefault: () => prevented = true,
      });
      return prevented;
    },
    reloads: () => reloads,
    storage,
  };
}

Deno.test("#809: actual inline script reloads recognized chunk failures once", () => {
  for (
    const error of [
      { name: "ChunkLoadError" },
      new Error(
        "Loading chunk 42 failed. (missing: /_next/static/chunks/42.js)",
      ),
      new Error(
        "Failed to load chunk /_next/static/chunks/a.js from module foo",
      ),
      new TypeError(
        "Failed to fetch dynamically imported module: /_next/static/chunks/a.js",
      ),
      new TypeError("Importing a module script failed."),
      new Error("Loading CSS chunk 42 failed."),
    ]
  ) {
    const t = tab();
    t.install();
    assertEquals(t.emit("unhandledrejection", error), true);
    assertEquals(t.emit("error", error), false);
    assertEquals(t.reloads(), 1);
  }
});

Deno.test("#809: persisted guard survives reload and leaves the normal fallback on repeated failure", () => {
  const t = tab();
  t.install();
  t.emit("error", { name: "ChunkLoadError" });
  const reloaded = tab(t.storage);
  reloaded.install();
  assertEquals(reloaded.emit("error", { name: "ChunkLoadError" }), false);
  assertEquals(reloaded.reloads(), 0);
});

Deno.test("#809: a later deployment gets its own single recovery attempt", () => {
  const t = tab();
  t.install();
  t.emit("error", { name: "ChunkLoadError" });
  const fresh = tab(t.storage);
  fresh.install("build-b");
  assertEquals(fresh.emit("error", { name: "ChunkLoadError" }), true);
  assertEquals(fresh.reloads(), 1);
});

Deno.test("#809: ordinary render/API errors keep existing handling", () => {
  const t = tab();
  t.install();
  for (
    const error of [
      new Error("render failed"),
      new TypeError("Failed to fetch"),
      null,
      undefined,
    ]
  ) {
    assertEquals(t.emit("error", error), false);
    assertEquals(t.emit("unhandledrejection", error), false);
  }
  assertEquals(t.reloads(), 0);
});

Deno.test("#809: failed bootstrap script recovers before React can mount", () => {
  const t = tab();
  t.install();
  assertEquals(
    t.emit("error", undefined, {
      tagName: "SCRIPT",
      src: "https://preview.example/_next/static/chunks/a.js",
    }),
    true,
  );
  assertEquals(t.reloads(), 1);
});

Deno.test("#809: unrelated or external script failures do not reload", () => {
  for (
    const target of [
      {
        tagName: "SCRIPT",
        src: "https://third-party.example/_next/static/chunks/a.js",
      },
      { tagName: "SCRIPT", src: "https://preview.example/other.js" },
      {
        tagName: "IMG",
        src: "https://preview.example/_next/static/chunks/a.js",
      },
    ]
  ) {
    const t = tab();
    t.install();
    assertEquals(t.emit("error", undefined, target), false);
    assertEquals(t.reloads(), 0);
  }
});

Deno.test("#809: unavailable tab storage disables automatic reload to avoid a loop", () => {
  for (const failure of ["read", "write"] as const) {
    const t = tab(new Map(), failure);
    t.install();
    assertEquals(t.emit("error", { name: "ChunkLoadError" }), false);
    assertEquals(t.reloads(), 0);
  }
});
