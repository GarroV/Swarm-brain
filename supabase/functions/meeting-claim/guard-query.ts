// Условия UPDATE из arbiter.ts (описание Guard) → фильтры PostgREST. Общий переводчик для claim и
// для сверки претендента в meeting-ingest: одна и та же защита перехвата не должна переводиться
// двумя разными кодами.
import type { Guard } from "./arbiter.ts";

// Условия arbiter.ts → фильтры PostgREST той же UPDATE.
interface GuardableQuery<Q> {
  eq(column: string, value: string | number): Q;
  is(column: string, value: null): Q;
  neq(column: string, value: string): Q;
  or(filters: string): Q;
}

function orClause(g: Guard): string {
  switch (g.kind) {
    case "eq":
      return `${g.column}.eq.${g.value}`;
    case "isNull":
      return `${g.column}.is.null`;
    case "neq":
      return `${g.column}.neq.${g.value}`;
    case "notTrue":
      return `${g.column}.is.null,${g.column}.is.false`;
    case "before":
      return `${g.column}.lt.${g.value}`;
    case "anyOf":
      return `or(${g.clauses.map(orClause).join(",")})`;
  }
}

export function withGuards<Q extends GuardableQuery<Q>>(query: Q, guards: Guard[]): Q {
  let q = query;
  for (const g of guards) {
    if (g.kind === "eq") q = q.eq(g.column, g.value);
    else if (g.kind === "isNull") q = q.is(g.column, null);
    else if (g.kind === "neq") q = q.neq(g.column, g.value);
    else q = q.or(g.kind === "anyOf" ? g.clauses.map(orClause).join(",") : orClause(g));
  }
  return q;
}
