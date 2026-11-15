/** Read-only mirror of swarm-api's MeetingContextView (#876). No participant identities in the DTO. */
export type MeetingContextView = {
  meeting: { title: string | null; startsAt: string; countries: string[] };
  previous: { id: string; title: string | null; date: string; summary: string; truncated: boolean } | null;
  previousTruncated: boolean;
  tasks: Array<{ id: string; title: string; dueDate: string | null; status: string }>;
  tasksTotal: number | null;
  tasksTruncated: boolean;
};
