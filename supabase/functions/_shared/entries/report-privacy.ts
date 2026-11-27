/** Recognised management reports always use existing private-entry access rules. */
export function reportPrivacyFields(
  input: { source?: string; content?: string; summary?: string; file_name?: string; is_private?: boolean },
  ownerId: number,
): { is_private: boolean; owner_id: number } {
  const report = input.source?.trim().toLowerCase() === "claude-weekly-tracker" ||
    /SWARM-REPORT-(SNAPSHOT|CONTEXT)/i.test(`${input.content ?? ""}\n${input.summary ?? ""}`) ||
    /^swarm_weekly_tracker(?:[._-]|$)/i.test(input.file_name ?? "");
  return { is_private: report || input.is_private === true, owner_id: ownerId };
}
