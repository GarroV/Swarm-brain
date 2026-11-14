import type { Task } from "@/types";

type Requester = <T>(path: string, init?: RequestInit) => Promise<T>;
type DemoTasks = { get: () => Task[]; set: (tasks: Task[]) => void };

/** Existing archive routes and independent task freeze; the API owns timestamps and actor. */
export function createTaskLifecycleApi(request: Requester, demo?: DemoTasks) {
  let archived: Task[] = [];
  return {
    async deleteTask(id: string): Promise<void> {
      if (!demo) return request<void>(`/tasks/${id}`, { method: "DELETE" });
      const task = demo.get().find((t) => t.id === id);
      if (task) archived = [{ ...task, archived_at: new Date().toISOString() }, ...archived];
      demo.set(demo.get().filter((t) => t.id !== id));
    },
    async fetchArchivedTasks(): Promise<Task[]> {
      return demo ? [...archived] : request<Task[]>("/tasks/archived");
    },
    async restoreTask(id: string): Promise<void> {
      if (!demo) return request<void>(`/tasks/${id}/restore`, { method: "POST" });
      const task = archived.find((t) => t.id === id);
      if (task) demo.set([...demo.get(), { ...task, archived_at: null }]);
      archived = archived.filter((t) => t.id !== id);
    },
    async setTaskFrozen(id: string, frozen: boolean): Promise<Task> {
      if (!demo) return request<Task>(`/tasks/${id}/freeze`, { method: "POST", body: JSON.stringify({ frozen }) });
      const task = demo.get().find((t) => t.id === id);
      if (!task) throw new Error("Task not found");
      const next = { ...task, frozen_at: frozen ? task.frozen_at ?? new Date().toISOString() : null, frozen_by: null };
      demo.set(demo.get().map((t) => t.id === id ? next : t));
      return next;
    },
    async permanentlyDeleteTask(id: string): Promise<void> {
      if (!demo) return request<void>(`/tasks/${id}/permanent`, { method: "DELETE" });
      if (!archived.some((t) => t.id === id)) throw new Error("Archived task not found");
      archived = archived.filter((t) => t.id !== id);
    },
  };
}
