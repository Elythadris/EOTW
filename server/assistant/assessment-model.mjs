import { analystRecords, sourceCandidate } from "./evidence.mjs";
import { digest } from "./http.mjs";
import { investigationProfile, reviewOfInterference } from "./assessment-profiles.mjs";

const tidy = value => String(value || "").replace(/\s+/g, " ").trim();
const point = (text, record) => ({text, citationIds:record ? [record.id] : []});
const allegationText = /\b(?:alleg(?:ation\w*|edly|ed|es?|ing)|accus(?:ation\w*|ed|es?|ing)|rumou?r(?:s|ed)?|unverified|unsubstantiated|without evidence|unconfirmed claims?|suspected of|charged with|indicted (?:for|on)|claims? (?:that|to have)|asserts? without|conspiracy theory)\b/i;
const rejected = /\b(?:rul(?:e|es|ed) out|found no evidence|no (?:sign|evidence|indication)s? of|inconsistent with|excludes?|did not (?:find|detect|occur)|disproved|denied|unrelated to)\b/i;
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
      const sentences = tidy(value).split(/(?<=[.!?])\s+|\s+(?=\*\s+[A-Z])/u);
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
  if (!officialHost(passage.record.url) || rejected.test(passage.text) || allegationText.test(passage.text) || passage.record.status === "speculation") return false;
  return /\b(?:investigators?|investigation|authorit(?:ies|y)|agency|inquiry|commission|police|board)\b[^.!?]{0,60}\b(?:examin\w+|investigat\w+|review\w*|inquir\w* into)\b[^.!?]{0,65}\b(?:sabotage|deliberate interference|intelligence operation|covert operation)\b/i.test(passage.text);
}

function citedPassage(p) {
  const attribution = p.record.attribution ? p.record.attribution : p.record.source;
  return point(attribution + " — “" + p.text + "”", p.record);
}

function canSupport(passage, event) {
  if (allegationText.test(passage.text)) return false;
  // Editorial polarity refers to the underlying claim. Either type of attributed
  // finding may favor or contradict a different explanatory hypothesis.
  return ["published evidence","published counterevidence"].includes(passage.record.kind) ||
    (event.status !== "speculation" && !event.topicClaim && event.editorialType !== "prediction");
}

function bearing(passage, proposal, event) {
  if (proposal === reviewOfInterference) return explicitInquiry(passage) ? "support" : null;
  // Negation belongs to its clause. The absence of a positive finding is not a disproof.
  const clauses = passage.text.split(/;|,\s+|\b(?:but|whereas)\b/i);
  const matched = clauses.filter(clause=>proposal.clues.test(clause));
  if (!matched.length) return null;
  if (!canSupport(passage,event)) return null;
  if (matched.some(clause=>absenceOnly.test(clause) || possibilityOnly.test(clause))) return null;
  const valences = matched.map(clause => {
    if (proposal.id === "water-runoff" && /\b(?:expected|forecast|predicted|will)\b/i.test(clause) &&
      !/\b(?:already|recorded|observed|has (?:brought|raised|fallen)|fell|measured|recent rainfall)\b/i.test(clause)) return null;
    const match = proposal.clues.exec(clause);
    const before = clause.slice(0,match.index);
    const after = clause.slice(match.index + match[0].length);
    const directNegative = /\b(?:rul(?:e|es|ed|ing) out|inconsistent with|disprov(?:e|es|ed)|exclud(?:e|es|ed)|denied)\s+(?:(?:the|a|an|any|reported|possible|substantial|possibility of|a role for)\s+){0,3}$/i.test(before) ||
      /^\s+(?:is|are|was|were|has been|had been|was explicitly|is explicitly)\s+(?:ruled out|disproved|excluded)\b/i.test(after);
    if (directNegative) return "against";
    return rejected.test(clause) || /\b(?:no|not|never|without|lacks?|ruling out)\b/i.test(clause) ? null : "support";
  });
  return valences.every(v=>v === "against") ? "against" : valences.every(v=>v === "support") ? "support" : null;
}

