// Real guarded query/DTO verification on the isolated CI database; never an operational calendar call.
import { assert, assertEquals } from "@std/assert";
import { Client } from "postgres";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleMeetingContextRoutes, meetingContextDeps } from "./meeting-context-routes.ts";
import { loadContextCandidates, loadParticipantTasks } from "./meeting-context-store.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const API_URL = Deno.env.get("SUPABASE_URL") ?? "http://127.0.0.1:54321";
const WS = "test-context-876";
const OTHER_WS = "test-context-876-other";
const ACTOR = 900876001;
const ACCOUNT = 900876002;
const OTHER = 900876003;
const actor = { telegramId: ACTOR, groupId: WS, email: "self876@example.invalid" };
const attendees = [{ email: actor.email, self: true }, { email: "account876@example.invalid" }, {
  email: "phantom876@example.invalid",
}];

function localOnly(): SupabaseClient {
  for (const raw of [DB_URL, API_URL]) {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(raw).hostname)) {
      throw new Error("isolated_loopback_fixture_required");
    }
  }
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) throw new Error("isolated_service_key_required");
  return createClient(API_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function cleanup(db: Client) {
  await db.queryArray`delete from tasks where group_id in (${WS},${OTHER_WS})`;
  await db.queryArray`delete from entries where group_id in (${WS},${OTHER_WS})`;
  await db.queryArray`delete from meetings where group_id in (${WS},${OTHER_WS})`;
  await db.queryArray`delete from projects where group_id in (${WS},${OTHER_WS})`;
  await db.queryArray`delete from allowed_users where telegram_id in (${ACTOR},${ACCOUNT},${OTHER})`;
  await db.queryArray`delete from workspaces where id in (${WS},${OTHER_WS})`;
}
async function fixture(run: (db: Client, sb: SupabaseClient) => Promise<void>) {
  const sb = localOnly();
  const db = new Client(DB_URL);
  await db.connect();
  try {
    await cleanup(db);
    await db
      .queryArray`insert into workspaces(id,name) values (${WS},'Fictional context'),(${OTHER_WS},'Fictional other')`;
    await db.queryArray`insert into allowed_users(telegram_id,username,email,added_by,group_id) values
      (${ACTOR},'context-self',${actor.email},0,${WS}),
      (${ACCOUNT},'context-account','account876@example.invalid',0,${WS}),
      (${OTHER},'context-other','other876@example.invalid',0,${OTHER_WS})`;
    await run(db, sb);
  } finally {
    await cleanup(db);
    await db.end();
  }
}
async function entry(
  db: Client,
  label: string,
  extra: { group?: string; confirmed?: boolean; private?: boolean; owner?: number; archived?: boolean; type?: string } =
    {},
) {
  const result = await db.queryObject<
    { id: string }
  >`insert into entries(content,summary,added_by,source,entry_type,entry_date,group_id,is_private,owner_id,metadata)
    values ('synthetic original transcript',${"- Synthetic thesis " + label},'fixture','test',${
    extra.type ?? "meeting"
  },'2026-11-13',${extra.group ?? WS},${extra.private ?? false},${extra.owner ?? ACTOR},
    ${
    JSON.stringify({
      title: label,
      confirmed: extra.confirmed ?? true,
      attendees,
      calendar_event: { scheduled_start_time: "2026-11-13T10:00:00Z" },
    })
  }::jsonb) returning id::text`;
  const id = result.rows[0].id;
  if (extra.archived) await db.queryArray`update entries set archived_at=now() where id=${id}::uuid`;
  return id;
}
Deno.test("meeting context real query reuses published/visible/archive guards and exact participant primary/co-task identities", async () => {
  await fixture(async (db, sb) => {
    const visible = await entry(db, "Visible previous");
    await entry(db, "Hidden", { private: true, owner: ACCOUNT });
    await entry(db, "Foreign", { group: OTHER_WS, owner: OTHER });
    await entry(db, "Unconfirmed", { confirmed: false });
    await entry(db, "Archived", { archived: true });
    await entry(db, "Not a meeting", { type: "note" });
    const scan = await loadContextCandidates(sb, actor, "2026-11-14T10:00:00Z");
    assertEquals(scan.candidates.map((r) => r.id), [visible]);
    assertEquals(scan.truncated, false);
    const person = await db.queryObject<{ id: string }>`insert into people(group_id,display_name,email,source)
      values (${WS},'Fictional Phantom','phantom876@example.invalid','manual')
      on conflict (group_id,email) where email is not null and archived_at is null
      do update set display_name=excluded.display_name returning id::text`;
    const personId = person.rows[0].id;
    const project = await db.queryObject<{ id: string }>`insert into projects(group_id,name,is_private,created_by)
      values (${WS},'Fictional closed project',true,${ACCOUNT}) returning id::text`;
    const closedProject = project.rows[0].id;
    await db.queryArray`insert into tasks(title,status,group_id,confirmed,assignee_telegram_ids) values
      ('account task','open',${WS},true,${[ACCOUNT]}::bigint[]),
      ('closed task','done',${WS},true,${[ACCOUNT]}::bigint[]),
      ('foreign task','open',${OTHER_WS},true,${[ACCOUNT]}::bigint[])`;
    await db
      .queryArray`insert into tasks(title,status,group_id,confirmed,assignee_person_id) values ('phantom task','open',${WS},true,${personId}::uuid)`;
    await db
      .queryArray`insert into tasks(title,status,group_id,confirmed,coassignee_person_ids) values ('co-task','in_progress',${WS},true,${[
      personId,
    ]}::uuid[])`;
    await db.queryArray`insert into tasks(title,status,group_id,confirmed,project_id,assignee_telegram_ids) values
      ('hidden project task','open',${WS},true,${closedProject}::uuid,${[ACCOUNT]}::bigint[])`;
    await db.queryArray`insert into tasks(title,status,group_id,confirmed,archived_at,assignee_telegram_ids) values
      ('archived task','open',${WS},true,now(),${[ACCOUNT]}::bigint[])`;
    const tasks = await loadParticipantTasks(sb, actor, attendees);
    assertEquals(tasks.tasks.map((t) => t.title).sort(), ["account task", "co-task", "phantom task"]);
    assertEquals(tasks.total, 3);
    const request = new Request("https://example.invalid/calendar/today/context?key=synthetic:2026-11-14");
    const response = await handleMeetingContextRoutes(
      { supabase: sb, actor, origin: "https://example.invalid" },
      request,
      "/calendar/today/context",
      {
        ...meetingContextDeps,
        todayCalendarEvents: (_db, caller) => {
          assertEquals(caller, ACTOR);
          return Promise.resolve({
            ok: true,
            events: [{
              id: "synthetic",
              start: { dateTime: "2026-11-14T10:00:00Z" },
              end: { dateTime: "2026-11-14T11:00:00Z" },
              attendees,
            }],
          });
        },
      },
    );
    assertEquals(response?.status, 200);
    const view = await response?.json();
    assertEquals(view.previous.id, visible);
    assertEquals(view.previous.summary, "- Synthetic thesis Visible previous");
    assertEquals(JSON.stringify(view).includes("synthetic original transcript"), false);
    assertEquals(view.tasks.length, 3);
  });
});
Deno.test("meeting context reads beyond a first metadata page and reports a capped task list honestly", async () => {
  await fixture(async (db, sb) => {
    const wanted = await entry(db, "Older matching previous");
    await db.queryArray`insert into entries(content,summary,added_by,source,entry_type,entry_date,group_id,metadata)
      select 'synthetic','- unrelated','fixture','test','meeting','2026-11-13',${WS},
        jsonb_build_object('confirmed',true,'attendees',jsonb_build_array(jsonb_build_object('email','unrelated@example.invalid')))
      from generate_series(1,120)`;
    const scan = await loadContextCandidates(sb, actor, "2026-11-14T10:00:00Z");
    assertEquals(scan.candidates.length, 121);
    assert(scan.candidates.some((r) => r.id === wanted));
    assertEquals(scan.truncated, false);
    await db.queryArray`insert into tasks(title,status,group_id,confirmed,assignee_telegram_ids)
      select 'synthetic task '||i,'open',${WS},true,${[ACCOUNT]}::bigint[] from generate_series(1,101) i`;
    const tasks = await loadParticipantTasks(sb, actor, attendees);
    assertEquals(tasks.tasks.length, 100);
    assertEquals(tasks.total, 101);
    assertEquals(tasks.truncated, true);
  });
});
