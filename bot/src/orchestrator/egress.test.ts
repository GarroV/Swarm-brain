import { describe, expect, it } from "vitest";

import { DockerMeetingEgress, EGRESS_LABEL } from "./egress.ts";
import type { EgressEngine, EngineContainer, EngineNetwork, ProxySpec } from "./engine.ts";

class FakeEgressEngine implements EgressEngine {
  private next = 0;
  readonly calls: string[] = [];
  readonly proxies: ProxySpec[] = [];
  containers: EngineContainer[] = [];
  networks: EngineNetwork[] = [];
  shouldFailStart = false;
  shouldFailConnect = false;
  busyRemovals = 0;

  createProxy(spec: ProxySpec): Promise<string> {
    this.next += 1;
    const id = `p${String(this.next)}`;
    this.proxies.push(spec);
    this.containers = [...this.containers, { id, running: false, labels: spec.labels }];
    this.calls.push(`createProxy:${id}`);
    return Promise.resolve(id);
  }

  start(id: string): Promise<void> {
    this.calls.push(`start:${id}`);
    if (this.shouldFailStart) return Promise.reject(new Error("no such image"));
    this.containers = this.containers.map((c) => (c.id === id ? { ...c, running: true } : c));
    return Promise.resolve();
  }

  remove(id: string): Promise<void> {
    this.calls.push(`remove:${id}`);
    this.containers = this.containers.filter((c) => c.id !== id);
    return Promise.resolve();
  }

  listByLabel(label: string, value: string): Promise<EngineContainer[]> {
    return Promise.resolve(this.containers.filter((c) => c.labels[label] === value));
  }

  createInternalNetwork(name: string, labels: Readonly<Record<string, string>>): Promise<void> {
    this.calls.push(`network:${name}`);
    this.networks = [...this.networks, { name, labels }];
    return Promise.resolve();
  }

  connect(network: string, containerId: string, alias: string): Promise<void> {
    this.calls.push(`connect:${network}:${containerId}:${alias}`);
    return this.shouldFailConnect
      ? Promise.reject(new Error("no such network"))
      : Promise.resolve();
  }

  disconnect(network: string, containerId: string): Promise<void> {
    this.calls.push(`disconnect:${network}:${containerId}`);
    return Promise.resolve();
  }

  removeNetwork(name: string): Promise<void> {
    this.calls.push(`removeNetwork:${name}`);
    if (this.busyRemovals > 0) {
      this.busyRemovals -= 1;
      return Promise.reject(new Error("network has active endpoints"));
    }
    this.networks = this.networks.filter((n) => n.name !== name);
    return Promise.resolve();
  }

  listNetworksByLabel(label: string, value: string): Promise<EngineNetwork[]> {
    return Promise.resolve(this.networks.filter((n) => n.labels[label] === value));
  }
}

function egressOn(engine: FakeEgressEngine, swarmUrl = "https://abc.supabase.co/functions/v1") {
  const lines: string[] = [];
  const egress = new DockerMeetingEgress({
    engine,
    project: "stand",
    image: "scriba:dev",
    swarmUrl,
    extraTargets: ["lh7.example.net:443"],
    log: (line) => {
      lines.push(line);
    },
    sleep: () => Promise.resolve(),
  });
  return { egress, lines };
}

