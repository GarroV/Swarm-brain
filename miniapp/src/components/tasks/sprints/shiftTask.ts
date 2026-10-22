import { addTasksToSprintCycle, removeTaskFromSprintCycle } from "@/lib/api";

/**
 * Перестановка между запланированными спринтами — без причины (планирование, а не срыв):
 * снять в одном, взять в другом. Не взялось в цель — возвращаем в прежний, чтобы задача
 * не пропала из плана. Общая для доски и для списка состава.
 */
export async function shiftBetweenDrafts(
  taskId: string,
  fromCycleId: string,
  targetCycleId: string,
  failedMessage: string,
): Promise<void> {
  await removeTaskFromSprintCycle(fromCycleId, taskId);
  const added = await addTasksToSprintCycle(targetCycleId, [taskId]).catch(
    () => 0,
  );
  if (added < 1) {
    await addTasksToSprintCycle(fromCycleId, [taskId]);
    throw new Error(failedMessage);
  }
}