function investigateOptions(profile, event, passages) {
  const inquiry = passages.find(explicitInquiry);
  let ideas = profile.ideas;
  if (inquiry && !event.topicClaim && event.status !== "speculation") ideas = [...ideas, reviewOfInterference];
  const options = [];
  for (const proposal of ideas) {
    const matches = passages.filter(p => proposal.clues.test(p.text));
    if (["water-coast","claim-instrument"].includes(proposal.id) && !matches.length) continue;
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
    const flaggedTitle = allegationText.test(primary.title);
    if (claim || flaggedTitle) {
      facts.push(point(primary.source + " published material on this subject. Publication establishes that the account exists.",primary));
      allegations.push(point("Subject of the " + (social ? "discussion" : "published account") + ": " + primary.title,primary));
    } else {
      facts.push(point(primary.source + " reports: " + primary.title,primary));
    }
    const details = passages.filter(p => p.record === primary && p.text !== tidy(primary.title));
    if (!claim) {
      const detail = details.find(p => !allegationText.test(p.text));
      if (detail) facts.push(citedPassage(detail));
    }
    for (const p of details.filter(p => allegationText.test(p.text)).slice(0,2)) allegations.push(citedPassage(p));
  }
  const significance = [];
  if (event.intelligence?.why && primary && !allegationText.test(event.intelligence.why)) significance.push(point(event.intelligence.why,primary));
  else if (claim) significance.push(point("The record is relevant to the spread and verification of a public narrative. Discussion volume cannot verify the underlying claim.",primary));
  else if (event.severityReason && primary) significance.push(point(event.severityReason,primary));
  else if (primary) significance.push(point("The next revision can establish whether the reported scope, consequences or official response changed.",primary));
  const watch = [point(event.intelligence?.monitor ||
    (primary ? "Check the next dated update from " + primary.source + " against this account." : "Look for an attributable original publication."),primary)];
  const unknowns = [profile.unknown];
  if (!records.some(r => r.kind === "published counterevidence"))
    unknowns.push("This record contains no separately indexed contrary finding. That leaves alternative explanations open.");
  const base = {eventId:event.id,mode:"sources",updatedAt:event.updatedAt || event.publishedAt,notice:"Source-based assessment. Possible explanations are research questions. Supporting passages provide context, not proof.",
    facts,allegations,significance,hypotheses:[],implications:claim || allegations.length ? [] : publicConsequences(event,primary,options.some(o=>o.id === reviewOfInterference.id)),
    unknowns,watch,citations:records.map(({id,title,source,url})=>({id,title,source,url}))};
  const fingerprint = digest(JSON.stringify(["assessment-v2",base,options.map(o=>[o.id,o.support.map(p=>[p.ref,p.text]),o.against.map(p=>[p.ref,p.text])])]));
  const sensitiveContext = /\b(?:military|intelligence operation|covert|sabotage|assassination|cyber\w*|intrusion|attack\w*|warfare|terror\w*|weapon\w*|pathogen|explosi\w*|suicide|kidnap\w*)\b/i.test([event.title,event.summary,event.category].join(" "));
  return {base,options,fingerprint,modelEligible:!excluded && !!primary && !!options.length,canWrite:!claim && !allegations.length && !sensitiveContext};
}

const selectedOption = (option,support,against) => ({label:option.label,explanation:option.explanation,origin:"research",inferenceCitationIds:[],test:option.test,
  support:option.support.filter(p=>support.includes(p.ref)).map(citedPassage),
  against:option.against.filter(p=>against.includes(p.ref)).map(citedPassage)});

export function sourceAssessment(material, notice) {
  // Prefer alternatives where the record supplies evidence, retaining one competing
  // explanation with an explicit test even if no direct evidence has been indexed.
  const ranked = [...material.options].sort((a,b) => Number(b.id === reviewOfInterference.id) - Number(a.id === reviewOfInterference.id) ||
    Number(!!(b.support.length+b.against.length)) - Number(!!(a.support.length+a.against.length)));
  return {...material.base,...(notice ? {notice} : {}),hypotheses:ranked.slice(0,3).map(o=>selectedOption(o,o.support.map(p=>p.ref),o.against.map(p=>p.ref)))};
}


const writeableIdea = /^(?:water-|quake-|hazard-|utility-|policy-implementation$|policy-announcement$|new-development$|reporting-revision$)/;
const grammar = new Set(("a an the this that these those if as at for by from of in into on to with without under over after before until during between and or while " +
  "is are was were has have had be been being it its still could may might can would remain remains continue continues continuing persist persists keep keeps become becomes " +
  "then further later earlier already local next current reported conditions change changes changing longer shorter rise rises rising move moves moving shift shifts " +
  "suggest suggests reflect reflects consistent lead leads result results because where when which more less").split(/\s+/));
