import { createHash } from "node:crypto";
import { DAY, HOUR, fold, scopeFor } from "./model.mjs";

const MINUTE = 60000;
const millis = value => Date.parse(value || "") || 0;
const hash = value => createHash("sha256").update(String(value)).digest("hex").slice(0, 16);
const capSeverity = { Extreme: 20, Severe: 15, Moderate: 9, Minor: 3, Unknown: 0 };
const capUrgency = { Immediate: 20, Expected: 12, Future: 4, Unknown: 0, Past: 0 };
const capCertainty = { Observed: 4, Likely: 3, Possible: 2, Unlikely: 0, Unknown: 0 };
const pager = { green: 0, yellow: 1, orange: 2, red: 3 };
const severeWeather = /\b(tornado|tsunami|flash flood|hurricane|storm surge|blizzard|extreme wind|ice storm)\b/i;
const warning = /\bwarning\b/i;
const quietWords = /\b(?:training exercise|simulation|drill|test message|annual report|risk of|fears? of|could|might|may trigger|averts?|prevent(?:s|ing)?|claims? of|rumou?rs? of|request for comments|public meeting|tabletop|what if|may soon|could trigger|could spark|prepares? for|preparing for|anniversary|years? ago|how to|opinion|retrospective|false claim|rescinded|rescinds?|reopened|reopens?|lift(?:ed|s) (?:an? |the )?(?:advisory|order|curfew)|(?:advisory|curfew|order|closure) (?:is |has been )?(?:lifted|ended|canceled|cancelled)|no threat|all clear|warning (?:canceled|cancelled|lifted)|outage (?:resolved|ended)|services? restored)\b/i;
const domains = ["apnews.com","reuters.com","bbc.com","bbc.co.uk","npr.org","pbs.org","theguardian.com","globalvoices.org","theconversation.com","hawaiipublicradio.org","civilbeat.org","un.org","who.int","reliefweb.int","icrc.org","federalregister.gov","mauicounty.gov","hawaii.gov","justice.gov"];
const criticalText = [
  {key:"evacuation",category:"Civil emergency",pattern:/\b(?:mandatory (?:evacuation|shelter)|evacuation (?:orders?|ordered)|ordered to evacuate|shelter.in.place order|boil.water (?:order|notice)|emergency (?:has been |was |is )?declared|declares? (?:a )?(?:state of |public health )?emergency)\b/i, impact:27, severity:15, monitor:"Check whether authorities expand, lift or revise the order."},
  {key:"water",category:"Water safety",pattern:/\b(?:unsafe.water advisory|do.not.(?:drink|use)(?:.water)? (?:advisory|notice|order)|(?:water (?:notice|advisory|order)|residents (?:are )?(?:told|urged|warned))[^.!?]{0,55}(?:do not drink|not to drink)|boil.water (?:advisory|notice|order))\b/i,impact:26,severity:15,monitor:"Check the issuing water authority’s affected service areas, testing and updates."},
  {key:"emergency-closure",category:"Transport disruption",pattern:/\b(?:road|bridge|route|highway|arterial|roads)\b/i,consequence:/\b(?:closed?|closes|closure|shut|impassable|blocked)\b[^.!?]{0,85}\b(?:landslide|rockslide|mudslide|flood\w*|wildfire|washout|collapse|debris flow)\b|\b(?:landslide|rockslide|mudslide|flood\w*|wildfire|washout|collapse|debris flow)\b[^.!?]{0,85}\b(?:clos\w*|shuts?|impassable|blocks?)\b/i,impact:20,severity:11,monitor:"Follow the transportation authority’s closure status and reopening notice."},
  {key:"civil-unrest",category:"Civil unrest",pattern:/\b(?:unrest|protests?|demonstrations?|riots?|public disorder)\b/i,consequence:/\b(?:(?:impos\w*|extend\w*|declar\w*|enforc\w*) (?:a |an |the )?(?:nighttime |overnight |citywide )?curfew|curfew (?:imposed|extended|ordered)|(?:transit|rail|public transport|public services|schools?) (?:closed|suspended|halted|shut)|(?:halts?|suspends?|shuts? down) (?:city |public )?(?:transport|transit|schools?))\b/i,impact:24,severity:14,monitor:"Follow official civil restrictions, affected services and their end times."},
  {key:"civilian-harm",category:"Conflict and civilians",pattern:/\b(?:war|conflict|fighting|bombardment|airstrikes?|attacks?|humanitarian)\b/i,consequence:/\b(?:(?:thousands|millions) (?:are |of (?:civilians|residents|people) )?(?:flee|fled|forced to flee|displaced)|displaces? (?:thousands|millions)|civilian (?:death toll|casualties) (?:rises?|mounts?|surges?)|hospitals? (?:forced to close|cease operations)|(?:hospitals?|aid deliveries) cut off)\b/i,impact:27,severity:16,monitor:"Watch for attributed updates on displacement, civilian services and aid access."},
  {key:"diplomacy",category:"Diplomatic change",pattern:/\b(?:(?:severs?|breaks? off|suspends?) diplomatic (?:ties|relations)|diplomatic (?:ties|relations) (?:severed|suspended)|(?:peace (?:accord|agreement)|ceasefire deal) (?:signed|takes effect)|signs? (?:a |the )?peace (?:accord|agreement)|closes? (?:its |the )?border (?:to|with))\b/i,impact:21,severity:7,monitor:"Monitor formal terms, implementation dates and effects on civilian movement."},
  {key:"utilities",category:"Infrastructure",pattern:/\b(?:(?:widespread|regional|nationwide|major|massive) (?:power|water|telecom|internet|transport|rail|network) (?:outage|disruption|failure|shutdown)|(?:hospital|water|electricity|rail|power|internet) (?:service|supplies|operations?) (?:suspended|halted|disrupted)|(?:thousands|millions) (?:left |remain )?without (?:water|power|electricity))\b/i, impact:25,severity:14,monitor:"Watch the service operator’s affected-area and restoration updates."},
  {key:"cyber",category:"Cyber disruption",pattern:/\b(?:ransomware|cyber.?attack|cyber incident|data breach)\b/i, consequence:/\b(?:outage|disrupt\w*|shut\w*|suspend\w*|stopp?\w*|cancel\w*|hospital|public services? offline|millions? of (?:records|people|customers))\b/i,impact:24,severity:13,monitor:"Watch for the affected organization’s confirmed scope and service recovery."},
  {key:"financial",category:"Economic disruption",pattern:/\b(?:bank (?:failure|collapse)|sovereign default|defaults? on (?:its )?debt|capital controls|withdrawals? (?:suspended|frozen|halted)|halts? (?:bank )?withdrawals|exchange (?:halts|suspends) trading|emergency (?:rate cut|rate hike|bailout))\b/i,impact:24,severity:14,monitor:"Monitor the regulator’s decision and changes to access or operating restrictions."},
  {key:"civilian-conflict",category:"Conflict and civilians",pattern:/\b(?:ceasefire (?:collapses|collapsed|ends|ended|breaks down)|mass displacement|humanitarian corridor\w* (?:closed|suspended)|(?:aid|food aid|humanitarian access) (?:blocked|suspended|cut off)|mass evacuation|civilian evacuation (?:ordered|underway))\b/i,impact:26,severity:15,monitor:"Follow civilian access, displacement and verified humanitarian relief updates."},
  {key:"health",category:"Public health",pattern:/\b(?:public health emergency|outbreak (?:declared|confirmed)|declares? (?:an? )?outbreak|emergency (?:product|food|drug) recall|nationwide recall)\b/i,impact:22,severity:12,monitor:"Watch for changes in public health guidance and the affected population."},
];
function host(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./,""); } catch { return ""; }
}
function editorialConfidence(e) {
  if (e.editorialType) return (e.sources?.length || 0) > 1 ? 12 : 0;
  const domain = host(e.url);
  if (domain.endsWith(".gov") || domain === "who.int" || domain.endsWith(".un.org")) return 15;
  return domains.some(d => domain === d || domain.endsWith("." + d)) ? 12 : 0;
}
export function nwsKeys(p) {
  const year = String(p.sent || "").slice(0,4);
  const zones = [...new Set(p.geocode?.UGC || [])].filter(s=>typeof s==="string").sort();
  const tags = (p.parameters?.VTEC || []).map(line => {
    const parts = /^\/O\.[A-Z]{3}\.([A-Z0-9]{4})\.([A-Z]{2})\.([A-Z])\.(\d{4})\.(\d{2})/.exec(line);
    if (!parts || !/^\d{4}$/.test(year)) return null;
    const issueYear = parts[5] === "00" ? year : (Number(parts[5]) >= 80 ? "19" : "20") + parts[5];
    return [issueYear,...parts.slice(1,5)].join(".");
  }).filter(Boolean);
  const episode = [...new Set(tags)].sort().join("+");
  return episode ? {episode:"nws:"+episode,series:zones.length ? "nws:"+episode+":"+hash(zones.join("|")) : null} : {};
}
export function incidentKey(e) {
  if (e.origin?.episode) return e.origin.episode;
  if (e.source === "National Weather Service" && e.title && e.updatedAt) return "nws-bulletin:"+hash(e.title+"|"+e.updatedAt);
  return e.id;
}

