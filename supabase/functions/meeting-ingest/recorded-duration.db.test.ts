// #121: run only against the isolated test database (CI / scripts/with-local-db).
// The real Supabase query must fill NULL/0, preserve a concurrent correction and touch only seconds.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { Client } from "postgres";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { InMemoryPart } from "../_shared/meeting-processor.ts";
import { correctHolderSeconds, measureUpload } from "./challenge-io.ts";
import { holderSecondsCorrection } from "./challenge.ts";
import { m4aOf } from "./m4a-fixture.ts";

Deno.test("#121: measured upload fills missing duration in a real DB without overwriting newer seconds", async () => {
  const apiURL = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiURL || !serviceKey) throw new Error("Test DB API not configured; use scripts/with-local-db");
  const db = new Client(Deno.env.get("SUPABASE_DB_URL") ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres");
  await db.connect();
  const workspace = `test-duration-${crypto.randomUUID()}`;
  const holder = -Math.floor(Math.random() * 1_000_000_000_000) - 1;
  const id = crypto.randomUUID();
  const client = createClient(apiURL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    await db.queryArray("insert into workspaces(id,name) values($1,$2)", [workspace, "duration fixture"]);
    await db.queryArray("insert into allowed_users(telegram_id,added_by,group_id) values($1,0,$2)", [
      holder,
      workspace,
    ]);
    await db.queryArray(
      `insert into meetings(id,source,identity_kind,identity_key,claim_owner,group_id,recorded_seconds)
       values($1::uuid,'desktop-agent','manual',$1::text,$2,$3,null)`,
      [id, holder, workspace],
    );
    const read = async () => {
      const row = (await db.queryObject<{
        recorded_seconds: string | number | null;
        claim_owner: string;
        identity_key: string;
        status: string;
        transcript: unknown;
      }>("select recorded_seconds, claim_owner::text, identity_key, status, transcript from meetings where id=$1", [
        id,
      ])).rows[0];
      // The postgres driver preserves SQL numeric values as strings; the metric is a number.
      return { ...row, recorded_seconds: row.recorded_seconds === null ? null : Number(row.recorded_seconds) };
    };
    const initial = await read();
    const parts = [{ offset: 0, blob: new Blob([m4aOf(3)]) }, { offset: 5, blob: new Blob([m4aOf(2)]) }];
    const measured = await measureUpload(parts as InMemoryPart[]);
    assertEquals(measured, 5);
    for (const previous of [null, 0, 20]) {
      await db.queryArray("update meetings set recorded_seconds=$2 where id=$1", [id, previous]);
      const corrected = holderSecondsCorrection(
        { claim_owner: holder, recorded_seconds: previous, agent_last_seen_at: null },
        holder,
        [],
        measured,
      );
      assertEquals(corrected, 5);
      await correctHolderSeconds(client, id, holder, previous, corrected!);
      assertEquals(await read(), { ...initial, recorded_seconds: 5 });
      // A late upload using the old NULL/0/20 snapshot must not overwrite a newer duration.
      await correctHolderSeconds(client, id, holder, previous, 2);
      assertEquals((await read()).recorded_seconds, 5);
    }
  } finally {
    await db.queryArray("delete from meetings where id=$1", [id]);
    await db.queryArray("delete from allowed_users where telegram_id=$1 and group_id=$2", [holder, workspace]);
    await db.queryArray("delete from workspaces where id=$1", [workspace]);
    await db.end();
  }
});
