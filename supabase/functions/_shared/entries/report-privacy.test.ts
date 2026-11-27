import { assertEquals } from "jsr:@std/assert@1";
import { reportPrivacyFields } from "./report-privacy.ts";
import { canViewEntry } from "./access.ts";

Deno.test("management reports: source, content, summary and workbook protect notes and attachments", () => {
  for (
    const input of [
      { source: " claude-weekly-tracker " },
      { content: "SWARM-REPORT-SNAPSHOT | fixture" },
      { summary: "SWARM-REPORT-CONTEXT | fixture" },
      { file_name: "swarm_weekly_tracker.xlsx" },
    ]
  ) {
    const row = reportPrivacyFields({ ...input, is_private: false }, 10);
    assertEquals(row, { is_private: true, owner_id: 10 });
    assertEquals(canViewEntry(row, 10), true);
    assertEquals(canViewEntry(row, 11), false);
    assertEquals(canViewEntry(row, null), false);
  }
});

Deno.test("ordinary knowledge retains explicit privacy choice and existing default", () => {
  assertEquals(reportPrivacyFields({ summary: "Shared handbook" }, 10).is_private, false);
  assertEquals(reportPrivacyFields({ is_private: true }, 10).is_private, true);
  assertEquals(reportPrivacyFields({ is_private: false }, 10).is_private, false);
});
