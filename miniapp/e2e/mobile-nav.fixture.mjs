// Deterministic browser-only transport. No API request reaches the remote backend.
const installed = new WeakMap();
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export async function installMobileFixture(page) {
  if (installed.has(page)) return installed.get(page);
  if (process.env.SWARM_E2E_HIDE_MENU === "1") {
    await page.evaluateOnNewDocument(() => {
      document.addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent =
          'button[aria-label="Чьи задачи и группировка"] { display: none !important; }';
        document.head.append(style);
      });
    });
  }
  let tasks, taskTemplate, meetings, projects, drafts, nextId;
  const requests = [], unexpected = [];
  const me = {
    telegram_id: 123456,
    name: "Dev User",
    username: "devuser",
    group_id: "fixture",
    language: "ru",
    role: "bd",
    markets: ["RS"],
    is_admin: true,
    is_superadmin: false,
    is_demo: false,
  };
  function reset() {
    const now = new Date().toISOString(), day = now.slice(0, 10);
    nextId = 1000;
    projects = [{
      id: id(100),
      group_id: "fixture",
      name: "Swarm Brain",
      color: null,
      emoji: null,
      parent_id: null,
      position: 1000,
      sprint_id: null,
      created_by: me.telegram_id,
      created_at: now,
      owner_telegram_id: null,
      start_date: null,
      end_date: null,
      is_private: false,
    }];
    tasks = Array.from({ length: 24 }, (_, i) => ({
      id: id(i + 1),
      title: `Тестовая задача ${i + 1}`,
      description: "Текст фикстуры",
      assignees: [me.name],
      assignee_telegram_ids: [me.telegram_id],
      due_date: day,
      remind_date: null,
      reminded_at: null,
      country: "RS",
      task_role: "rnd",
      priority: null,
      status: i === 0 ? "done" : "open",
      created_at: now,
      updated_at: now,
      meeting_id: null,
      created_by_name: me.name,
      created_by_telegram_id: me.telegram_id,
      start_date: null,
      sprint_id: null,
      label_ids: [],
      project_id: i < 8 ? projects[0].id : null,
      project_linked: i < 8,
      parent_id: null,
      tree_x: null,
      tree_y: null,
      recur_freq: null,
      recur_anchor_dom: null,
    }));
    taskTemplate = { ...tasks[1] };
    meetings = Array.from({ length: 12 }, (_, i) => ({
      id: id(200 + i),
      source: "granola",
      entry_type: "meeting",
      content: "Синтетическая стенограмма",
      summary: "### Тезисы\n- Решение фикстуры",
      countries: ["RS"],
      entry_date: day,
      created_at: now,
      is_private: false,
      added_by: "fixture",
      metadata: {
        title: i === 0 ? "Q3 Kickoff" : `Встреча ${i + 1}`,
        confirmed: i > 3,
      },
    }));
    drafts = [{
      id: id(300),
      title: "Синк по Болгарии",
      source: "desktop-agent",
      recorded_by: "bot",
      identity_kind: "manual",
      started_at: day + "T10:00:00Z",
      ended_at: day + "T10:45:00Z",
      status: "awaiting_review",
      summary_status: "done",
      has_draft_notes: true,
      draft_notes_md: "### Тезисы\n- Решение фикстуры",
      transcript: {
        language: "ru",
        segments: [{ start: 0, end: 5, text: "Синтетический разговор" }],
      },
      recorders: [{
        telegram_id: me.telegram_id,
        role: "transcribe",
        claimed_at: now,
      }],
      recorder_names: [me.name],
      created_at: now,
      updated_at: now,
      recording_now: false,
      entry_id: null,
    }];
  }
  reset();
  const fixture = {
    requests,
    unexpected,
    reset,
    snapshot: () => ({ tasks, meetings, projects, drafts }),
  };
  installed.set(page, fixture);
  await page.setBypassServiceWorker(true);
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = new URL(req.url()), p = url.pathname, method = req.method();
    if (req.isNavigationRequest() && req.frame() === page.mainFrame()) reset();
    if (!p.startsWith("/api/")) {
      if (
        method === "GET" &&
        !["fetch", "xhr", "eventsource", "websocket"].includes(
          req.resourceType(),
        )
      ) return req.continue();
      unexpected.push(`${method} ${p}`);
      return req.respond({
        status: 501,
        contentType: "application/json",
        body: '{"error":"Fixture blocks non-API writes"}',
      });
    }
    let data, headers = {}, status = 200;
    let body = {};
    try {
      body = req.postData() ? JSON.parse(req.postData()) : {};
    } catch {
      unexpected.push(`${method} ${p} (non-JSON body)`);
      return req.respond({
        status: 501,
        contentType: "application/json",
        body: '{"error":"Unhandled fixture payload"}',
      });
    }
    requests.push({ method, path: p, query: url.search, body });
    const knownWrite = (method === "POST" &&
      ["/api/tasks", "/api/ask", "/api/presence"].includes(p)) ||
      (method === "PATCH" && /^\/api\/tasks\/[^/]+$/.test(p));
    if (method !== "GET" && !knownWrite) {
      unexpected.push(`${method} ${p}`);
      return req.respond({
        status: 501,
        contentType: "application/json",
        body: '{"error":"Unhandled fixture mutation"}',
      });
    }
    if (p === "/api/me") data = me;
    else if (p === "/api/config") {
      data = { workspace_name: "Fixture", allowed_markets: ["RS"] };
    } else if (p === "/api/notifications") {
      data = { items: [], unread: 0, notice: null };
    } else if (p === "/api/demo/questions") data = { questions: [] };
    else if (p === "/api/maintenance") data = null;
    else if (p === "/api/presence/strip") data = { window: 0, people: [] };
    else if (p === "/api/presence") data = { ok: true };
    else if (p === "/api/tasks" && method === "GET") {
      data = url.searchParams.has("since")
        ? { tasks, serverTime: new Date().toISOString(), truncated: false }
        : tasks;
    } else if (p === "/api/tasks" && method === "POST") {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const day = [
        tomorrow.getFullYear(),
        String(tomorrow.getMonth() + 1).padStart(2, "0"),
        String(tomorrow.getDate()).padStart(2, "0"),
      ].join("-");
      data = {
        ...taskTemplate,
        id: id(nextId++),
        title: body.title,
        description: body.description ?? "",
        due_date: body.due_date ?? day,
        project_id: body.project_id ?? null,
        project_linked: false,
        assignees: [],
        assignee_telegram_ids: body.assignee_telegram_id
          ? [body.assignee_telegram_id]
          : [],
        ...body,
      };
      tasks = [data, ...tasks];
    } else if (/^\/api\/tasks\/[^/]+$/.test(p) && method === "GET") {
      data = tasks.find((t) => t.id === p.split("/").at(-1));
    } else if (/^\/api\/tasks\/[^/]+$/.test(p) && method === "PATCH") {
      tasks = tasks.map((t) =>
        t.id === p.split("/").at(-1)
          ? { ...t, ...body, updated_at: new Date().toISOString() }
          : t
      );
      data = tasks.find((t) => t.id === p.split("/").at(-1));
    } else if (p === "/api/projects") data = projects;
    else if (p === "/api/people") {
      data = [{
        id: id(500),
        group_id: "fixture",
        name: me.name,
        telegram_id: me.telegram_id,
        is_active: true,
      }];
    } else if (p === "/api/users") data = [me];
    else if (p === "/api/meetings") {
      const confirmed = url.searchParams.get("confirmed");
      data = meetings.filter((m) =>
        confirmed === null || m.metadata.confirmed === (confirmed === "true")
      );
      headers = {
        "X-Total-Count": String(data.length),
        "X-Unfiltered-Count": String(data.length),
      };
    } else if (/^\/api\/meetings\/[^/]+$/.test(p)) {
      data = meetings.find((m) => m.id === p.split("/").at(-1));
    } else if (p === "/api/agent-meetings") data = drafts;
    else if (/^\/api\/agent-meetings\/[^/]+$/.test(p)) {
      data = drafts.find((m) => m.id === p.split("/").at(-1));
    } else if (
      /\/(agent-meetings|meetings)\/[^/]+\/market-suggestion$/.test(p)
    ) data = { markets: [], source: null };
    else if (/\/meetings\/[^/]+\/notes$/.test(p)) {
      data = { versions: 0, live: [], personal: [] };
    } else if (/\/agent-meetings\/[^/]+\/notes$/.test(p)) data = [];
    else if (p === "/api/ask" && method === "POST") {
      data = {
        query: body.q,
        answer: `Сербия: синтетический ответ на «${body.q}».`,
        sources: [],
        followups: [],
      };
    } else if (p === "/api/search/quick") {
      data = { tasks: [], projects: [], meetings: [], notes: [] };
    } else if (p === "/api/entries" || p === "/api/search") data = [];
    else if (p === "/api/calendar/today") {
      data = { meetings: [], connected: false };
    } else if (p === "/api/market/sales") data = { sales: {}, denied: [] };
    else if (p === "/api/quality") {
      data = { kind: url.searchParams.get("kind"), periods: [], units: [] };
    } else if (p === "/api/quality/maps") {
      data = {
        on: new Date().toISOString().slice(0, 10),
        compare: null,
        countries: [],
        units: [],
        loaded_at: null,
      };
    } else if (
      [
        "/api/task-labels",
        "/api/stickers",
        "/api/sprints",
        "/api/integrations",
        "/api/granola/notes",
      ].includes(p)
    ) data = [];
    else if (
      ["/api/recorder/setup", "/api/mcp/setup", "/api/mcp/desktop/setup"]
        .includes(p)
    ) data = { active: false, expiresAt: null, lastSeenAt: null };
    else if (p === "/api/mcp/connections") {
      data = { mcpUrl: "https://fixture.invalid/mcp", connections: [] };
    } else if (p === "/api/admin/ai-health") data = { issues: [], stalled: [] };
    else if (p === "/api/mcp/instructions") {
      data = { instructions: "Fixture instructions" };
    } else if (p === "/api/scriba/autojoin") data = { enabled: false };
    else if (p === "/api/meetings/record/active") data = { recording: null };
    else if (/\/tasks\/[^/]+\/(comments|subtasks)$/.test(p)) data = [];
    else if (/\/tasks\/[^/]+\/subscription$/.test(p)) {
      data = { subscribed: false };
    } else if (/\/tasks\/[^/]+\/files$/.test(p)) {
      data = {
        files: [],
        limits: { maxBytes: 10485760, maxFiles: 10, accept: [".pdf"] },
        available: false,
      };
    } else {
      unexpected.push(`${method} ${p}`);
      status = 501;
      data = { error: "Unhandled synthetic API route" };
    }
    if (data === undefined) {
      status = 404;
      data = { error: "Unknown fixture record" };
    }
    return req.respond({
      status,
      headers,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  });
  return fixture;
}
