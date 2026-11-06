/** Inline before hydration: a missing bootstrap chunk cannot load a React error boundary. */
export function chunkRecoveryScript(build: string): string {
  return `(${installChunkRecovery.toString()})(window,${
    JSON.stringify(build)
  });`;
}

// Keep this function self-contained: the server serializes it into the HTML document.
function installChunkRecovery(win: Window, build: string): void {
  let refreshing = false;
  const key = `swarm.chunk-reload:${build}`;
  const recover = (error: unknown): boolean => {
    const candidate = error as { name?: unknown; message?: unknown } | null;
    const message = typeof error === "string" ? error : candidate?.message;
    if (
      candidate?.name !== "ChunkLoadError" &&
      !(typeof message === "string" &&
        /Loading (?:CSS )?chunk [\s\S]*failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed/i
          .test(message))
    ) return false;
    if (refreshing) return false;
    try {
      // Persist before reload; a second failure in the same build keeps Next's usual fallback.
      if (win.sessionStorage.getItem(key)) return false;
      win.sessionStorage.setItem(key, "1");
    } catch {
      // Without durable tab storage we cannot prove that reloading would not loop.
      return false;
    }
    refreshing = true;
    win.location.reload();
    return true;
  };
  win.addEventListener("error", (event: ErrorEvent) => {
    const script = event.target as HTMLScriptElement | null;
    if (script?.tagName === "SCRIPT" && script.src) {
      const src = new URL(script.src, win.location.href);
      if (
        src.origin === win.location.origin &&
        src.pathname.startsWith("/_next/static/chunks/")
      ) {
        if (recover({ name: "ChunkLoadError" })) event.preventDefault();
        return;
      }
    }
    if (recover(event.error ?? event.message)) event.preventDefault();
  }, true);
  win.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    if (recover(event.reason)) event.preventDefault();
  });
}