function latestMeasure(e) {
  if (Number.isFinite(e.origin?.magnitude)) return e.origin.magnitude;
  const value=/\bmagnitude\s+(\d+(?:\.\d+)?)\b/i.exec(e.severityReason || e.summary || "") || /^M\s*(\d+(?:\.\d+)?)/.exec(e.title);
  return value ? Number(value[1]) : null;
}
function template(category,key,impact,severity,urgency,credibility,why,monitor) {
  return {category,key,impact,severity,urgency,credibility,why,monitor};
}
function qualify(e,now,scope) {
  if (e.transient || e.source === "Reddit" || e.status === "speculation" || e.editorialType === "prediction" ||
      millis(e.updatedAt)>now+5*MINUTE || (e.expiresAt && millis(e.expiresAt)<=now)) return null;
  const age = now - millis(e.updatedAt);
  const origin = e.origin || {};
  if (e.source === "National Weather Service") {
    const type = origin.event || e.title;
    if (!e.expiresAt || !millis(e.expiresAt) || age>3*DAY || /\b(advisory|statement|outlook|test|drill)\b/i.test(type) ||
        origin.urgency==="Past" || origin.certainty==="Unlikely") return null;
    const isWarning = warning.test(type);
    if (!isWarning && !(severeWeather.test(type) && /\bwatch\b/i.test(type))) return null;
    const severity = capSeverity[origin.severity] ?? (e.severity === "high" ? 15 : e.severity === "moderate" ? 9 : 0);
    if (severity < 9) return null;
    const urgency = capUrgency[origin.urgency] ?? 0;
    const impact = isWarning ? (severeWeather.test(type) ? 29 : 21) : 15;
    const detail = [origin.severity || e.severity,origin.urgency,origin.certainty].filter(Boolean).join(" · ");
    const result=template("Weather and coastal hazards","weather",impact,severity,urgency,15,"An active "+(origin.event || "NWS warning or watch")+" covers "+(e.location || "the source’s published area")+".",
      "Check the official alert for affected areas, effective times, instructions and cancellation.");
    result.annotation="NWS classifications: "+detail;
    result.maxLevel=!isWarning || !origin.urgency || !origin.certainty ? "watch" : origin.urgency!=="Immediate" || !(capCertainty[origin.certainty]>=3) ? "elevated" : "high";
    return result;
  }
  if (e.source==="USGS" && e.category==="Earthquake") {
    const mag=latestMeasure(e), impactAlert=pager[origin.pager] || 0;
    if (age>36*HOUR || now-millis(e.publishedAt)>3*DAY || !(mag>=6 || impactAlert>0 || (scope==="local" && mag>=5))) return null;
    return template("Seismic activity","earthquake",impactAlert>=2 || mag>=7 ? 30 : mag>=6 ? 24 : 17,
      impactAlert>=2 || mag>=7 ? 20 : 14,age<=3*HOUR ? 15 : age<18*HOUR ? 9 : 4,
      e.status==="confirmed" ? 15 : 11,"USGS reports a magnitude "+mag+" earthquake"+(impactAlert ? " with a "+origin.pager+" PAGER impact alert." : "."),
      "Monitor USGS revisions and PAGER impact estimates. Magnitude alone does not establish damage.");
  }
  if (e.source==="NASA EONET") {
    if (age>36*HOUR || !Number.isFinite(origin.magnitude)) return null;
    const wind=/^(?:kts?|knots?)$/i.test(origin.unit || "") && origin.magnitude>=64;
    const fire=/acres?/i.test(origin.unit || "") && origin.magnitude>=10000 && /wildfire/i.test(origin.kind || "");
    if (!wind && !fire) return null;
    return template("Natural hazards",wind?"cyclone":"wildfire",23,14,age<12*HOUR?10:6,15,
      "NASA’s source reports "+origin.magnitude+" "+origin.unit+" for this "+(wind?"storm":"fire")+".","Check local warnings for human impact and changes in extent.");
  }
  if (age>48*HOUR || quietWords.test(e.title) || /\b(?:proof[- ]of[- ]concept|exploit code|troop positions|strike coordinates)\b/i.test(e.title)) return null;
  const credibility=editorialConfidence(e);
  if (!credibility) return null;
  const text=e.title;
  const rule=criticalText.find(r=>r.pattern.test(text) && (!r.consequence || r.consequence.test(text)));
  if (!rule) return null;
  const confidence=credibility===15 ? "An official source" : "An attributed published report";
  return template(rule.category,rule.key,rule.impact,rule.severity,age<8*HOUR?13:age<24*HOUR?8:4,credibility,
    confidence+" describes "+({evacuation:"a public protective action",water:"a municipal drinking-water advisory","emergency-closure":"a hazard-related transport closure","civil-unrest":"civil restrictions or service disruption associated with unrest","civilian-harm":"a reported civilian or humanitarian consequence",diplomacy:"a formal change in cross-border or diplomatic arrangements",utilities:"a consequential service interruption",cyber:"a cyber incident with reported service or population impact",financial:"a financial operating restriction or institutional disruption","civilian-conflict":"a change affecting civilian safety or humanitarian access",health:"an official health emergency, outbreak or recall"}[rule.key])+".",rule.monitor);
}

