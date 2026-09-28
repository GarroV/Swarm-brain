/**
 * Процесс egress-прокси стенда (контейнер `<project>-egress`, образ тот же, что у встреч).
 *
 *   SCRIBA_EGRESS_SWARM_URL — корень функций Swarm, каким его видит контейнер встречи (обязательно);
 *   SCRIBA_EGRESS_EXTRA     — добавка к списку через запятую, только точные host:port;
 *   SCRIBA_EGRESS_PORT      — порт прокси (по умолчанию 3128).
 *
 * Правило — `egress-policy.ts`, туннель — `egress-proxy.ts`; здесь только окружение и сигналы.
 */
import { egressPolicy } from "./egress-policy.ts";
import { createEgressProxy } from "./egress-proxy.ts";

const swarmUrl = process.env.SCRIBA_EGRESS_SWARM_URL ?? "";
if (swarmUrl === "")
  throw new Error("SCRIBA_EGRESS_SWARM_URL не задан — прокси не знает свой Swarm");

const DEFAULT_PORT = 3128;
const extraTargets = (process.env.SCRIBA_EGRESS_EXTRA ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter((item) => item !== "");
const port = Number(process.env.SCRIBA_EGRESS_PORT ?? DEFAULT_PORT);

const proxy = createEgressProxy({
  policy: egressPolicy({ swarmUrl, extraTargets }),
  log: (line) => {
    console.log(line);
  },
});
proxy.listen(port, "0.0.0.0", () => {
  console.log(
    `egress ready :${String(port)} swarm=${swarmUrl} extra=${String(extraTargets.length)}`,
  );
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    proxy.closeAllConnections();
    proxy.close(() => process.exit(0));
  });
}
