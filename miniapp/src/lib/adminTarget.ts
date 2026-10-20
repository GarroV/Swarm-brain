// Куда открыть «Админ» с баннера сбоя ключа: пространство и вкладка. Одноразово — экран админки
// забирает цель при монтировании (`takeAdminTarget`) и открывает карточку пространства сразу
// на нужной вкладке. Отдельный маршрут не заводим: RoyRoute — общий для всего приложения.
export type AdminTarget = { ws: string; tab: "key" };

let pending: AdminTarget | null = null;

export function setAdminTarget(target: AdminTarget): void {
  pending = target;
}

export function takeAdminTarget(): AdminTarget | null {
  const t = pending;
  pending = null;
  return t;
}
