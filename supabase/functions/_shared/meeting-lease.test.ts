import { assert, assertEquals } from "jsr:@std/assert@1";
import { CLAIM_LEASE_TTL_SEC, claimLeaseUntil } from "./meeting-lease.ts";

Deno.test("claimLeaseUntil: отсчитывает TTL от переданного момента", () => {
  const from = new Date("2026-09-09T10:00:00.000Z");
  assertEquals(claimLeaseUntil(from), "2026-09-09T10:30:00.000Z");
});

Deno.test("claimLeaseUntil: без аргумента лиз всегда в БУДУЩЕМ — иначе встреча свободна сразу", () => {
  assert(Date.parse(claimLeaseUntil()) > Date.now());
});

Deno.test("CLAIM_LEASE_TTL_SEC: 30 минут — то же значение, что выдаёт claim", () => {
  assertEquals(CLAIM_LEASE_TTL_SEC, 1800);
});
