// Условия перехвата → фильтры PostgREST (общий переводчик claim и meeting-ingest). Ядро прав: условие,
// переведённое неверно, пропускает перехват по устаревшему чтению молча — UPDATE просто ляжет.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { Guard } from "./arbiter.ts";
import { withGuards } from "./guard-query.ts";

class Recorder {
  readonly filters: string[] = [];
  eq(column: string, value: string | number): Recorder {
    this.filters.push(`${column}=eq.${value}`);
    return this;
  }
  is(column: string, _value: null): Recorder {
    this.filters.push(`${column}=is.null`);
    return this;
  }
  or(filters: string): Recorder {
    this.filters.push(`or(${filters})`);
    return this;
  }
}

Deno.test("ЯДРО: каждое условие — свой фильтр той же UPDATE, вложенное «или» не теряется", () => {
  const guards: Guard[] = [
    { kind: "eq", column: "claim_owner", value: 7 },
    { kind: "isNull", column: "recorded_seconds" },
    { kind: "notTrue", column: "agent_last_recording" },
    { kind: "before", column: "lease_expires_at", value: "2026-09-28T12:00:00Z" },
    {
      kind: "anyOf",
      clauses: [
        { kind: "eq", column: "status", value: "draft" },
        { kind: "anyOf", clauses: [{ kind: "isNull", column: "a" }, { kind: "before", column: "b", value: "x" }] },
      ],
    },
  ];
  assertEquals(withGuards(new Recorder(), guards).filters, [
    "claim_owner=eq.7",
    "recorded_seconds=is.null",
    "or(agent_last_recording.is.null,agent_last_recording.is.false)",
    "or(lease_expires_at.lt.2026-09-28T12:00:00Z)",
    "or(status.eq.draft,or(a.is.null,b.lt.x))",
  ]);
});

Deno.test("без условий запрос не меняется", () => {
  assertEquals(withGuards(new Recorder(), []).filters, []);
});
