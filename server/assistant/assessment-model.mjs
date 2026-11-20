import { analystRecords, sourceCandidate } from "./evidence.mjs";
import { digest } from "./http.mjs";
import { investigationProfile, reviewOfInterference } from "./assessment-profiles.mjs";

const tidy = value => String(value || "").replace(/\s+/g, " ").trim();
const point = (text, record) => ({text, citationIds:record ? [record.id] : []});
const rejected = /\b(?:ruled out|found no evidence|no (?:sign|evidence|indication)s? of|inconsistent with|excludes?|did not (?:find|detect|occur)|disproved|denied|unrelated to)\b/i;
const absenceOnly = /\b(?:found no evidence|no (?:sign|evidence|indication)s? of|not yet confirmed|insufficient evidence)\b/i;
const possibilityOnly = /\b(?:unclear whether|might have|may have|wondered|speculated|alleged|rumou?r|possibly|could have)\b/i;
const officialHost = raw => {
  const host = new URL(raw).hostname;
  return /\.(?:gov|gov\.uk|gc\.ca|gov\.au|gouv\.fr|europa\.eu)$/i.test(host) || /^(?:ntsb\.gov|faa\.gov)$/i.test(host);
};

function restrictedSocial(event) {
  try {
    const url = new URL(event.url);
    return /reddit/i.test(event.source) || /(^|\.)(?:reddit\.com|redd\.it)$/i.test(url.hostname);
  } catch { return false; }
}

function sourcePassages(records) {
  const passages = [];
  for (const record of records) {
    // A current title or published finding can support an assessment. Historical
    // timeline text and prior editions must not silently become current evidence.
    const values = record.kind.startsWith("published ") ? [record.excerpt] : [record.excerpt, record.title];
    const seen = new Set();
    for (const value of values) {
      const sentences = tidy(value).match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [];
      for (const sentence of sentences) {
        const text = tidy(sentence).replace(/^\*+\s*/, "");
        if (text.length < 12 || text.length > 410 || seen.has(text)) continue;
        seen.add(text);
        passages.push({ref:record.id + "." + seen.size, record, text});
        if (seen.size >= 7) break;
      }
      if (seen.size >= 7) break;
    }
  }
  return passages;
}

function explicitInquiry(passage) {
  if (!officialHost(passage.record.url) || rejected.test(passage.text) || passage.record.status === "speculation") return false;
  return /\b(?:investigators?|investigation|authorit(?:ies|y)|agency|inquiry|commission|police|board)\b[^.!?]{0,60}\b(?:examin\w+|investigat\w+|review\w*|inquir\w* into)\b[^.!?]{0,65}\b(?:sabotage|deliberate interference|intelligence operation|covert operation)\b/i.test(passage.text);
}

function citedPassage(p) {
  const attribution = p.record.attribution ? p.record.attribution : p.record.source;
  return point(attribution + " — “" + p.text + "”", p.record);
}

function canSupport(passage, event) {
  return passage.record.kind === "published evidence" ||
    (event.status !== "speculation" && !event.topicClaim && event.editorialType !== "prediction" && passage.record.kind !== "published counterevidence");
}

function bearing(passage, proposal, event) {
  if (proposal === reviewOfInterference) return explicitInquiry(passage) ? "support" : null;
  // Negation belongs to its clause. The absence of a positive finding is not a disproof.
  const clauses = passage.text.split(/;|,\s+(?=(?:but|while|although|whereas|yet)\b)|\b(?:but|whereas)\b/i);
  const matched = clauses.filter(clause=>proposal.clues.test(clause));
  if (!matched.length) return null;
  if (passage.record.kind === "published counterevidence") return "against";
  if (!canSupport(passage,event)) return null;
  if (matched.some(clause=>absenceOnly.test(clause) || possibilityOnly.test(clause))) return null;
  if (matched.every(clause=>rejected.test(clause))) return "against";
  return matched.every(clause=>!rejected.test(clause)) ? "support" : null;
}

function investigateOptions(profile, event, passages) {
  const inquiry = passages.find(explicitInquiry);
  let ideas = profile.ideas;
  if (inquiry && !event.topicClaim && event.status !== "speculation") ideas = [...ideas, reviewOfInterference];
  const options = [];
  for (const proposal of ideas) {
    const matches = passages.filter(p => proposal.clues.test(p.text));
    if (proposal.id === "water-coast" && !matches.length) continue;
    const support = matches.filter(p => bearing(p,proposal,event) === "support");
    const against = matches.filter(p => bearing(p,proposal,event) === "against");
    options.push({...proposal, support:support.slice(0,2), against:against.slice(0,2)});
  }
  return options;
}

function publicConsequences(event, record, hasInquiry) {
  const text = tidy([event.title,event.summary,event.intelligence?.category].join(" "));
  const points = [];
  if (/\b(?:border|ceasefire|diplomatic|sanctions|treaty|cross-border)\b/i.test(text))
    points.push(point("If the reported measure is implemented, cross-border access or diplomatic obligations could change. Check its terms, geographic reach and effective date.",record));
  if (/\b(?:military|armed forces|conflict|fighting|airstrike|humanitarian)\b/i.test(text))
    points.push(point("Implications for civilians depend on documented changes in displacement, access to services or humanitarian relief. The report alone does not establish a wider change in military posture.",record));
  if (hasInquiry)
    points.push(point("An officially documented inquiry can raise oversight and disclosure questions. Its existence does not establish a covert operation or identify a responsible party.",record));
  return points;
}

