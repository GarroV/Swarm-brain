/**
 * Exact display-name hints, never proof of identity or physical presence.
 */
const RECORDER_NAMES = new Set([
  "tl;dv",
  "tl;dv ai notetaker",
  "read.ai",
  "read.ai meeting notes",
  "meeting analytics from read",
  "fireflies",
  "fireflies.ai notetaker",
  "otter",
]);
const OTTER_NOTETAKER = /^.+['’]s (?:AI )?Notetaker \(Otter\.ai\)$/iu;

export function isRecorderName(name: string): boolean {
  return RECORDER_NAMES.has(name.toLowerCase()) || OTTER_NOTETAKER.test(name);
}
