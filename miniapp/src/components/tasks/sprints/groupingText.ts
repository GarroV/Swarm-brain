import type { SubtaskBlock } from "@/lib/sprintGrouping";

type Dt = (ru: string, en: string) => string;

/** Почему задача не станет подзадачей — подпись на силуэте и в запасном окне выбора. */
export function blockText(dt: Dt, block: SubtaskBlock, target: string): string {
  switch (block) {
    case "self":
      return dt("Это та же задача", "This is the same task");
    case "target-subtask":
      return dt(
        `«${target}» — сама подзадача: вложенность одна`,
        `“${target}” is a subtask itself: only one level of nesting`,
      );
    case "has-kids":
      return dt(
        "У этой задачи свои подзадачи — подзадачей она не станет",
        "This task has its own subtasks, so it cannot become one",
      );
    case "already":
      return dt(
        `Уже подзадача «${target}»`,
        `Already a subtask of “${target}”`,
      );
  }
}
