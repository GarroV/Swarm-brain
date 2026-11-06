// Типы позиций, которые показывает матрица цен: общий контракт записи и экрана.
export const PIZZA_TYPES = ["margherita", "pepperoni", "ham_mushroom", "premium"] as const;
export type PizzaType = (typeof PIZZA_TYPES)[number];
