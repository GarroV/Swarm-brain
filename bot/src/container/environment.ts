/**
 * Настройки контейнера: имена переменных окружения в одном месте.
 *
 * Значения — только в `.env` (контейнер их получает через окружение), здесь имена и
 * безопасные умолчания. Список должен совпадать с `bot/container/.env.example`.
 */

const SINK_NAME_VAR = "SCRIBA_SINK_NAME";
const OUTPUT_DIR_VAR = "SCRIBA_OUTPUT_DIR";
const BITRATE_VAR = "SCRIBA_AUDIO_BITRATE_KBPS";
const RUNTIME_DIR_VAR = "XDG_RUNTIME_DIR";
const DISPLAY_VAR = "DISPLAY";

export interface ContainerSettings {
  readonly sinkName: string;
  readonly outputDirectory: string;
  readonly bitrateKbps: number;
  readonly runtimeDirectory: string | undefined;
  readonly display: string | undefined;
}

const DEFAULT_BITRATE_KBPS = 32;

/**
 * Читает настройки из окружения, подставляя умолчания. Пустая строка — это «не задано»:
 * пустой `SCRIBA_SINK_NAME` из недозаполненного `.env` иначе создал бы sink без имени.
 */
export function readSettings(
  environment: Readonly<Record<string, string | undefined>>,
): ContainerSettings {
  const text = (name: string, fallback: string): string => {
    const value = environment[name];
    return value === undefined || value.trim() === "" ? fallback : value.trim();
  };

  const bitrate = Number(text(BITRATE_VAR, String(DEFAULT_BITRATE_KBPS)));
  if (!Number.isFinite(bitrate) || bitrate <= 0) {
    throw new Error(
      `${BITRATE_VAR} должен быть положительным числом, получено: ${String(bitrate)}`,
    );
  }

  const runtimeDirectory = environment[RUNTIME_DIR_VAR];
  const display = environment[DISPLAY_VAR];

  return {
    sinkName: text(SINK_NAME_VAR, "scriba"),
    outputDirectory: text(OUTPUT_DIR_VAR, "/recordings"),
    bitrateKbps: bitrate,
    runtimeDirectory: runtimeDirectory === "" ? undefined : runtimeDirectory,
    display: display === "" ? undefined : display,
  };
}