describe("сеть встречи и egress-прокси", () => {
  it("встреча получает свою internal-сеть, к ней подключён прокси, адрес прокси — по имени", async () => {
    const engine = new FakeEgressEngine();
    const { egress } = egressOn(engine);
    const network = await egress.prepare("r1");
    expect(network).toEqual({
      network: "stand-meeting-r1",
      proxyUrl: `${["ht", "tp:"].join("")}//egress:3128`,
    });
    expect(engine.calls).toEqual([
      "createProxy:p1",
      "start:p1",
      "network:stand-meeting-r1",
      "connect:stand-meeting-r1:p1:egress",
    ]);
    expect(engine.networks[0]?.labels).toEqual({ [EGRESS_LABEL]: "stand", "scriba.run": "r1" });
  });

  it("прокси знает свой Swarm и добавку, помечен не меткой встреч", async () => {
    const engine = new FakeEgressEngine();
    await egressOn(engine).egress.prepare("r1");
    const [spec] = engine.proxies;
    expect(spec?.name).toBe("stand-egress");
    expect(spec?.command).toEqual(["node", "/app/src/container/egress-proxy-main.ts"]);
    expect(spec?.env).toEqual([
      "SCRIBA_EGRESS_SWARM_URL=https://abc.supabase.co/functions/v1",
      "SCRIBA_EGRESS_EXTRA=lh7.example.net:443",
      "SCRIBA_EGRESS_PORT=3128",
    ]);
    expect(spec?.labels[EGRESS_LABEL]).toBe("stand");
    expect(spec?.labels).not.toHaveProperty("scriba.project");
    expect(spec?.limits.memoryBytes).toBeLessThan(512 * 1024 * 1024);
  });

  it("живой прокси с тем же списком переиспользуется, два запуска разом не поднимают два", async () => {
    const engine = new FakeEgressEngine();
    const { egress } = egressOn(engine);
    await Promise.all([egress.prepare("r1"), egress.prepare("r2")]);
    await egress.prepare("r3");
    expect(engine.calls.filter((call) => call.startsWith("createProxy"))).toHaveLength(1);
  });

  it("прокси со старым списком или остановленный — убирается и поднимается новый", async () => {
    const engine = new FakeEgressEngine();
    await egressOn(engine, "https://old.supabase.co").egress.prepare("r1");
    const { egress, lines } = egressOn(engine);
    await egress.prepare("r2");
    expect(engine.calls).toContain("remove:p1");
    expect(engine.calls).toContain("createProxy:p2");
    expect(lines[0]).toMatch(/убираю egress-прокси p1/u);
  });

  it("прокси не стартовал — убран, запуск встречи получает громкий отказ", async () => {
    const engine = new FakeEgressEngine();
    engine.shouldFailStart = true;
    await expect(egressOn(engine).egress.prepare("r1")).rejects.toThrow(
      /egress-прокси не стартовал/u,
    );
    expect(engine.calls).toEqual(["createProxy:p1", "start:p1", "remove:p1"]);
    expect(engine.networks).toEqual([]);
  });

  it("очередь не залипает на одном сбое: следующий запуск пробует снова", async () => {
    const engine = new FakeEgressEngine();
    const { egress } = egressOn(engine);
    engine.shouldFailStart = true;
    await expect(egress.prepare("r1")).rejects.toThrow();
    engine.shouldFailStart = false;
    await expect(egress.prepare("r2")).resolves.toMatchObject({ network: "stand-meeting-r2" });
  });

  it("прокси не подключился к сети — сеть убрана, отказ наверх", async () => {
    const engine = new FakeEgressEngine();
    engine.shouldFailConnect = true;
    await expect(egressOn(engine).egress.prepare("r1")).rejects.toThrow(/no such network/u);
    expect(engine.networks).toEqual([]);
  });

  it("конец встречи: прокси отключён от её сети, сеть убрана, в том числе с повтором", async () => {
    const engine = new FakeEgressEngine();
    const { egress } = egressOn(engine);
    await egress.prepare("r1");
    engine.busyRemovals = 2;
    await egress.release("r1");
    expect(engine.calls.slice(-4)).toEqual([
      "disconnect:stand-meeting-r1:p1",
      "removeNetwork:stand-meeting-r1",
      "removeNetwork:stand-meeting-r1",
      "removeNetwork:stand-meeting-r1",
    ]);
    expect(engine.networks).toEqual([]);
  });

  it("сеть так и не отпущена — отказ после повторов, а не вечное ожидание", async () => {
    const engine = new FakeEgressEngine();
    const { egress } = egressOn(engine);
    await egress.prepare("r1");
    engine.busyRemovals = 99;
    await expect(egress.release("r1")).rejects.toThrow(/active endpoints/u);
    expect(engine.calls.filter((call) => call === "removeNetwork:stand-meeting-r1")).toHaveLength(
      5,
    );
  });

  it("старт службы: сеть живой встречи подключается к прокси, чужие по проекту не трогаются, сироты убираются", async () => {
    const engine = new FakeEgressEngine();
    engine.networks = [
      { name: "stand-meeting-live", labels: { [EGRESS_LABEL]: "stand", "scriba.run": "live" } },
      { name: "stand-meeting-dead", labels: { [EGRESS_LABEL]: "stand", "scriba.run": "dead" } },
      { name: "stand-meeting-nolabel", labels: { [EGRESS_LABEL]: "stand" } },
      { name: "other-meeting-x", labels: { [EGRESS_LABEL]: "other", "scriba.run": "x" } },
    ];
    const { egress, lines } = egressOn(engine);
    await egress.sweep(new Set(["live"]));
    expect(engine.calls).toContain("connect:stand-meeting-live:p1:egress");
    expect(engine.networks.map((n) => n.name)).toEqual(["stand-meeting-live", "other-meeting-x"]);
    expect(lines).toContain("убираю сеть встречи прошлого запуска stand-meeting-dead");
  });
});
