// Флаг вкладки «Лента» в «Спринтах» (решение владельца 12.11.2026, docs/decisions/2026-11-12-sprints-timeline.md):
// стенд ленты времени идёт на прод только для его аккаунта, чтобы он пощёлкал на живых данных; у остальных
// раздел ровно как был. Раскатка на всех — отдельным решением: тогда флаг удаляется.
//
// Владелец — telegram_id 744230399 (тот же ADMIN_USER_ID зашит в бэкенде). Демо-аккаунт флаг не получает.
// `?sprints=lenta` включает, `?sprints=old` выключает на текущую загрузку, в localStorage не пишется.

export const SPRINTS_OWNER_ID = 744230399;

/** Адрес на момент загрузки страницы: RoyApp переписывает query при первой смене экрана и `?sprints=` пропал бы.
 *  На сборке (статический экспорт) адреса нет — пустая строка. */
export const LOAD_SEARCH: string = typeof location === "undefined"
  ? ""
  : location.search;

export type SprintsFlagViewer = { telegram_id?: number; is_demo?: boolean };

export function isSprintTimelineEnabled(
  me: SprintsFlagViewer | null | undefined,
  search = "",
): boolean {
  const override = new URLSearchParams(search).get("sprints");
  if (override === "lenta") return true;
  if (override === "old") return false;
  return !!me && !me.is_demo && me.telegram_id === SPRINTS_OWNER_ID;
}
