/**
 * `ContainerEngine` поверх dockerode. Только перевод вызовов — решений здесь нет.
 * Проверяется живым прогоном против настоящего Docker (`smoke-orchestrator.ts`).
 */
import { PassThrough } from "node:stream";

import Docker from "dockerode";

import type {
  ContainerEngine,
  ContainerSpec,
  EgressEngine,
  EngineContainer,
  EngineNetwork,
  ProxySpec,
} from "./engine.ts";

const NOT_FOUND = 404;
const NOT_MODIFIED = 304;

function statusOf(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" ? status : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lines(stream: PassThrough, onLine: (line: string) => void): void {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    buffer += chunk;
    let at = buffer.indexOf("\n");
    while (at !== -1) {
      onLine(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      at = buffer.indexOf("\n");
    }
  });
  stream.on("end", () => {
    if (buffer !== "") onLine(buffer);
  });
}

export class DockerodeEngine implements ContainerEngine, EgressEngine {
  private readonly docker: Docker;

  constructor(docker: Docker = new Docker()) {
    this.docker = docker;
  }

  async create(spec: ContainerSpec): Promise<string> {
    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      Cmd: [...spec.command],
      Env: [...spec.env],
      Labels: { ...spec.labels },
      HostConfig: {
        // tini первым процессом: SIGTERM от `stop` доходит до процесса встречи.
        Init: true,
        AutoRemove: true,
        ShmSize: spec.shmBytes,
        Memory: spec.limits.memoryBytes,
        // Равен Memory: своп сверх потолка не даётся, иначе потолок только замедлит хост.
        MemorySwap: spec.limits.memoryBytes,
        NanoCpus: spec.limits.nanoCpus,
        PidsLimit: spec.limits.pids,
        // Песочнице Chromium нужны свои пространства имён (профиль разрешает ровно их);
        // повысить права через setuid-бинарник процесс внутри не сможет.
        SecurityOpt: [`seccomp=${spec.seccompProfile}`, "no-new-privileges:true"],
        Mounts: [
          { Type: "volume", Source: spec.volume.name, Target: spec.volume.target },
          {
            Type: "bind",
            Source: spec.readOnlyBind.source,
            Target: spec.readOnlyBind.target,
            ReadOnly: true,
          },
          ...(spec.accountState === undefined
            ? []
            : [
                {
                  Type: "bind" as const,
                  Source: spec.accountState.source,
                  Target: spec.accountState.target,
                  ReadOnly: true,
                },
              ]),
        ],
        // Сеть встречи — internal (T178): наружу только через egress-прокси.
        NetworkMode: spec.network,
      },
    });
    return container.id;
  }

  async createProxy(spec: ProxySpec): Promise<string> {
    const container = await this.docker.createContainer({
      name: spec.name,
      Image: spec.image,
      // Образ встречи начинает с entrypoint звука и экрана — прокси они не нужны.
      Entrypoint: [...spec.command],
      Cmd: [],
      Env: [...spec.env],
      Labels: { ...spec.labels },
      HostConfig: {
        Init: true,
        // Упавший прокси — встречи без сети: Docker поднимает его сам.
        RestartPolicy: { Name: "unless-stopped" },
        Memory: spec.limits.memoryBytes,
        MemorySwap: spec.limits.memoryBytes,
        NanoCpus: spec.limits.nanoCpus,
        PidsLimit: spec.limits.pids,
        SecurityOpt: ["no-new-privileges:true"],
        NetworkMode: "bridge",
        // Двойник сервера в смоуке живёт на хосте; в Docker на Linux без этой строки
        // host.docker.internal не резолвится.
        ExtraHosts: ["host.docker.internal:host-gateway"],
      },
    });
    return container.id;
  }

  async createInternalNetwork(
    name: string,
    labels: Readonly<Record<string, string>>,
  ): Promise<void> {
    await this.docker.createNetwork({
      Name: name,
      Driver: "bridge",
      Internal: true,
      Labels: { ...labels },
    });
  }

  async connect(network: string, containerId: string, alias: string): Promise<void> {
    try {
      await this.docker
        .getNetwork(network)
        .connect({ Container: containerId, EndpointConfig: { Aliases: [alias] } });
    } catch (error) {
      if (/already exists/iu.test(messageOf(error))) return;
      throw error;
    }
  }

  async disconnect(network: string, containerId: string): Promise<void> {
    try {
      await this.docker.getNetwork(network).disconnect({ Container: containerId, Force: true });
    } catch (error) {
      if (statusOf(error) === NOT_FOUND || /not connected/iu.test(messageOf(error))) return;
      throw error;
    }
  }

  async removeNetwork(name: string): Promise<void> {
    try {
      await this.docker.getNetwork(name).remove();
    } catch (error) {
      if (statusOf(error) === NOT_FOUND) return;
      throw error;
    }
  }

  async listNetworksByLabel(label: string, value: string): Promise<EngineNetwork[]> {
    const found = await this.docker.listNetworks({ filters: { label: [`${label}=${value}`] } });
    return found.map((info) => ({ name: info.Name, labels: info.Labels ?? {} }));
  }

  async start(id: string): Promise<void> {
    await this.docker.getContainer(id).start();
  }

  async waitExit(id: string, condition: "next-exit" | "not-running"): Promise<number | null> {
    try {
      const result = (await this.docker.getContainer(id).wait({ condition })) as {
        StatusCode?: unknown;
      };
      return typeof result.StatusCode === "number" ? result.StatusCode : null;
    } catch (error) {
      if (statusOf(error) === NOT_FOUND) return null;
      throw error;
    }
  }

  async stop(id: string, graceSeconds: number): Promise<void> {
    try {
      await this.docker.getContainer(id).stop({ t: graceSeconds });
    } catch (error) {
      // Уже остановлен или уже убран — цель достигнута.
      const status = statusOf(error);
      if (status === NOT_MODIFIED || status === NOT_FOUND) return;
      throw error;
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await this.docker.getContainer(id).remove({ force: true });
    } catch (error) {
      if (statusOf(error) === NOT_FOUND) return;
      throw error;
    }
  }

  async listByLabel(label: string, value: string): Promise<EngineContainer[]> {
    const found = await this.docker.listContainers({
      all: true,
      filters: { label: [`${label}=${value}`] },
    });
    return found.map((info) => ({
      id: info.Id,
      running: info.State === "running",
      labels: info.Labels,
    }));
  }

  async followLogs(id: string, onLine: (line: string) => void): Promise<void> {
    const raw = await this.docker.getContainer(id).logs({
      follow: true,
      stdout: true,
      stderr: true,
    });
    const out = new PassThrough();
    lines(out, onLine);
    // Без TTY Docker склеивает stdout и stderr в один поток с заголовками кадров.
    this.docker.modem.demuxStream(raw, out, out);
    await new Promise<void>((resolve, reject) => {
      raw.on("end", resolve);
      raw.on("close", resolve);
      raw.on("error", reject);
    });
    out.end();
  }
}