export function annotate(event, now, location="Maui") {
  const scope=scopeFor(event,location);
  const signal=qualify(event,now,scope);
  if (!signal) return null;
  const changes=event.observations?.changes || [];
  const recent=changes.filter(c=>millis(c.at)<=now && now-millis(c.at)<=DAY);
  const coverage=recent.filter(c=>c.kind==="coverage");
  const lastSix=coverage.filter(c=>now-millis(c.at)<=6*HOUR).length;
  const priorSix=coverage.filter(c=>now-millis(c.at)>6*HOUR && now-millis(c.at)<=12*HOUR).length;
  const acceleration=recent.some(c=>c.kind==="escalation") ? 10 : lastSix>=2 && lastSix>priorSix ? 7 : recent.some(c=>c.kind==="interest") ? 4 : 0;
  const axes={impact:signal.impact,severity:signal.severity,urgency:signal.urgency,credibility:signal.credibility,proximity:scope==="local"?5:0,acceleration};
  const score=Object.values(axes).reduce((a,b)=>a+b,0);
  if(score<40) return null;
  let level=score>=79?"high":score>=63?"elevated":"watch";
  if (signal.maxLevel==="watch") level="watch";
  if (level==="high" && signal.maxLevel==="elevated") level="elevated";
  const key=incidentKey(event);
  const newest=changes.filter(c=>c.kind==="escalation").at(-1);
  return {score,level,category:signal.category,topic:signal.key,why:signal.why,monitor:signal.monitor,axes,
    incidentKey:key,changeKey:key+"|"+(newest?.version || "initial"),
    reasons:[...(signal.annotation?[signal.annotation]:[]),signal.why,"Source attribution: "+event.source+".",
      ...(scope==="local"?["The report matches the selected place."]:[]),...recent.slice(-2).map(c=>c.description)]};
}
function addChange(list,kind,at,description,version) {
  if (!list.some(v=>v.version===version)) list.push({kind,at,description,version});
}
export function observe(old, event, received, now, comparable) {
  const before=old?.observations;
  const observation={firstSeenAt:before?.firstSeenAt || new Date(now).toISOString(),lastSeenAt:before?.lastSeenAt || new Date(now).toISOString(),
    changes:[...(before?.changes || [])],publishers:[...(before?.publishers || [])]};
  const domain=host(received.url);
  if (old && !observation.publishers.length) observation.publishers.push(host(old.url));
  const previouslySeen=observation.publishers.includes(domain);
  if (domain && !previouslySeen && observation.publishers.length<12) observation.publishers.push(domain);
  if (old && before && comparable && now-millis(before.lastSeenAt)>=MINUTE && received.updatedAt>=old.updatedAt) {
    const a=old.origin || {}, b=received.origin || {};
    const at=new Date(now).toISOString();
    const changes=[];
    if (b.event && a.event && (capSeverity[b.severity]>capSeverity[a.severity] || capUrgency[b.urgency]>capUrgency[a.urgency] ||
      (/\bwatch\b/i.test(a.event) && warning.test(b.event)))) changes.push("NWS changed "+a.event+" ("+a.severity+", "+a.urgency+") to "+b.event+" ("+b.severity+", "+b.urgency+").");
    if (Number.isFinite(a.magnitude) && Number.isFinite(b.magnitude) && received.source==="USGS" && b.magnitude>=5 && b.magnitude-a.magnitude>=0.45)
      changes.push("USGS revised magnitude upward from "+a.magnitude+" to "+b.magnitude+".");
    if (received.source==="USGS" && Object.hasOwn(pager,a.pager) && pager[b.pager]>pager[a.pager])
      changes.push("USGS raised the PAGER impact alert from "+a.pager+" to "+b.pager+".");
    if (received.source==="NASA EONET" && a.unit===b.unit && a.magnitude>0 && b.magnitude>=1.3*a.magnitude && (/^(?:kts?|knots?)$/i.test(b.unit) && b.magnitude>=64 || /acre/i.test(b.unit) && b.magnitude>=10000))
      changes.push("EONET raised the reported "+b.unit+" measurement from "+a.magnitude+" to "+b.magnitude+".");
    if (received.source!=="USGS" && received.source!=="National Weather Service" && received.source!=="NASA EONET") {
      const oldSignal=qualify(old,now,old.scope), nextSignal=qualify(received,now,received.scope);
      if (nextSignal && !oldSignal && old.url===received.url && received.updatedAt>old.updatedAt && now-millis(old.updatedAt)<2*DAY)
        changes.push("The source revision now reports "+nextSignal.category.toLowerCase()+".");
    }
    if (changes.length) addChange(observation.changes,"escalation",at,changes.join(" "),"rise:"+hash(changes.join("|")+"|"+received.updatedAt));
    if (!previouslySeen && domain && old.url!==received.url && !received.editorialType && !received.origin?.episode &&
        now-millis(before.firstSeenAt)>=15*MINUTE && millis(received.publishedAt)>=millis(before.firstSeenAt)-MINUTE)
      addChange(observation.changes,"coverage",at,"Another publisher, "+domain+", carried the matching report on a later scan. Syndication is possible.","outlet:"+domain);
    if (received.source==="USGS" && old.interest>0 && received.interest>=2*old.interest && received.interest-old.interest>=50)
      addChange(observation.changes,"interest",at,"USGS felt reports increased from "+old.interest+" to "+received.interest+".","felt:"+received.interest);
  }
  if (!before || old.updatedAt !== received.updatedAt || old.interest !== received.interest || !previouslySeen || observation.changes.length !== before.changes.length) observation.lastSeenAt=new Date(now).toISOString();
  observation.changes=observation.changes.slice(-24);
  return {...event,observations:observation};
}
