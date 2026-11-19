// All outbound citation links originate in normalized reporting or published editorial evidence.
const clean = (value, limit) => String(value || "").trim().slice(0, limit);

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
        /(^|\.)(reddit\.com|redd\.it)$/i.test(url.hostname)) return null;
    return url.href;
  } catch { return null; }
}

export function sourceCandidate(event) {
  return Boolean(event?.id && event.title && !/reddit/i.test(event.source) && publicUrl(event.url));
}

export function reportRecord(event) {
  const signal = event.intelligence;
  return {
    eventId: event.id, title: clean(event.title, 250), url: publicUrl(event.url),
    source: clean(event.source, 100), publishedAt: event.publishedAt, updatedAt: event.updatedAt,
    location: clean(event.location, 100), scope: event.scope || "global", status: event.status, category: clean(event.category, 60),
    excerpt: clean(event.summary, 800), kind: event.editorialType || "publisher record",
    expiresAt: event.expiresAt || null,
    timeline: (event.timeline || []).slice(-3).map(item => ({ at: item.at, text: clean(item.text, 180) })),
    signal: signal ? {
      level: clean(signal.level, 40), category: clean(signal.category, 70),
      why: clean(signal.why, 260), monitor: clean(signal.monitor, 240),
      reasons: (signal.reasons || []).slice(0, 3).map(reason => clean(reason, 140)),
    } : null,
    supersedes: event.editorialType === "correction" && publicUrl(event.supersedes?.url)
      ? clean(event.supersedes.name, 100) : null,
  };
}

function editorialRecords(event) {
  if (!["original","investigation","prediction","correction"].includes(event.editorialType)) return [];
  const results = [];
  for (const kind of ["counterevidence","evidence"]) {
    for (const item of (event[kind] || []).slice(0, 2)) {
      const url = publicUrl(item.url);
      if (!url || !item.finding || !item.name || /reddit/i.test(item.name)) continue;
      results.push({
        eventId:event.id, title:clean(item.name, 180), url, source:clean(item.name, 100),
        excerpt:clean(item.finding, 600), kind:"published " + kind, status:"attributed finding",
        publishedAt:null, attributedAt:event.updatedAt, scope:event.scope, location:clean(event.location, 100),
        attribution:"Finding attributed by " + clean(event.byline || event.source, 100) + " in " + clean(event.title, 180),
        timeline:[],
      });
    }
  }
  return results;
}

export function analystRecords(events, related = []) {
  const result = [];
  const urls = new Set();
  for (const event of events) {
    for (const record of [reportRecord(event), ...editorialRecords(event)]) {
      if (!record.url || urls.has(record.url)) continue;
      urls.add(record.url);
      result.push({ ...record, id:String(result.length + 1) });
    }
  }
  const records = result.slice(0, 8);
  const byEvent = new Map(records.filter(r => r.kind !== "published evidence" && r.kind !== "published counterevidence").map(r => [r.eventId, r]));
  for (const relation of related.slice(0, 12)) {
    const matches = (relation.eventIds || []).map(id => byEvent.get(id)).filter(Boolean);
    if (matches.length < 2) continue;
    for (const record of matches) {
      record.observedOverlap = {
        records: matches.filter(peer => peer !== record).map(peer => peer.id),
        basis: clean(relation.reason, 220), limitation:"Shared reporting context only. No causal link or independent verification established.",
      };
    }
  }
  return records;
}
