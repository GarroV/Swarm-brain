// Execute the real legacy editor and save handler with controlled hooks/GET promises.
// Like sw.test.ts, compile the actual source rather than a second implementation.
import { assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";

// TypeScript is a build tool, not application code. Keep its 200k lines outside
// Deno's coverage process while executing the emitted real handler below.
const compilation = await new Deno.Command("node", {
  args: [
    "-e",
    `const {createRequire} = require("node:module");
const fs = require("node:fs");
const ts = createRequire(process.argv[1])("typescript");
process.stdout.write(ts.transpileModule(fs.readFileSync(process.argv[2], "utf8"), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}
}).outputText);`,
    fileURLToPath(new URL("../../package.json", import.meta.url)),
    fileURLToPath(
      new URL("../components/roy/screens/NewTask.tsx", import.meta.url),
    ),
  ],
}).output();
if (!compilation.success) {
  throw new Error("Could not compile the legacy editor test fixture");
}
const compiled = new TextDecoder().decode(compilation.stdout);

type Node = { type: unknown; props: Record<string, unknown> };
type Effect = { deps: unknown[]; cleanup?: () => void };
type TaskData = Record<string, unknown>;
function deferred() {
  let resolve!: (value: TaskData) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<TaskData>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const fullTask = (title = "Existing title"): TaskData => ({
  title,
  description: "Keep existing description",
  country: "RS",
  priority: "high",
  due_date: "2099-02-12",
  assignee_telegram_ids: [123],
});
function find(
  node: unknown,
  predicate: (node: Node) => boolean,
): Node | undefined {
  if (!node || typeof node !== "object") return;
  const element = node as Node;
  if (predicate(element)) return element;
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, predicate);
    if (result) return result;
  }
}
function editor(initialId: string | null = "task-A") {
  const values: unknown[] = [],
    effects = new Map<number, Effect>(),
    gets: ReturnType<typeof deferred>[] = [];
  const patches: { id: string; payload: TaskData }[] = [],
    creates: TaskData[] = [];
  let id: string | undefined = initialId ?? undefined,
    cursor = 0,
    tree: unknown,
    pops = 0;
  let pendingEffects: (() => void)[] = [];
  const set = (index: number, value: unknown) => {
    values[index] = typeof value === "function" ? value(values[index]) : value;
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({
    type,
    props: props ?? {},
  });
  const modules: Record<string, unknown> = {
    react: {
      useState(initial: unknown) {
        const index = cursor++;
        if (!(index in values)) {
          values[index] = typeof initial === "function" ? initial() : initial;
        }
        return [values[index], (value: unknown) => set(index, value)];
      },
      useEffect(callback: () => void | (() => void), deps: unknown[]) {
        const index = cursor++, previous = effects.get(index);
        if (
          previous &&
          deps.every((value, i) => Object.is(value, previous.deps[i]))
        ) return;
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects.set(index, { deps, cleanup: callback() || undefined });
        });
      },
    },
    "react/jsx-runtime": { jsx, jsxs: jsx },
    "../nav": {
      useRoyNav: () => ({
        me: { telegram_id: 123 },
        pop: () => pops++,
        toast() {},
        setTab() {},
        openTasks() {},
      }),
      useDt: () => (_ru: string, en: string) => en,
    },
    "../ui": {
      NavHeader: "NavHeader",
      SectionLabel: "SectionLabel",
      Chip: "Chip",
      Segmented: "Segmented",
    },
    "@/components/tasks/taskModalPresentation": {
      TaskHydrationNotice: "TaskHydrationNotice",
    },
    "@/lib/api": {
      fetchConfig: () => Promise.resolve({ allowed_markets: [] }),
      fetchUsers: () => Promise.resolve([]),
      fetchTask: () => {
        const request = deferred();
        gets.push(request);
        return request.promise;
      },
      updateTask: (taskId: string, payload: TaskData) => {
        patches.push({ id: taskId, payload });
        return Promise.resolve();
      },
      createTask: (payload: TaskData) => {
        creates.push(payload);
        return Promise.resolve({ ...payload, id: "created" });
      },
    },
    "@/lib/smartLists": {
      matchesLens: () => true,
      matchesList: () => true,
      DEFAULT_STATUSES: new Set(),
    },
    "@/lib/dateRange": { tomorrowLocalISO: () => "2099-01-02" },
    "@/components/tasks/useReminderTasks": { readSavedTasksView: () => null },
    "@/lib/utils": { displayName: (name: string) => name },
    "@/components/ui/DatePicker": { DatePicker: "DatePicker" },
  };
  const module = {
    exports: {} as { NewTask?: (props: { id?: string }) => unknown },
  };
  new Function("module", "exports", "require", compiled)(
    module,
    module.exports,
    (name: string) => {
      if (!(name in modules)) throw new Error(`Unhandled test import: ${name}`);
      return modules[name];
    },
  );
  const render = (nextId: string | null | undefined = id) => {
    id = nextId ?? undefined;
    cursor = 0;
    pendingEffects = [];
    tree = module.exports.NewTask!({ id });
    pendingEffects.forEach((effect) => effect());
  };
  render();
  return {
    gets,
    patches,
    creates,
    render,
    settle: async () => {
      await Promise.resolve();
      await Promise.resolve();
      render();
    },
    changeTitle(value: string) {
      const input = find(tree, (node) => node.type === "input")!;
      (input.props.onChange as (event: unknown) => void)({ target: { value } });
      render();
    },
    save: () =>
      (find(
        tree,
        (node) =>
          node.type === "button" &&
          ["Save", "Create task", "Сохранить", "Создать задачу"].includes(
            String(node.props.children),
          ),
      )!.props.onClick as () => Promise<void>)(),
    disabled: () =>
      find(tree, (node) => node.type === "fieldset")?.props.disabled === true,
    errorVisible: () =>
      !!find(tree, (node) => node.type === "TaskHydrationNotice"),
    retry() {
      const notice = find(tree, (node) => node.type === "TaskHydrationNotice")!;
      (notice.props.setHydrateAttempt as (value: unknown) => void)((
        n: number,
      ) => n + 1);
      render();
    },
    title: () => find(tree, (node) => node.type === "input")!.props.value,
    pops: () => pops,
  };
}

