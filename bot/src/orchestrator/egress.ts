/**
 * Выход контейнеров встреч наружу (T178): у каждой встречи своя internal-сеть Docker, в ней
 * единственный сосед — egress-прокси стенда, и наружу контейнер попадает только через него.
 *
 * Почему так, а не iptables: internal-сеть — примитив самого Docker, одинаковый на Docker
 * Desktop (MUSPELHEIM) и на Linux-хосте; маршрута наружу у контейнера в ней нет вовсе
 * (`ENETUNREACH`), внешние имена не резолвятся (проверено 2026-09-28). iptables потребовал бы
 * NET_ADMIN и правил хоста, которые на Docker Desktop не наши.
 *
 * Сеть на встречу, а не одна на всех: иначе контейнеры двух встреч видели бы друг друга.
 *
 * Прокси — один на стенд (контейнер `<project>-egress`, тот же образ, процесс
 * `egress-proxy-main.ts`), помечен `scriba.egress-of`, а не `scriba.project`: разбор сирот
 * оркестратора его не трогает. Состав окружения прокси записан меткой — сменился адрес Swarm
 * или добавка, и прокси пересоздаётся, а живые сети встреч подключаются к новому на старте.
 */
import { createHash } from "node:crypto";

import type { ContainerLimits } from "../container/isolation.ts";
import { describeError } from "./describe-error.ts";
import type { EgressEngine } from "./engine.ts";

export const EGRESS_LABEL = "scriba.egress-of";
const RUN_LABEL = "scriba.run";
const CONFIG_LABEL = "scriba.egress-config";
const EGRESS_ALIAS = "egress";
const EGRESS_PORT = 3128;
const PROXY_COMMAND = ["node", "/app/src/container/egress-proxy-main.ts"];
const MIB = 1024 * 1024;

/**
 * Прокси перекладывает байты: ему хватает малого, а сбесившийся не утянет хост.
 */
const PROXY_LIMITS: ContainerLimits = {
  memoryBytes: 256 * MIB,
  nanoCpus: 1_000_000_000,
  pids: 256,
};

/**
 * Сеть уходит, когда контейнер встречи её отпустил; самоуборка контейнера идёт чуть позже
 * его выхода, поэтому удаление сети повторяется.
 */
const REMOVE_ATTEMPTS = 5;
const REMOVE_PAUSE_MS = 500;

export interface MeetingNetwork {
  readonly network: string;
  /**
   * Адрес прокси, каким его видит контейнер встречи.
   */
  readonly proxyUrl: string;
}

export interface MeetingEgress {
  prepare(runId: string): Promise<MeetingNetwork>;
  release(runId: string): Promise<void>;
  /**
   * На старте службы: сети живых запусков подключить к прокси, остальные убрать.
   */
  sweep(liveRunIds: ReadonlySet<string>): Promise<void>;
}

export interface DockerMeetingEgressOptions {
  readonly engine: EgressEngine;
  readonly project: string;
  readonly image: string;
  /**
   * Корень функций Swarm, каким его видит контейнер встречи.
   */
  readonly swarmUrl: string;
  readonly extraTargets?: readonly string[];
  readonly log: (line: string) => void;
  readonly sleep?: (ms: number) => Promise<void>;
}

const pause = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class DockerMeetingEgress implements MeetingEgress {
  private readonly options: DockerMeetingEgressOptions;

  private readonly env: readonly string[];

  private readonly config: string;

  /**
   * Поиск и подъём прокси идут по очереди: два одновременных запуска иначе подняли бы
   * два прокси с одним именем.
   */
  private queue: Promise<void> = Promise.resolve();

  constructor(options: DockerMeetingEgressOptions) {
    this.options = options;
    this.env = [
      `SCRIBA_EGRESS_SWARM_URL=${options.swarmUrl}`,
      `SCRIBA_EGRESS_EXTRA=${(options.extraTargets ?? []).join(",")}`,
      `SCRIBA_EGRESS_PORT=${String(EGRESS_PORT)}`,
    ];
    this.config = createHash("sha256")
      .update([options.image, ...this.env].join("\n"))
      .digest("hex")
      .slice(0, 16);
  }

  private networkFor(runId: string): string {
    return `${this.options.project}-meeting-${runId}`;
  }

  private async proxy(): Promise<string> {
    const previous = this.queue;
    const next = (async (): Promise<string> => {
      await previous;
      return this.findOrCreateProxy();
    })();
    this.queue = (async (): Promise<void> => {
      try {
        await next;
      } catch {
        // Сбой уходит тому, кто ждал `next`; очередь на нём не залипает.
      }
    })();
    return next;
  }

  private async findOrCreateProxy(): Promise<string> {
    const { engine, project } = this.options;
    const found = await engine.listByLabel(EGRESS_LABEL, project);
    const current = found.find(
      (container) => container.running && container.labels[CONFIG_LABEL] === this.config,
    );
    if (current !== undefined) return current.id;
    for (const stale of found) {
      this.options.log(`убираю egress-прокси ${stale.id}: остановлен или со старым списком`);
      await engine.remove(stale.id);
    }
    const id = await engine.createProxy({
      name: `${project}-egress`,
      image: this.options.image,
      command: PROXY_COMMAND,
      env: this.env,
      labels: { [EGRESS_LABEL]: project, [CONFIG_LABEL]: this.config },
      limits: PROXY_LIMITS,
    });
    try {
      await engine.start(id);
    } catch (error) {
      await engine.remove(id);
      throw new Error(`egress-прокси не стартовал: ${describeError(error)}`, { cause: error });
    }
    this.options.log(`egress-прокси ${id} поднят`);
    return id;
  }

  private async removeNetwork(network: string): Promise<void> {
    const sleep = this.options.sleep ?? pause;
    for (let attempt = 1; ; attempt += 1) {
      try {
        await this.options.engine.removeNetwork(network);
        return;
      } catch (error) {
        if (attempt >= REMOVE_ATTEMPTS) throw error;
        await sleep(REMOVE_PAUSE_MS);
      }
    }
  }

  private async releaseNetwork(network: string): Promise<void> {
    const proxies = await this.options.engine.listByLabel(EGRESS_LABEL, this.options.project);
    for (const proxy of proxies) await this.options.engine.disconnect(network, proxy.id);
    await this.removeNetwork(network);
  }

  async prepare(runId: string): Promise<MeetingNetwork> {
    const proxyId = await this.proxy();
    const network = this.networkFor(runId);
    await this.options.engine.createInternalNetwork(network, {
      [EGRESS_LABEL]: this.options.project,
      [RUN_LABEL]: runId,
    });
    try {
      await this.options.engine.connect(network, proxyId, EGRESS_ALIAS);
    } catch (error) {
      await this.options.engine.removeNetwork(network);
      throw error;
    }
    return { network, proxyUrl: `http://${EGRESS_ALIAS}:${String(EGRESS_PORT)}` };
  }

  async release(runId: string): Promise<void> {
    await this.releaseNetwork(this.networkFor(runId));
  }

  async sweep(liveRunIds: ReadonlySet<string>): Promise<void> {
    const networks = await this.options.engine.listNetworksByLabel(
      EGRESS_LABEL,
      this.options.project,
    );
    for (const { name, labels } of networks) {
      if (liveRunIds.has(labels[RUN_LABEL] ?? "")) {
        await this.options.engine.connect(name, await this.proxy(), EGRESS_ALIAS);
      } else {
        this.options.log(`убираю сеть встречи прошлого запуска ${name}`);
        await this.releaseNetwork(name);
      }
    }
  }
}
