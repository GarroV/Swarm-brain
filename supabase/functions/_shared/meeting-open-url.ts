/** Browser entry only. Keep the original join_url for bot grants and room identity. */
export function meetingOpenUrl(raw: string | null, workEmail: string | null | undefined): string | null {
  if (!raw) return null;
  let destination: URL;
  try {
    destination = new URL(raw);
  } catch {
    return null;
  }
  if (destination.protocol !== "https:" || destination.username || destination.password) return null;
  if (destination.hostname !== "meet.google.com") return raw;
  const email = workEmail?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)) return null;
  // Account indices from invitations must not override the employee's known account.
  destination.searchParams.delete("authuser");
  destination.searchParams.delete("login_hint");
  const chooser = new URL("https://accounts.google.com/AccountChooser");
  chooser.searchParams.set("Email", email);
  chooser.searchParams.set("continue", destination.toString());
  return chooser.toString();
}