function socialRecord(event) {
  try {
    const u = new URL(event.url);
    if (!["https:","http:"].includes(u.protocol) || u.username || u.password || !/(^|\.)(?:reddit\.com|redd\.it)$/i.test(u.hostname)) return null;
    return {id:"1",title:tidy(event.title),source:tidy(event.source),url:u.href,kind:"public discussion",excerpt:"",status:"speculation"};
  } catch { return null; }
}

export function assessmentMaterial(event) {
  const excluded = !sourceCandidate(event);
  const social = restrictedSocial(event);
  const records = excluded ? (social ? [socialRecord(event)].filter(Boolean) : []) : analystRecords([event]);
  const primary = records[0];
  const claim = event.topicClaim || event.status === "speculation" || event.editorialType === "prediction" || social;
  const profile = investigationProfile(event);
  const passages = social ? [] : sourcePassages(records);
  const options = investigateOptions(profile, event, passages);
  const facts = [];
  const allegations = [];
  if (primary) {
    if (claim) {
      facts.push(point(primary.source + " published material on this subject. Publication establishes that the account exists.",primary));
      allegations.push(point("Subject of the " + (social ? "discussion" : "published account") + ": " + primary.title,primary));
    } else {
      facts.push(point(primary.source + " reports: " + primary.title,primary));
      const detail = passages.find(p => p.record === primary && p.text !== tidy(primary.title));
      if (detail) facts.push(citedPassage(detail));
    }
  }
  const significance = [];
  if (event.intelligence?.why && primary) significance.push(point(event.intelligence.why,primary));
  else if (claim) significance.push(point("The record is relevant to the spread and verification of a public narrative. Discussion volume cannot verify the underlying claim.",primary));
  else if (event.severityReason && primary) significance.push(point(event.severityReason,primary));
  else if (primary) significance.push(point("The next revision can establish whether the reported scope, consequences or official response changed.",primary));
  const watch = [point(event.intelligence?.monitor ||
    (primary ? "Check the next dated update from " + primary.source + " against this account." : "Look for an attributable original publication."),primary)];
  const unknowns = [profile.unknown];
  if (!records.some(r => r.kind === "published counterevidence"))
    unknowns.push("This record contains no separately indexed contrary finding. That leaves alternative explanations open.");
  const base = {eventId:event.id,mode:"sources",updatedAt:event.updatedAt || event.publishedAt,notice:"Source-based assessment. Possible explanations are research questions. Supporting passages provide context, not proof.",
    facts,allegations,significance,hypotheses:[],implications:claim ? [] : publicConsequences(event,primary,options.some(o=>o.id === reviewOfInterference.id)),
    unknowns,watch,citations:records.map(({id,title,source,url})=>({id,title,source,url}))};
  const fingerprint = digest(JSON.stringify(["assessment-v1",base,options.map(o=>[o.id,o.support.map(p=>[p.ref,p.text]),o.against.map(p=>[p.ref,p.text])])]));
  return {base,options,fingerprint,modelEligible:!excluded && !!primary && !!options.length};
}

const selectedOption = (option,support,against) => ({label:option.label,explanation:option.explanation,test:option.test,
  support:option.support.filter(p=>support.includes(p.ref)).map(citedPassage),
  against:option.against.filter(p=>against.includes(p.ref)).map(citedPassage)});

export function sourceAssessment(material, notice) {
  // Prefer alternatives where the record supplies evidence, retaining one competing
  // explanation with an explicit test even if no direct evidence has been indexed.
  const ranked = [...material.options].sort((a,b) => Number(b.id === reviewOfInterference.id) - Number(a.id === reviewOfInterference.id) ||
    Number(!!(b.support.length+b.against.length)) - Number(!!(a.support.length+a.against.length)));
  return {...material.base,...(notice ? {notice} : {}),hypotheses:ranked.slice(0,3).map(o=>selectedOption(o,o.support.map(p=>p.ref),o.against.map(p=>p.ref)))};
}

export function modelInput(material) {
  return {report:material.base.facts, allegations:material.base.allegations,
    alternatives:material.options.map(({id,label,explanation,test,support,against})=>({
      id,label,explanation,test,
      support:support.map(p=>({ref:p.ref,passage:p.text})),against:against.map(p=>({ref:p.ref,passage:p.text})),
    }))};
}

// The model proposes comparisons. It cannot add actors, causal claims, quotations,
// reference URLs or evidence to the source-bound alternatives supplied by the server.
export function applyModelSelection(raw,material) {
  if (!raw || !Array.isArray(raw.hypotheses) || raw.hypotheses.length < Math.min(2,material.options.length) || raw.hypotheses.length > 3) return null;
  const seen = new Set();
  const hypotheses = [];
  for (const choice of raw.hypotheses) {
    const option = material.options.find(o=>o.id === choice?.id);
    if (!option || seen.has(choice.id)) return null;
    for (const field of ["support","against"]) {
      if (!Array.isArray(choice[field]) || choice[field].length > 2 || new Set(choice[field]).size !== choice[field].length ||
        choice[field].some(ref=>!option[field].some(p=>p.ref === ref))) return null;
    }
    seen.add(choice.id);
    // Keep every known contrary finding even if the model leaves it out.
    hypotheses.push(selectedOption(option,choice.support,option.against.map(p=>p.ref)));
  }
  return {...material.base,mode:"ai",notice:"AI-assisted assessment. The model compared source-bound explanations and selected relevant passages. Hypotheses and conditional implications are inferences, not verified findings.",hypotheses};
}