const sensitiveWords = /\b(?:arms?|actor|agent|armed|army|soldier|police|suspect|person|persons|terror\w*|militar\w*|missile|weapon\w*|bomb\w*|attack\w*|covert|secret|sabota\w*|intelligence|deliberate\w*|intentional\w*|blame\w*|attribut\w*|perpetrat\w*|exploit\w*|malware|ransomware|intrusion|payload|target\w*|intrud\w*|bypass\w*|entry point|weakness|disable\w*|vulnerab\w*|evad\w*|chemical|biological|pathogen|casualt\w*|killed|murder\w*|culprit|criminal|perpetrator|suspicious|surveil\w*|lies?|lied|guilty|proof|proves?|certainly|certain|guarantee\w*|always|never|authoriz\w*|must|should|shall|step|command|execute|engineer\w*|triple\w*|doubl\w*|half|percent|zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million)\b/i;
const words = text => String(text || "").toLowerCase().match(/[a-z]+/g) || [];
const stem = word => word.length > 5 ? word.replace(/ies$/,"y").replace(/(?:ing|ed|s)$/,"") : word;
const stems = text => new Set(words(text).map(stem));

// Common descriptors in an official title, such as "Flood Stage" or "River",
// are still valid geographic or physical terms when also used in ordinary prose.
const commonTerms = new Set(("water heavy light rainfall rain river basin gauge levels level flood stage warning forecast winds wind coastal tide level seismic earthquake magnitude " +
  "depth impact weather land fire storm measured updated service policy revision restrictions hearing county region monitoring recording preliminary").split(" "));
function language(option,evidence) {
  const passages = evidence.map(p=>p.text).join(" ");
  const proper = new Set(evidence.flatMap(p=>p.text.match(/\b[A-Z][a-zA-Z]{2,}\b/g) || [])
    .map(t=>t.toLowerCase()).filter(t=>!commonTerms.has(t) && !grammar.has(t)));
  const sourceWords = stems(passages);
  const allowed = new Set([...sourceWords,...stems([option.label,option.explanation,option.test].join(" ")),...[...grammar].map(stem)]);
  const sourceTerms = [...new Set(words(passages).filter(t=>t.length >= 4 && !grammar.has(t) && !proper.has(t) && !sensitiveWords.test(t)))].slice(0,20);
  return {proper,sourceWords,allowed,sourceTerms};
}

function verifiedInference(value, option, selectedRefs, material) {
  if (!material.canWrite || !writeableIdea.test(option.id) || typeof value !== "string" || !selectedRefs.length) return null;
  const line = value.trim();
  // A single conditional with no new people, numbers, attribution, prescriptions
  // or free-standing factual assertions. Reject an invalid sentence independently
  // of the reference selections so the reader still gets the checked comparison.
  if (line.length < 38 || line.length > 220 ||
    !/^If [a-z][a-z '’-]{6,105}, [a-z][a-z '’-]{0,82}\b(?:could|may|might)\b[a-z '’-]{4,105}\.$/.test(line) ||
    sensitiveWords.test(line) || /\b(?:he|she|they|their|him|his|her|i|we|you|your)\b/.test(line)) return null;
  const evidence = option.support.filter(p => selectedRefs.includes(p.ref));
  const {proper,sourceWords,allowed} = language(option,evidence);
  const tokens = words(line);
  if (tokens.some(token=>proper.has(token) || !allowed.has(stem(token)))) return null;
  const grounded = new Set(tokens.filter(token=>token.length >= 4 && !grammar.has(token) && sourceWords.has(stem(token))).map(stem));
  if (grounded.size < 2) return null;
  return {explanation:line,origin:"model",inferenceCitationIds:[...new Set(evidence.map(p=>p.record.id))]};
}

export function modelInput(material) {
  return {report:material.base.facts, allegations:material.base.allegations,
    alternatives:material.options.map(({id,label,explanation,test,support,against})=>({
      id,label,explanation,test,canWrite:material.canWrite && writeableIdea.test(id) && support.length > 0,
      sourceTerms:language({label,explanation,test},support).sourceTerms,
      support:support.map(p=>({ref:p.ref,passage:p.text})),against:against.map(p=>({ref:p.ref,passage:p.text})),
    }))};
}

// The model proposes comparisons and may phrase a conventional conditional inference.
// All factual text, source quotations, identifiers and URLs come from the current record.
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
    const hypothesis = selectedOption(option,choice.support,option.against.map(p=>p.ref));
    const inference = verifiedInference(choice.inference,option,choice.support,material);
    hypotheses.push(inference ? {...hypothesis,...inference} : hypothesis);
  }
  const wrote = hypotheses.some(h=>h.origin === "model");
  return {...material.base,mode:"ai",notice:wrote
    ? "AI hypotheses are conditional interpretations of the cited passages. Research hypotheses use checked alternatives. Neither is a verified finding."
    : "AI-assisted comparison. The model selected research hypotheses and source passages. The explanations shown use checked alternatives.",hypotheses};
}
