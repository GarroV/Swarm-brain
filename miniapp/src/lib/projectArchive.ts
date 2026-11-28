/** Match server archive: remove the project and its subprojects from the live list.
 * Task links remain unchanged so restoring the project also restores its composition. */
export function archiveProjectPreview<
  T extends { id: string; parent_id: string | null },
>(projects: T[], id: string): T[] {
  return projects.filter((project) =>
    project.id !== id && project.parent_id !== id
  );
}