Deno.test("legacy mobile edit: pending hydration blocks the actual save handler", async () => {
  const view = editor();
  // Invoke the callback directly too: disabling only the DOM button is insufficient.
  view.changeTitle("Attempt before GET");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.disabled(), true);
});

Deno.test("legacy mobile edit: failed GET stays blocked and retry is explicit", async () => {
  const view = editor();
  view.gets[0].reject(new Error("fixture503"));
  await view.settle();
  view.changeTitle("Attempt after failure");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.disabled(), true);
  assertEquals(view.errorVisible(), true);
  await view.settle();
  assertEquals(view.gets.length, 1);
  view.retry();
  await view.settle();
  assertEquals(view.gets.length, 2);
  assertEquals(view.disabled(), true);
  assertEquals(view.errorVisible(), false);
  view.gets[1].resolve(fullTask());
  await view.settle();
  assertEquals(view.disabled(), false);
});

Deno.test("legacy mobile edit: hydrated save retains every existing payload field", async () => {
  const view = editor();
  view.gets[0].resolve(fullTask());
  await view.settle();
  view.changeTitle("Only the title changes");
  await view.save();
  assertEquals(view.patches, [{
    id: "task-A",
    payload: {
      title: "Only the title changes",
      description: "Keep existing description",
      country: "RS",
      priority: "high",
      due_date: "2099-02-12",
      assignee_telegram_id: 123,
    },
  }]);
  assertEquals(view.pops(), 1);
});

Deno.test("legacy mobile edit: late previous task response cannot hydrate the next task", async () => {
  const view = editor();
  view.render("task-B");
  view.gets[0].resolve(fullTask("Obsolete A"));
  await view.settle();
  view.changeTitle("Not ready B");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.disabled(), true);
  view.gets[1].resolve(fullTask("Current B"));
  await view.settle();
  assertEquals(view.title(), "Current B");
  assertEquals(view.disabled(), false);
});

Deno.test("legacy mobile edit: changing id invalidates an already hydrated form", async () => {
  const view = editor();
  view.gets[0].resolve(fullTask());
  await view.settle();
  view.render("task-B");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.disabled(), true);
});

Deno.test("legacy mobile create: no hydration GET and original create payload", async () => {
  const view = editor(null);
  view.changeTitle("New task");
  await view.save();
  assertEquals(view.gets.length, 0);
  assertEquals(view.creates, [{
    title: "New task",
    description: null,
    country: null,
    priority: "med",
    due_date: "2099-01-02",
    assignee_telegram_id: null,
  }]);
});

Deno.test("legacy mobile edit: incomplete200 response is not full hydration", async () => {
  const view = editor();
  const partial = fullTask();
  delete partial.description;
  view.gets[0].resolve(partial);
  await view.settle();
  view.changeTitle("Attempt after partial response");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.disabled(), true);
  assertEquals(view.errorVisible(), true);
});

Deno.test("legacy mobile create: previous edit failure does not block creation", async () => {
  const view = editor();
  view.gets[0].reject(new Error("fixture503"));
  await view.settle();
  view.render(null);
  assertEquals(view.disabled(), false);
  assertEquals(view.errorVisible(), false);
  view.changeTitle("New task after failed edit");
  await view.save();
  assertEquals(view.patches.length, 0);
  assertEquals(view.creates.length, 1);
  assertEquals(view.gets.length, 1);
});
