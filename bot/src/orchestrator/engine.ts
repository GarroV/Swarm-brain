/**
 * Узкая граница «оркестратор ↔ Docker». Оркестратор знает только этот интерфейс; dockerode
 * живёт в `docker-engine.ts`. Так правила оркестратора (смерть, сироты, подхват) проверяются
 * тестом на двойнике, а живой Docker проверяет смоук.
 */
import type { ContainerLimits } from "../container/isolation.ts";

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
  /**
   * Копия входа аккаунта бота (T175) — один файл хоста только на чтение. Нет — бот идёт гостем.
   */
  readonly accountState?: { readonly source: string; readonly target: string };
  readonly shmBytes: number;
  /**
   * Потолки ресурсов хоста на одну встречу.
   */
  readonly limits: ContainerLimits;
  /**
   * Профиль seccomp строкой JSON: разрешает песочнице Chromium её пространства имён.
   */
  readonly seccompProfile: string;
  /**
   * Сеть встречи (T178): internal, без выхода наружу; единственный сосед — egress-прокси.
   */
  readonly network: string;
}

/**
 * Контейнер egress-прокси стенда: тот же образ, свой процесс, обычная сеть Docker с выходом
 * наружу. Встречи видят его только через свои internal-сети.
 */
export interface ProxySpec {
  readonly name: string;
  readonly image: string;
  readonly command: readonly string[];
  readonly env: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly limits: ContainerLimits;
}

export interface EngineNetwork {
  readonly name: string;
  readonly labels: Readonly<Record<string, string>>;
}

/**
 * Сети встреч и прокси. Отдельно от `ContainerEngine`: оркестратор о сетях не знает, ими
 * ведает `egress.ts`.
 */
export interface EgressEngine {
  /**
   * Поднять прокси; `start` и `remove` — общие с контейнерами встреч.
   */
  createProxy(spec: ProxySpec): Promise<string>;
  start(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  listByLabel(label: string, value: string): Promise<EngineContainer[]>;
  /**
   * Internal-сеть: маршрута наружу нет, внешние имена не резолвятся.
   */
  createInternalNetwork(name: string, labels: Readonly<Record<string, string>>): Promise<void>;
  /**
   * Уже подключён — не ошибка.
   */
  connect(network: string, containerId: string, alias: string): Promise<void>;
  /**
   * Не подключён или сети нет — не ошибка.
   */
  disconnect(network: string, containerId: string): Promise<void>;
  /**
   * Сети нет — не ошибка.
   */
  removeNetwork(name: string): Promise<void>;
  listNetworksByLabel(label: string, value: string): Promise<EngineNetwork[]>;
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
