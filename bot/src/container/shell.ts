/**
 * Запуск внешней команды с полным захватом вывода.
 *
 * Своя обёртка, а не `execFile`, по одной причине: ffmpeg и pactl пишут то, ради чего их
 * зовут, в stderr, и «ошибка → исключение» здесь мешает — вывод нужен и при ненулевом коде.
 */
import { spawn } from "node:child_process";

export interface CommandResult {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export async function run(command: string, argv: readonly string[]): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, [...argv], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));

    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * То же, но ненулевой код — это ошибка: для команд, чей провал не имеет смысла терпеть.
 */
export async function runOrThrow(command: string, argv: readonly string[]): Promise<CommandResult> {
  const result = await run(command, argv);
  if (result.code !== 0) {
    throw new Error(
      `«${command} ${argv.join(" ")}» вышла с кодом ${String(result.code)}: ` +
        (result.stderr.trim() || result.stdout.trim()),
    );
  }
  return result;
}
