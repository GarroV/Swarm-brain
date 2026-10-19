// Какие входы админки видит человек (#233, решение владельца 19.10.2026). Права на самом деле
// решает сервер (403/404), это — чтобы экран не показывал кнопки, которые не сработают, и чтобы
// правило было в одном месте под тестом.
//   • раздел мастер-админа (все пространства, роли мастера, расход системы) — только мастер-админ;
//   • пространства заводит и админов назначает только мастер-админ;
//   • баннер сбоя ключа — админ пространства и мастер-админ (участнику и демо — нет).
export type AdminViewer = { is_admin?: boolean; is_superadmin?: boolean; is_demo?: boolean };

export const canSeeMasterSection = (me: AdminViewer | null | undefined): boolean => !!me?.is_superadmin;
export const canCreateWorkspace = canSeeMasterSection;
export const canSetWorkspaceAdmin = canSeeMasterSection;
export const canSeeKeyHealth = (me: AdminViewer | null | undefined): boolean =>
  !!me && !me.is_demo && (!!me.is_admin || !!me.is_superadmin);
