export type Scope = "all" | "local" | "us" | "global";
export type Page =
  | "briefing"
  | "map"
  | "trending"
  | "rabbit"
  | "investigate"
  | "watchlist"
  | "archive"
  | "health"
  | "story";
export type EditorialType = "original" | "investigation" | "prediction" | "correction";

export interface IntelEvent {
  editorialType?: EditorialType;
  supersedes?: { name: string; url: string };
  id: string;
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: string;
  updatedAt: string;
  category: string;
  scope: Exclude<Scope, "all">;
  location: string;
  lat: number | null;
  lon: number | null;
  status: "confirmed" | "developing" | "speculation";
  coordinatePrecision?:
    | "source-point"
    | "source-boundary"
    | "country"
    | "region";
  mapNote?: string;
  expiresAt?: string | null;
  severityReason?: string;
  severity: "high" | "moderate" | "routine";
  sources: { name: string; url: string }[];
  timeline: { at: string; text: string }[];
  rank: number;
  rankReasons: string[];
}
export interface SourceHealth {
  id: string;
  name: string;
  status: "ok" | "error" | "disabled" | "pending";
  lastSuccess: string | null;
  detail?: string;
  intervalMinutes?: number;
}
export interface Feed {
  events: IntelEvent[];
  health: SourceHealth[];
  updatedAt: string | null;
  nextCursor?: string | null;
}
export interface Message {
  role: "user" | "assistant";
  text: string;
}
export interface Preferences {
  saved: string[];
  topics: string[];
  location: string;
  notifications: boolean;
  history: Message[];
}
export interface Citation {
  id: string;
  title: string;
  url: string;
}
export const emptyFeed: Feed = { events: [], health: [], updatedAt: null };
export function sourceURL(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
export function dateTime(value: string | null | undefined) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms)
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(ms)
    : "Time unavailable";
}
export function relative(value: string | null) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "Awaiting update";
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60000));
  if (mins < 1) return "Just now";
  if (mins < 60) return mins + "m ago";
  if (mins < 1440) return Math.floor(mins / 60) + "h ago";
  if (mins < 10080) return Math.floor(mins / 1440) + "d ago";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(ms);
}
export function messageText(message: Message): {
  body: string;
  citations: Citation[];
  mode?: string;
} {
  if (message.role === "assistant") {
    try {
      const obj = JSON.parse(message.text);
      if (typeof obj.body === "string" && Array.isArray(obj.citations))
        return obj;
    } catch {
      /* Older histories contain plain text. */
    }
  }
  return { body: message.text, citations: [] };
}
export function activePriority(e: IntelEvent) {
  if (e.severity !== "high") return false;
  const end = Date.parse(e.expiresAt || "");
  if (Number.isFinite(end)) return end > Date.now();
  const latest = Date.parse(e.updatedAt);
  return Number.isFinite(latest) && Date.now() - latest < 86400000;
}
