import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { handleChatGptDesktop } from "./chatgpt-desktop.ts";
import { buildChatGptSetupOneLiner, CHATGPT_SETUP_SCRIPT } from "./chatgpt-setup-script.ts";
import { sha256Hex } from "./mcp-setup-script.ts";
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.test("desktop credentials are independent, caller-scoped, hashed and revocable", async () => {
  const updates: Record<string, unknown>[] = [];
  const filters: unknown[][] = [];
  const q = {
    update: (p: Record<string, unknown>) => {
      updates.push(p);
      return q;
    },
    eq: (k: string, v: unknown) => {
      filters.push([k, v]);
      return q;
    },
    select: () => q,
    insert: () => Promise.resolve({ error: null }),
    maybeSingle: () => Promise.resolve({ data: { telegram_id: 42 }, error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  const ctx = {
    supabase: { from: () => q } as unknown as SupabaseClient,
    telegramId: 42,
    isDemo: false,
    renewableSession: true,
    origin: "https://swarm-team.app",
  };
  const issue = await handleChatGptDesktop(
    new Request("https://swarm-team.app/mcp/desktop/token", {
      method: "POST",
      body: JSON.stringify({ telegram_id: 99 }),
    }),
    "/mcp/desktop/token",
    ctx,
  );
  assertEquals(issue?.status, 200);
  const body = await issue!.json();
  const token = body.oneLiner.match(/SWARM_TOKEN='([^']+)'/)[1];
  assertMatch(token, /^smcp_gpt_[0-9a-f]{32}$/);
  assertEquals(updates[0].chatgpt_mcp_token_hash, await sha256Hex(token));
  assertEquals("claude_mcp_token_hash" in updates[0], false);
  assertEquals(filters, [["telegram_id", 42]]);
  const days = (Date.parse(String(updates[0].chatgpt_mcp_token_expires_at)) - Date.now()) / 86400000;
  assertEquals(days > 29.99 && days <= 30, true);
  await handleChatGptDesktop(
    new Request("https://swarm-team.app/mcp/desktop/token", { method: "DELETE" }),
    "/mcp/desktop/token",
    ctx,
  );
  assertEquals(updates[1], {
    chatgpt_mcp_token_hash: null,
    chatgpt_mcp_token_expires_at: null,
    chatgpt_mcp_last_seen_at: null,
  });
  assertEquals(
    (await handleChatGptDesktop(
      new Request("https://swarm-team.app/mcp/desktop/token", { method: "POST" }),
      "/mcp/desktop/token",
      { ...ctx, isDemo: true },
    ))?.status,
    403,
  );
  assertEquals(
    (await handleChatGptDesktop(
      new Request("https://swarm-team.app/mcp/desktop/token", { method: "POST" }),
      "/mcp/desktop/token",
      { ...ctx, renewableSession: false },
    ))?.status,
    403,
  );
  assertEquals(updates.length, 2);
});

Deno.test("desktop installer is valid bash and command pins its checksum", async () => {
  const result = await new Deno.Command("bash", { args: ["-n"], stdin: "piped", stdout: "piped", stderr: "piped" })
    .spawn();
  const writer = result.stdin.getWriter();
  await writer.write(new TextEncoder().encode(CHATGPT_SETUP_SCRIPT));
  await writer.close();
  assertEquals((await result.output()).code, 0);
  const command = await buildChatGptSetupOneLiner("smcp_gpt_test");
  assertEquals(command.includes(await sha256Hex(CHATGPT_SETUP_SCRIPT)), true);
  assertEquals(command.includes("/swarm-setup/chatgpt"), true);
  assertEquals(CHATGPT_SETUP_SCRIPT.includes("claude_desktop_config"), false);
});

Deno.test("download checksum failure does not execute script and returns failure", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(
      `${dir}/curl`,
      '#!/bin/bash\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; target="$1"; fi; shift; done\nprintf \'#!/bin/bash\\ntouch "$SWARM_TEST_MARKER"\\n\' > "$target"\n',
    );
    await Deno.chmod(`${dir}/curl`, 0o700);
    const command = await buildChatGptSetupOneLiner("smcp_gpt_fixture");
    const result = await new Deno.Command("bash", {
      args: ["-c", command],
      env: { PATH: `${dir}:${Deno.env.get("PATH")}`, SWARM_TEST_MARKER: `${dir}/executed` },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code === 0, false);
    assertEquals(await Deno.stat(`${dir}/executed`).then(() => true).catch(() => false), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("invalid existing TOML is rejected before writing files or probing server", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/.codex`);
    await Deno.writeTextFile(`${dir}/.codex/config.toml`, "invalid TOML = [");
    await Deno.writeTextFile(`${dir}/codex`, "#!/bin/bash\nexit 1\n");
    await Deno.writeTextFile(`${dir}/curl`, `#!/bin/bash\ntouch "${dir}/curl-called"\necho '{"result":{}}'\n`);
    await Deno.chmod(`${dir}/codex`, 0o700);
    await Deno.chmod(`${dir}/curl`, 0o700);
    const script = `${dir}/installer.sh`;
    await Deno.writeTextFile(script, CHATGPT_SETUP_SCRIPT);
    const result = await new Deno.Command("bash", {
      args: [script],
      env: {
        HOME: dir,
        CODEX_HOME: `${dir}/.codex`,
        PATH: `${dir}:${Deno.env.get("PATH")}`,
        SWARM_TOKEN: "smcp_gpt_fixture",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code === 0, false);
    assertEquals(await Deno.readTextFile(`${dir}/.codex/config.toml`), "invalid TOML = [");
    assertEquals(await Deno.stat(`${dir}/.swarm-brain`).then(() => true).catch(() => false), false);
    assertEquals(await Deno.stat(`${dir}/curl-called`).then(() => true).catch(() => false), false);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
