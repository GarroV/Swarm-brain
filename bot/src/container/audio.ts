/**
 * Самопроверка звукового окружения контейнера.
 *
 * Главная грабля проекта — звук, который молча не пишется: PulseAudio поднялся, sink вроде бы
 * есть, а Chromium играет мимо него, и в файле тишина. Поэтому окружение не «предполагается
 * рабочим», а проверяется: sink существует, он выставлен по умолчанию, monitor-source у него
 * реально есть. Разбор вывода `pactl` вынесен сюда, чтобы его можно было проверить тестом,
 * а не только глазами в контейнере.
 */

/**
 * Строка табличного вывода `pactl list short sinks|sources`.
 */
export interface PactlEntry {
  readonly index: number;
  readonly name: string;
  readonly module: string;
  readonly spec: string;
  readonly state: string;
}

export interface AudioEnvironmentInput {
  /**
   * Имя null-sink, который контейнер создал под запись.
   */
  readonly sinkName: string;
  /**
   * Вывод `pactl list short sinks`.
   */
  readonly sinksShort: string;
  /**
   * Вывод `pactl list short sources`.
   */
  readonly sourcesShort: string;
  /**
   * Вывод `pactl info`.
   */
  readonly info: string;
  /**
   * Значение `XDG_RUNTIME_DIR`: без него PulseAudio разложит сокет там, где его никто не найдёт.
   */
  readonly runtimeDirectory: string | undefined;
}

export interface AudioEnvironmentReport {
  readonly ok: boolean;
  /**
   * Все найденные беды разом: чинить по одной — это несколько перезапусков контейнера.
   */
  readonly problems: readonly string[];
  readonly monitorSource: string | null;
}

const FIELDS_IN_SHORT_LINE = 5;

export function parsePactlShort(output: string): PactlEntry[] {
  const entries: PactlEntry[] = [];

  for (const line of output.split("\n")) {
    const fields = line.split("\t");
    if (fields.length < FIELDS_IN_SHORT_LINE) continue;

    const name = fields[1] ?? "";
    const index = Number(fields[0] ?? "");
    if (name === "" || Number.isNaN(index)) continue;

    entries.push({
      index,
      name,
      module: fields[2] ?? "",
      spec: fields[3] ?? "",
      state: fields[4] ?? "",
    });
  }

  return entries;
}

export function parseDefaultSink(info: string): string | null {
  const match = /^Default Sink:[ \t]*(\S[^\n]*)$/m.exec(info);
  return match?.[1]?.trim() ?? null;
}

export function monitorSourceName(sinkName: string): string {
  return `${sinkName}.monitor`;
}

export function inspectAudioEnvironment(input: AudioEnvironmentInput): AudioEnvironmentReport {
  const problems: string[] = [];
  const monitor = monitorSourceName(input.sinkName);

  if (input.runtimeDirectory === undefined || input.runtimeDirectory === "") {
    problems.push(
      "XDG_RUNTIME_DIR не выставлен: PulseAudio положит сокет не туда, и клиенты его не найдут",
    );
  }

  const sinks = parsePactlShort(input.sinksShort);
  if (sinks.every((sink) => sink.name !== input.sinkName)) {
    const known = sinks.length > 0 ? sinks.map((sink) => sink.name).join(", ") : "список пуст";
    problems.push(`null-sink «${input.sinkName}» не создан: в списке sink'ов его нет (${known})`);
  }

  const defaultSink = parseDefaultSink(input.info);
  if (defaultSink !== input.sinkName) {
    problems.push(
      `sink по умолчанию — «${defaultSink ?? "не задан"}», а не «${input.sinkName}»: ` +
        "Chromium заиграет мимо записи, и в файле будет тишина",
    );
  }

  const hasMonitor = parsePactlShort(input.sourcesShort).some((source) => source.name === monitor);
  if (!hasMonitor) {
    problems.push(`monitor-source «${monitor}» не существует: читать запись будет неоткуда`);
  }

  return {
    ok: problems.length === 0,
    problems,
    monitorSource: hasMonitor ? monitor : null,
  };
}
