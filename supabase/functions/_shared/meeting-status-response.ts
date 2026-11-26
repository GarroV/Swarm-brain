/** Missing and inaccessible meetings have the same response: never disclose another owner's status. */
export function meetingStatusResponse<T extends { id: string }>(requested: string[], visible: T[]) {
  const found = new Set(visible.map((row) => row.id));
  return {
    ok: true,
    statuses: visible,
    unavailable_ids: [...new Set(requested)].filter((id) => !found.has(id)),
  };
}
