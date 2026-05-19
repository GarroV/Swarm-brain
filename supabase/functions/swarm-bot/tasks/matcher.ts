import { supabase } from "../lib/supabase.ts";

export type UserProfile = {
  id: number;
  name: string;
  username: string | null;
  role: string | null;
  markets: string[];
};

export async function getProfilesForPrompt(): Promise<UserProfile[]> {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, last_name, username, role, markets");

  return (data ?? []).map((p: {
    telegram_id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    role?: string;
    markets?: string[];
  }) => ({
    id: p.telegram_id,
    name: [p.first_name, p.last_name].filter(Boolean).join(" ") || p.username || String(p.telegram_id),
    username: p.username ?? null,
    role: p.role ?? null,
    markets: p.markets ?? [],
  }));
}

export function buildProfileMap(profiles: UserProfile[]): Record<number, string> {
  return Object.fromEntries(profiles.map(p => [p.id, p.name]));
}

export async function getAllUniqueMarkets(): Promise<string[]> {
  const { data } = await supabase.from("user_profiles").select("markets");
  const all = (data ?? []).flatMap((p: { markets?: string[] }) => p.markets ?? []);
  return [...new Set(all)].filter(Boolean).sort();
}
