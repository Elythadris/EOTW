// The model receives a small canonical set of passages. IDs point to exact slices
// of current source text and are scoped to one invocation.
const normalize = value => String(value || "").replace(/\s+/g," ").trim();
export function evidenceIndex(records) {
  const index = new Map();
  for (const record of records) {
    const seen = new Set();
    let ordinal = 0;
    for (const value of [record.title, record.sourceArea, record.excerpt, ...(record.timeline || []).slice(-2).map(step => step.text)]) {
      const text = normalize(value);
      if (!text || /^source published this record\.?$/i.test(text)) continue;
      for (let start=0; start < text.length && ordinal < 5;) {
        let end = Math.min(text.length,start + 210);
        if (end < text.length) {
          const lastSpace = text.lastIndexOf(" ",end);
          if (lastSpace > start) end = lastSpace;
        }
        const passage = text.slice(start,end).trim();
        start = end;
        if (passage.length < 5 || seen.has(passage.toLowerCase())) continue;
        seen.add(passage.toLowerCase());
        const ref = record.id + "." + ++ordinal;
        index.set(ref,{ref,id:record.id,quote:passage});
      }
    }
  }
  return index;
}

export function modelRecords(records) {
  const index = [...evidenceIndex(records).values()];
  return records.map(record => ({
    id:record.id, publisher:record.source, date:record.publishedAt || record.attributedAt || null,
    scope:record.scope, region:record.location, status:record.status, kind:record.kind,
    ...(record.signal ? {signal:{level:record.signal.level,reason:record.signal.why,monitor:record.signal.monitor}} : {}),
    ...(record.observedOverlap ? {overlap:record.observedOverlap} : {}),
    ...(record.attribution ? {attributedBy:record.attribution} : {}),
    ...(record.supersedes ? {correctionOf:record.supersedes} : {}),
    evidence:index.filter(item=>item.id===record.id).map(({ref,quote})=>({ref,passage:quote})),
  }));
}

export function providerProblem(error) {
  const known = new Set(["APIConnectionTimeoutError","APIConnectionError","AbortError","TimeoutError"]);
  const knownResponses = new Set(["refusal","truncated","invalid-json","empty-response","upstream-filter"]);
  const category = knownResponses.has(error?.diagnostic) ? error.diagnostic :
    known.has(error?.name) ? error.name : Number.isInteger(error?.status) ? "provider-http" : "provider-error";
  const status = Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599 ? error.status : undefined;
  return status ? {category,httpStatus:status} : {category};
}
export function readCompletion(completion) {
  const choice = completion?.choices?.[0];
  const fail = diagnostic => { const error = new Error("Provider result unavailable"); error.diagnostic = diagnostic; throw error; };
  if (choice?.message?.refusal) fail("refusal");
  if (choice?.finish_reason === "length") fail("truncated");
  if (choice?.finish_reason === "content_filter") fail("upstream-filter");
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim()) fail("empty-response");
  try { return JSON.parse(content); } catch { return fail("invalid-json"); }
}
