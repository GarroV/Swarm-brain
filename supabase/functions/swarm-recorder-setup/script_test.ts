// Тесты установщика рекордера. Скрипт уезжает людям в терминал одной строкой, поэтому проверяем
// его как программу: синтаксис и поведение развилки «есть ли токен».
//
// Раньше тестов у него не было вовсе — при том что молчаливая опечатка в bash ломает установку
// у каждого нового человека, а не у нас.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { SETUP_SCRIPT } from "./script.ts";

// Песочница: свой HOME (чтобы не трогать настоящий конфиг) и заглушка curl в PATH
// (чтобы скрипт не ходил в сеть и не ставил ничего в /Applications).
async function runScript(opts: { withConfig: boolean; token?: string }): Promise<string> {
  const dir = await Deno.makeTempDir();
  const bin = `${dir}/bin`;
  await Deno.mkdir(bin, { recursive: true });
  // curl-заглушка: молчит, код 1 — скрипт дойдёт до сети и честно оборвётся ПОСЛЕ развилки токена.
  await Deno.writeTextFile(`${bin}/curl`, "#!/bin/bash\nexit 1\n");
  await Deno.chmod(`${bin}/curl`, 0o755);

  if (opts.withConfig) {
    const cfgDir = `${dir}/Library/Application Support/SwarmRecorder`;
    await Deno.mkdir(cfgDir, { recursive: true });
    await Deno.writeTextFile(`${cfgDir}/config.json`,
      JSON.stringify({ token: "smcp_fromlocalconfig", ingestBaseURL: "https://example.invalid", webBaseURL: "" }));
  }

  const path = `${dir}/script.sh`;
  await Deno.writeTextFile(path, SETUP_SCRIPT);
  const env: Record<string, string> = {
    HOME: dir,
    PATH: `${bin}:/usr/bin:/bin:/usr/sbin:/sbin`,
  };
  if (opts.token) env.SWARM_TOKEN = opts.token;

  const cmd = new Deno.Command("bash", { args: [path], env, clearEnv: true, stdout: "piped", stderr: "piped" });
  const { stdout, stderr } = await cmd.output();
  const out = new TextDecoder().decode(stdout) + new TextDecoder().decode(stderr);
  await Deno.remove(dir, { recursive: true });
  return out;
}

Deno.test("установщик: синтаксис bash валиден", async () => {
  const path = await Deno.makeTempFile({ suffix: ".sh" });
  await Deno.writeTextFile(path, SETUP_SCRIPT);
  const { code, stderr } = await new Deno.Command("bash", { args: ["-n", path], stderr: "piped" }).output();
  assertEquals(code, 0, new TextDecoder().decode(stderr));
  await Deno.remove(path);
});

Deno.test("обновление: без SWARM_TOKEN берёт токен из локального конфига", async () => {
  const out = await runScript({ withConfig: true });
  assertStringIncludes(out, "Беру токен из настроек на этом маке");
});

Deno.test("первая установка: без токена и без конфига — понятный отказ, а не молчание", async () => {
  const out = await runScript({ withConfig: false });
  assertStringIncludes(out, "рекордер ещё не настроен");
  assertStringIncludes(out, "/recordertoken");
});

Deno.test("явный SWARM_TOKEN имеет приоритет над локальным конфигом", async () => {
  const out = await runScript({ withConfig: true, token: "smcp_explicit" });
  assertStringIncludes(out, "Токен принят");
});
