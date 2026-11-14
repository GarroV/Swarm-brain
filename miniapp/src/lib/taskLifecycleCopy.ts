/** Task lifecycle UI (#814); API values and task status do not depend on these labels. */
export const TASK_LIFECYCLE_COPY = {
  frozen: { ru: "Замороженные", en: "Frozen" },
  marker: { ru: "Заморожена", en: "Frozen" },
  freeze: { ru: "Заморозить", en: "Freeze" },
  unfreeze: { ru: "Разморозить", en: "Unfreeze" },
  failed: { ru: "Не удалось изменить заморозку задачи", en: "Failed to change the task freeze" },
  archived: { ru: "Архивированные", en: "Archived" },
  permanent: { ru: "Удалить навсегда", en: "Delete permanently" },
  confirmPermanent: { ru: "Удалить задачу навсегда?", en: "Delete the task permanently?" },
  cancel: { ru: "Отмена", en: "Cancel" },
  deleteFailed: { ru: "Не удалось удалить задачу навсегда", en: "Failed to delete the task permanently" },
} as const;
