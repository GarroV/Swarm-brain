/**
 * Границы модулей выведены из графа блоков (docs/furca/plan.md, «Блоки и граф зависимостей»).
 * Стрелка «A --> B» значит «B зависит от контракта A», то есть B может импортировать A,
 * но не наоборот. Блоки строятся параллельно в разных копиях репозитория и друг друга
 * не видят — нарушение границы иначе всплывает только при слиянии, у того, кто его не вносил.
 *
 * Внутри бота граф такой:
 *   container    --> meet-adapter, orchestrator
 *   meet-adapter --> swarm-client
 *   swarm-client --> orchestrator
 * shared доступен всем и не импортирует ни один блок.
 */
const BLOCKS = {
  container: [],
  "meet-adapter": ["container"],
  "swarm-client": ["meet-adapter"],
  orchestrator: ["container", "swarm-client"],
};

const boundaryRules = Object.entries(BLOCKS).map(([block, allowed]) => ({
  name: `block-${block}-boundary`,
  severity: "error",
  comment: `Блок «${block}» импортирует только ${
    allowed.length > 0 ? allowed.map((b) => `«${b}»`).join(", ") + " и " : ""
  }«shared». Остальные блоки — мимо графа зависимостей.`,
  from: { path: `^src/${block}/` },
  to: {
    path: "^src/([^/]+)/",
    pathNot: [`^src/(${[block, ...allowed, "shared"].join("|")})/`],
  },
}));

module.exports = {
  forbidden: [
    ...boundaryRules,
    {
      name: "shared-imports-no-block",
      severity: "error",
      comment: "«shared» — общий низ, он не может зависеть ни от одного блока.",
      from: { path: "^src/shared/" },
      to: { path: "^src/(?!shared/)[^/]+/" },
    },
    {
      name: "no-circular",
      severity: "error",
      comment: "Циклическая зависимость: граф блоков ациклический по построению.",
      from: {},
      to: { circular: true },
    },
    {
      name: "no-orphans",
      severity: "warn",
      comment: "Файл, на который никто не ссылается, — кандидат в мёртвый код.",
      from: { orphan: true, pathNot: ["\\.d\\.ts$", "(^|/)src/index\\.ts$"] },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    exclude: { path: "\\.test\\.ts$" },
  },
};
