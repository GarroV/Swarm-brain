import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  entrySourceLabel,
  meetingSourceKey,
  meetingSourceLabel,
  normalizeSourceFilterKeys,
  recorderSourceLabel,
  sourceKeyLabel,
} from "./sourceLabels.ts";

const ru = (r: string, _e: string) => r;
const en = (_r: string, e: string) => e;

Deno.test("meeting sources retain labels in both locales, independently of filter keys", () => {
  for (
    const [source, key, label] of [
      ["granola", "granola", "Granola"],
      ["read_ai", "read_ai", "Read.ai"],
      ["web-recorder", "web-recorder", "Swarm Brain"],
      ["desktop-agent", "bumblebee", "bumblebee"],
      ["swarm-recorder", "bumblebee", "bumblebee"],
    ]
  ) {
    assertEquals(meetingSourceKey({ source }), key);
    assertEquals(meetingSourceLabel({ source }, ru), label);
    assertEquals(meetingSourceLabel({ source }, en), label);
  }
  assertEquals(meetingSourceLabel({ source: "future-import" }, ru), "Встреча");
  assertEquals(meetingSourceLabel({ source: "future-import" }, en), "Meeting");
  assertEquals(meetingSourceKey({ source: "future-import" }), "meeting");
});

Deno.test("recorded_by, metadata and legacy agent_version keep their precedence", () => {
  const draft = { source: "desktop-agent", agent_version: "scriba-42" };
  assertEquals(meetingSourceKey(draft), "scriba");
  assertEquals(
    meetingSourceKey({ ...draft, metadata: { recorded_by: "recorder" } }),
    "bumblebee",
  );
  assertEquals(
    meetingSourceKey({
      ...draft,
      recorded_by: "bot",
      metadata: { recorded_by: "recorder" },
    }),
    "scriba",
  );
  assertEquals(
    entrySourceLabel({
      source: "desktop-agent",
      metadata: { recorded_by: "bot" },
    }, en),
    "scriba",
  );
  assertEquals(recorderSourceLabel({ source: "unknown" }, en), "bumblebee");
});

Deno.test("non-meeting records keep provenance and unknown source ids", () => {
  assertEquals(entrySourceLabel({ source: "note" }, ru), "Заметка");
  assertEquals(entrySourceLabel({ source: "note" }, en), "Note");
  for (const source of ["custom-import", "__proto__", "constructor"]) {
    assertEquals(entrySourceLabel({ source }, en), source);
  }
  assertEquals(entrySourceLabel({ source: "" }, en), "—");
  assertEquals(sourceKeyLabel("meeting", en), "Meeting");
});

Deno.test("existing filter labels migrate once and stable source keys survive either locale", () => {
  const keys = [
    "granola",
    "read_ai",
    "web-recorder",
    "bumblebee",
    "scriba",
    "meeting",
  ];
  assertEquals(
    normalizeSourceFilterKeys(keys.map((key) => sourceKeyLabel(key, ru))),
    keys,
  );
  assertEquals(
    normalizeSourceFilterKeys(keys.map((key) => sourceKeyLabel(key, en))),
    keys,
  );
  assertEquals(
    normalizeSourceFilterKeys([...keys, "future-source", "Granola"]),
    [...keys, "future-source"],
  );
});
