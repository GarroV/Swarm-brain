// Escape в карточке задачи: пока открыто меню выбора (страна, люди, дата, повтор), первый
// Escape закрывает только его, а не всю карточку (issue #881). Radix Dialog слушает keydown на
// document в фазе захвата раньше обработчика меню, поэтому карточка сама спрашивает, есть ли
// открытый слой: меню помечает свой всплывающий блок атрибутом ESCAPE_LAYER_ATTR.
export const ESCAPE_LAYER_ATTR = "data-escape-layer";

/** Есть ли в `root` открытое меню, которому принадлежит ближайший Escape. */
export function hasOpenEscapeLayer(root: Pick<ParentNode, "querySelector">): boolean {
  return root.querySelector(`[${ESCAPE_LAYER_ATTR}]`) !== null;
}
