import { assertEquals, assertExists } from "@std/assert";
import { Client } from "postgres";
import { archiveSprintResponse } from "./sprint-archive-route.ts";

const WS = "t_board_archive_20261123";
const OTHER = "t_board_archive_other_20261123";
const MEMBER = 914112301;
const OWNER = 914112302;
const URL = Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

async function clean(db: Client) {
  for (const ws of [WS, OTHER]) {
    await db.queryArray`delete from tasks where group_id=${ws}`;
    await db.queryArray`delete from projects where group_id=${ws}`;
    await db.queryArray`delete from sprints where group_id=${ws}`;
    await db.queryArray`delete from allowed_users where group_id=${ws}`;
    await db.queryArray`delete from workspaces where id=${ws}`;
  }
}

Deno.test("member archives a board tab with contents preserved; space and foreign workspace remain protected", async () => {
  const db = new Client(URL);
  await db.connect();
  try {
    await clean(db);
    for (const ws of [WS, OTHER]) {
      await db.queryArray`insert into workspaces(id,name) values(${ws},${ws})`;
    }
    for (const id of [MEMBER, OWNER]) {
      await db.queryArray`insert into allowed_users(telegram_id,username,added_by,group_id,is_admin)
        values(${id},${"archive-test-" + id},0,${WS},false)`;
    }
    const tab = await db.queryObject<{ id: string }>`insert into sprints(group_id,name,start_date,end_date,kind)
      values(${WS},'Member archive test',current_date,current_date,'board_tab') returning id`;
    const tabId = tab.rows[0].id;
    const p = await db.queryObject<{ id: string }>`insert into projects(group_id,name,sprint_id,created_by)
      values(${WS},'Preserved project',${tabId},${OWNER}) returning id`;
    const projectId = p.rows[0].id;
    const t = await db.queryObject<
      { id: string }
    >`insert into tasks(group_id,title,status,project_id,project_linked,sprint_id,confirmed)
      values(${WS},'Preserved task','open',${projectId},true,${tabId},true) returning id`;
    const result = await archiveSprintResponse(tabId, WS, MEMBER, false, "https://test.invalid");
    assertEquals(result.status, 204, "ordinary member must be able to archive a board tab");
    const row = await db.queryObject<
      { archived_at: string | null; archived_by: number }
    >`select archived_at,archived_by from sprints where id=${tabId}`;
    assertExists(row.rows[0].archived_at);
    assertEquals(Number(row.rows[0].archived_by), MEMBER);
    const preserved = await db.queryObject<
      { project_id: string; project_linked: boolean; sprint_id: string }
    >`select project_id,project_linked,sprint_id from tasks where id=${t.rows[0].id}`;
    assertEquals(preserved.rows[0], { project_id: projectId, project_linked: true, sprint_id: tabId });
    const project = await db.queryObject<{ sprint_id: string }>`select sprint_id from projects where id=${projectId}`;
    assertEquals(project.rows[0].sprint_id, tabId);
    assertEquals((await archiveSprintResponse(tabId, WS, MEMBER, false, "")).status, 404);
    const space = await db.queryObject<{ id: string }>`insert into sprints(group_id,name,start_date,end_date,kind)
      values(${WS},'Sprint space',current_date,current_date,'space') returning id`;
    assertEquals((await archiveSprintResponse(space.rows[0].id, WS, MEMBER, false, "")).status, 403);
    assertEquals((await archiveSprintResponse(space.rows[0].id, OTHER, MEMBER, false, "")).status, 404);
    const stillLive = await db.queryObject<{ archived_at: string | null }>`select archived_at from sprints where id=${
      space.rows[0].id
    }`;
    assertEquals(stillLive.rows[0].archived_at, null);
    assertEquals((await archiveSprintResponse(space.rows[0].id, WS, OWNER, true, "")).status, 204);
  } finally {
    await clean(db);
    await db.end();
  }
});
