/**
 * Узкая граница «оркестратор ↔ Docker». Оркестратор знает только этот интерфейс; dockerode
 * живёт в `docker-engine.ts`. Так правила оркестратора (смерть, сироты, подхват) проверяются
 * тестом на двойнике, а живой Docker проверяет смоук.
 */

export interface ContainerSpec {
  readonly name: string;
  readonly image: string;
  readonly command: readonly string[];
  readonly env: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  /**
   * Именованный том: переживает контейнер, в нём очередь выгрузки.
   */
  readonly volume: { readonly name: string; readonly target: string };
  /**
   * Каталог хоста только на чтение: поводок оркестратора.
   */
  readonly readOnlyBind: { readonly source: string; readonly target: string };
  readonly shmBytes: number;
}

export interface EngineContainer {
  readonly id: string;
  readonly running: boolean;
  readonly labels: Readonly<Record<string, string>>;
}

export interface ContainerEngine {
  create(spec: ContainerSpec): Promise<string>;
  start(id: string): Promise<void>;
  /**
   * Код выхода; `null` — контейнер исчез раньше, чем код удалось прочитать.
   */
  waitExit(id: string, condition: "next-exit" | "not-running"): Promise<number | null>;
  stop(id: string, graceSeconds: number): Promise<void>;
  remove(id: string): Promise<void>;
  listByLabel(label: string, value: string): Promise<EngineContainer[]>;
  /**
   * Читать журнал с начала и дальше по мере появления строк; промис кончается с контейнером.
   */
  followLogs(id: string, onLine: (line: string) => void): Promise<void>;
}
