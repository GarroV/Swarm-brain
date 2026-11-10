// Флаг «экрана А» на главной (решение владельца 10.11.2026): новая главная идёт на прод только для его
// аккаунта, чтобы он проверил её на своих данных; у всех остальных главная ровно как была. Раскатка на
// всех — отдельным решением: тогда флаг, legacy-виды виджетов и ключ раскладки v3 удаляются.
//
// Владелец — telegram_id 744230399 (тот же ADMIN_USER_ID зашит в бэкенде). Демо-аккаунт флаг не получает.
// `?home=a` включает, `?home=old` выключает на текущую загрузку (для сравнения), в localStorage не пишется.

export const HOME_A_OWNER_ID = 744230399;

/** Адрес на момент загрузки страницы: RoyApp переписывает query при первой смене экрана и `?home=` пропал бы.
 *  На сборке (статический экспорт) адреса нет — пустая строка. */
export const LOAD_SEARCH: string = typeof location === "undefined" ? "" : location.search;

export type HomeFlagViewer = { telegram_id?: number; is_demo?: boolean };

export function isHomeAEnabled(me: HomeFlagViewer | null | undefined, search = ""): boolean {
  const override = new URLSearchParams(search).get("home");
  if (override === "a") return true;
  if (override === "old") return false;
  return !!me && !me.is_demo && me.telegram_id === HOME_A_OWNER_ID;
}
