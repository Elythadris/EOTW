import test from "node:test";
import assert from "node:assert/strict";
import { signalChanges } from "../src/signal-changes.ts";

const start = Date.parse("2026-01-16T12:00:00Z");
const iso = value => new Date(value).toISOString();
const prefs = {location:"Maui", saved:[], topics:[], notifications:true};
const event = (id, level="elevated", changeKey="initial") => ({
  id, scope:"local", category:"Weather", status:"confirmed", title:"Test warning", location:"Maui",
  intelligence:{level, changeKey, incidentKey:"episode-"+id, category:"Weather", score:70},
});
const feed = (scan, events, escalations=[]) => ({events, intelligence:{lastScan:iso(scan), escalations}});

test("initial or stale observations are silent; a fresh relevant incident can notify once", () => {
  const first = signalChanges(feed(start,[event("a")]),prefs,null,start);
  assert.equal(first.changes.length,0);
  const nextScan = start+300000;
  const next = signalChanges(feed(nextScan,[event("a"),event("b")]),prefs,first.ledger,nextScan);
  assert.deepEqual(next.changes.map(x=>x.event.id),["b"]);
  assert.equal(signalChanges(feed(nextScan,[event("b")]),prefs,next.ledger,nextScan),null);
  assert.equal(signalChanges(feed(start,[]),prefs,null,start+3600000),null);
});
test("a changed article identifier and minor edit do not repeat a warning; a documented increase does", () => {
  const first=signalChanges(feed(start,[event("a")]),prefs,null,start);
  const alias={...event("a"),id:"new-cap-message",updatedAt:iso(start+300000)};
  const next=signalChanges(feed(start+300000,[alias]),prefs,first.ledger,start+300000);
  assert.equal(next.changes.length,0);
  const raised={...alias,intelligence:{...alias.intelligence,changeKey:"higher-impact"}};
  const at=start+600000;
  const change=signalChanges(feed(at,[raised],[{eventId:raised.id,at:iso(at)}]),prefs,next.ledger,at);
  assert.equal(change.changes[0].increased,true);
});
test("expired, speculative and unrelated signals do not send notifications", () => {
  const base=signalChanges(feed(start,[]),prefs,null,start);
  const at=start+300000;
  const rows=[{...event("a"),expiresAt:iso(at-1)},{...event("b"),status:"speculation"},{...event("c"),scope:"global"}];
  assert.equal(signalChanges(feed(at,rows),prefs,base.ledger,at).changes.length,0);
  assert.equal(signalChanges(feed(at,rows),{...prefs,topics:["weather"]},base.ledger,at).changes.length,1);
});
