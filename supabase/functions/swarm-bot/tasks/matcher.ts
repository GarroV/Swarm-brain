import { supabase } from "../lib/supabase.ts";

export type UserProfile = {
  id: number;
  name: string;
  username: string | null;
  role: string | null;
  markets: string[];
  email: string | null;
  name_aliases: string[];
};

export async function getProfilesForPrompt(): Promise<UserProfile[]> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, role, markets, email, name_aliases");

  return (data ?? []).map((p: {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    role?: string;
    markets?: string[];
    email?: string;
    name_aliases?: string[];
  }) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
    username: p.username ?? null,
    role: p.role ?? null,
    markets: p.markets ?? [],
    email: p.email ?? null,
    name_aliases: p.name_aliases ?? [],
  }));
}

export function buildProfileMap(profiles: UserProfile[]): Record<number, string> {
  return Object.fromEntries(profiles.map(p => [p.id, p.name]));
}

export async function buildDisplayNameMap(telegramIds: number[]): Promise<Record<number, string>> {
  if (!telegramIds.length) return {};
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username")
    .in("telegram_id", telegramIds);
  const map: Record<number, string> = {};
  for (const p of (data ?? []) as Array<{ telegram_id: number; first_name?: string; last_name?: string; username?: string }>) {
    const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || null;
    if (name) map[p.telegram_id] = name;
  }
  return map;
}

export async function getAllUniqueMarkets(): Promise<string[]> {
  const { data } = await supabase.from("user_profiles").select("markets");
  const all = (data ?? []).flatMap((p: { markets?: string[] }) => p.markets ?? []);
  return [...new Set(all)].filter((x): x is string => Boolean(x)).sort();
}

type ExtractedTask = {
  assignee_ids?: number[];
  task_role?: string | null;
  country?: string | null;
};

export function resolveAssignees(
  profiles: UserProfile[],
  extracted: ExtractedTask,
): { assignees: string[]; assignee_telegram_ids: number[] } {
  // 1. Explicit IDs from GPT
  if (extracted.assignee_ids?.length) {
    const matched = profiles.filter(p => extracted.assignee_ids!.includes(p.id));
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  const country = extracted.country?.toLowerCase() ?? null;
  const matchesCountry = (p: UserProfile) =>
    country !== null && p.markets.some(m =>
      m.toLowerCase() === country ||
      m.toLowerCase().includes(country)
    );

  // 2. Role + country
  if (extracted.task_role && country) {
    const matched = profiles.filter(p => p.role === extracted.task_role && matchesCountry(p));
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  // 3. Country only
  if (country) {
    const matched = profiles.filter(matchesCountry);
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  // 4. Role only (no country)
  if (extracted.task_role) {
    const matched = profiles.filter(p => p.role === extracted.task_role);
    if (matched.length) {
      return {
        assignees: matched.map(p => p.name),
        assignee_telegram_ids: matched.map(p => p.id),
      };
    }
  }

  // 5. General pool
  return { assignees: [], assignee_telegram_ids: [] };
}
