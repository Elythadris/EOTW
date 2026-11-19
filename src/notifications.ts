import { useEffect, useRef } from "react";
import type { Feed, Preferences } from "./types";
import { signalChanges, type SignalLedger } from "./signal-changes";

const prefix = "eotw.signal-notices.v1.";
let volatile: { scope: string; ledger: SignalLedger } | null = null;

async function preferenceScope(prefs: Preferences) {
  const encoded = new TextEncoder().encode(JSON.stringify([
    prefs.location.trim().toLowerCase(), [...prefs.topics].sort(), [...prefs.saved].sort(),
  ]));
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(bytes.subarray(0, 12), byte => byte.toString(16).padStart(2, "0")).join("");
}
function readLedger(scope: string): SignalLedger | null {
  try {
    const record = JSON.parse(localStorage.getItem(prefix + "latest") || "null");
    if (record?.scope === scope && record.ledger?.seen && Number.isFinite(record.ledger.scan)) return record.ledger;
  } catch { /* Memory also supports private browsers with storage disabled. */ }
  return volatile?.scope === scope ? volatile.ledger : null;
}

export function useSignalNotifications(
  signals: Feed | null, prefs: Preferences, onMessage: (text: string) => void, onOpen: (id: string) => void,
) {
  const callbacks = useRef({ onMessage, onOpen });
  useEffect(() => { callbacks.current = { onMessage, onOpen }; }, [onMessage, onOpen]);
  useEffect(() => {
    if (!prefs.notifications || !signals?.intelligence) return;
    let active = true;
    const process = async () => {
      const scope = await preferenceScope(prefs);
      const check = () => {
        if (!active) return;
        const delta = signalChanges(signals, prefs, readLedger(scope), Date.now());
        if (!delta) return;
        volatile = {scope, ledger: delta.ledger};
        try { localStorage.setItem(prefix + "latest", JSON.stringify(volatile)); } catch { /* Volatile deduplication is sufficient here. */ }
        if (!delta.changes.length) return;
        const {event, increased} = delta.changes[0];
        const heading = increased ? "Risk increased" : "New priority signal";
        const more = delta.changes.length - 1;
        const body = event.title + (more ? " (+" + more + " other " + (more === 1 ? "signal" : "signals") + ")" : "");
        callbacks.current.onMessage(heading + " · " + body);
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        try {
          const notice = new Notification("EOTW · " + heading, {body, tag: event.intelligence?.incidentKey || event.id});
          notice.onclick = () => { window.focus(); callbacks.current.onOpen(event.id); notice.close(); };
        } catch { /* The in-app notification has already been delivered. */ }
      };
      // Only one open reader should announce a scan.
      if (navigator.locks) await navigator.locks.request(prefix + "delivery", check);
      else check();
    };
    void process().catch(() => { /* Notification APIs and storage may be disabled by the browser. */ });
    return () => { active = false; };
  }, [signals, prefs.notifications, prefs.location, prefs.saved, prefs.topics]);
}
