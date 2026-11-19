import type { Feed, IntelEvent, Preferences } from "./types";

export type SignalLedger = {
  scan: number;
  seen: Record<string, { key: string; level: number; at: number }>;
};
const levels = { watch: 1, elevated: 2, high: 3 };
const minute = 60_000;

export function signalChanges(feed: Feed, prefs: Preferences, previous: SignalLedger | null, now: number) {
  const scan = Date.parse(feed.intelligence?.lastScan || feed.updatedAt || "");
  if (!feed.intelligence || !Number.isFinite(scan) || scan > now + minute || now - scan > 20 * minute || (previous && scan <= previous.scan)) return null;
  const baseline = !previous || scan - previous.scan > 60 * minute;
  const seen: SignalLedger["seen"] = Object.create(null);
  for (const [id, row] of Object.entries(previous?.seen || {})) {
    if (Number.isFinite(row?.at) && scan - row.at < 7 * 24 * 60 * minute) seen[id] = row;
  }
  const escalated = new Set(feed.intelligence.escalations
    .filter(e => Date.parse(e.at) > (previous?.scan ?? scan) && Date.parse(e.at) <= scan + minute)
    .map(e => e.eventId));
  const changes: { event: IntelEvent; increased: boolean }[] = [];
  for (const event of feed.events) {
    const info = event.intelligence;
    if (!info || !info.changeKey || !(info.level in levels)) continue;
    const id = info.incidentKey || event.id;
    const old = seen[id];
    const level = levels[info.level];
    seen[id] = { key: info.changeKey, level, at: scan };
    if (baseline || level < 2 || event.status === "speculation") continue;
    if (event.expiresAt && Date.parse(event.expiresAt) <= now) continue;
    const increased = !!old && (level > old.level || (old.key !== info.changeKey && escalated.has(event.id)));
    if (old && !increased) continue;
    const subject = [event.title, event.category, info.category, event.location].join(" ").toLowerCase();
    if (event.scope === "local" || prefs.saved.includes(event.id) ||
        prefs.topics.some(topic => topic.trim() && subject.includes(topic.trim().toLowerCase()))) {
      changes.push({ event, increased });
    }
  }
  changes.sort((a, b) => Number(b.event.scope === "local") - Number(a.event.scope === "local")
    || (b.event.intelligence?.score || 0) - (a.event.intelligence?.score || 0));
  const newest = Object.entries(seen).sort((a, b) => b[1].at - a[1].at).slice(0, 600);
  return { ledger: {scan, seen: Object.fromEntries(newest)}, changes };
}
