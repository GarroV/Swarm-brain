import Docker from "dockerode";
import { PollLoop } from "./poll-loop.ts";

const INTERVAL_MS = 5 * 60_000;
const MEMORY_BYTES = 256 * 1024 * 1024;

export interface RecoveryRunner {
  people(): Promise<{ person: number; volume: string }[]>;
  run(person: number, volume: string): Promise<void>;
}

/**
Sequential finite workers, outside meeting/container admission slots.
*/
export function uploadRecoveryService(
  runner: RecoveryRunner,
  log: (line: string) => void,
): PollLoop {
  return new PollLoop(
    "досылка записей",
    async () => {
      try {
        const people = await runner.people();
        for (const { person, volume } of people) {
          try {
            await runner.run(person, volume);
          } catch (error) {
            log(`досылка не удалась: ${error instanceof Error ? error.message : "worker failed"}`);
          }
        }
      } catch (error) {
        log(`тома досылки недоступны: ${error instanceof Error ? error.message : "docker failed"}`);
      }
    },
    INTERVAL_MS,
  );
}

export class DockerRecoveryRunner implements RecoveryRunner {
  private readonly docker = new Docker();
  private readonly options: {
    project: string;
    image: string;
    swarmUrl: string;
    token: string;
    log: (line: string) => void;
  };
  constructor(options: DockerRecoveryRunner["options"]) {
    this.options = options;
  }

  async people(): Promise<{ person: number; volume: string }[]> {
    const prefix = `${this.options.project}-recordings-`;
    const volumes = await this.docker.listVolumes({ filters: JSON.stringify({ name: [prefix] }) });
    return volumes.Volumes.flatMap((volume) => {
      if (!volume.Name.startsWith(prefix)) return [];
      const suffix = volume.Name.slice(prefix.length);
      const person = Number(suffix);
      return /^[1-9]\d*$/u.test(suffix) && Number.isSafeInteger(person)
        ? [{ person, volume: volume.Name }]
        : [];
    });
  }

  async run(person: number, volume: string): Promise<void> {
    const name = `${this.options.project}-upload-recovery-${String(person)}`;
    // A previous orchestrator may have left a worker uploading. Never launch another beside it.
    const previous = this.docker.getContainer(name);
    try {
      const state = await previous.inspect();
      if (state.State.Running) return;
      await previous.remove();
    } catch (error) {
      if (!(
        error &&
        typeof error === "object" &&
        "statusCode" in error &&
        error.statusCode === 404
      ))
        throw error;
    }
    const container = await this.docker.createContainer({
      name,
      Image: this.options.image,
      Tty: true,
      Entrypoint: ["node", "/app/src/orchestrator/upload-recovery-main.ts"],
      Cmd: [],
      Env: [
        `SCRIBA_SWARM_URL=${this.options.swarmUrl}`,
        `SCRIBA_BOT_TOKEN=${this.options.token}`,
        `SCRIBA_RECOVERY_PERSON=${String(person)}`,
      ],
      // Different label from meeting containers: normal orphan adoption must not remove this job.
      Labels: { "scriba.recovery-project": this.options.project },
      HostConfig: {
        Init: true,
        Memory: MEMORY_BYTES,
        MemorySwap: MEMORY_BYTES,
        NanoCpus: 500_000_000,
        PidsLimit: 64,
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        Mounts: [{ Type: "volume", Source: volume, Target: "/recordings" }],
      },
    });
    await container.start();
    const result: unknown = await container.wait();
    const output = await container.logs({ stdout: true, stderr: true });
    const tail = output.toString().slice(-4000).trim();
    if (tail) this.options.log(tail);
    await container.remove();
    if (
      result === null ||
      typeof result !== "object" ||
      !("StatusCode" in result) ||
      result.StatusCode !== 0
    ) {
      throw new Error("upload worker did not exit successfully");
    }
  }
}
