// Research alternatives for a single public report. Matching a subject opens a question;
// only a separately matched passage can appear under evidence for or against it.
const idea = (id, label, explanation, test, clues) => ({id,label,explanation,test,clues});
const profiles = [
  {
    applies:/\b(?:aircraft|airliner|plane|helicopter|aviation)\b/i,
    context:/\b(?:crash(?:es|ed)?|accidents?|emergency landings?|groundings?|collisions?)\b/i,
    unknown:"Which contributing factors have investigators established, and which are still being examined?",
    ideas:[
      idea("air-conditions","Weather or visibility","Weather or limited visibility could have contributed if conditions at the reported time impaired the flight.","Compare the investigator’s published weather observations with the official sequence of events.",/\b(?:visibility|icing|crosswind|wind shear|thunderstorm|fog|turbulence)\b/i),
      idea("air-equipment","Equipment or maintenance","An equipment problem is a possible explanation if inspection identifies a relevant failure before the incident.","Look for findings on pre-incident component condition in the accident authority’s report.",/\b(?:engine failure|component failure|hydraulic failure|failed component|faulty part|mechanical fault)\b/i),
      idea("air-operations","Procedures or communication","A procedural or communication issue is an alternative if the published investigation identifies a discrepancy in the sequence.","Check the authority’s published safety findings and recommendations. The incident alone does not establish fault.",/\b(?:procedure deviation|communication breakdown|miscommunication|procedural error)\b/i),
    ],
  },
  {
    applies:/\b(?:cyber(?:attack|security)?|ransomware|data breach|network intrusion)\b/i,
    unknown:"Which systems or public services does the operator confirm were affected, and is the initiating cause established?",
    ideas:[
      idea("cyber-containment","Precautionary shutdown","Part of the disruption could reflect the operator isolating services as a precaution.","Look for the operator’s distinction between direct damage, planned isolation and restored service.",/\b(?:as a precaution|precautionary|isolated systems|voluntarily suspended|containment)\b/i),
      idea("cyber-interruption","Direct service interruption","The incident itself could have interrupted service before the response began.","Compare the published onset of service loss with the operator’s response timeline.",/\b(?:unavailable|service disruption|interrupted|encrypted|loss of service|data loss)\b/i),
    ],
  },
  {
    applies:/\b(?:flood|flooding|rainfall|river discharge)\b/i,
    unknown:"How do measured conditions compare with the forecast in each affected area?",
    ideas:[
      idea("water-runoff","Runoff from recent rainfall","If runoff is still moving into the basin, water levels could rise after local rain eases.","Compare time-stamped rain and river-gauge observations with the next official forecast.",/\b(?:heavy rain(?:fall)?|accumulated rain|runoff|rainfall amounts|rain has|rainfall has)\b/i),
      idea("water-forecast","Additional forecast rainfall","Further flooding could depend on whether additional forecast rain actually falls.","Check observed rainfall and whether the next warning revises the crest, affected area or end time.",/\b(?:expected rainfall|rain(?:fall)? is expected|forecast rain|rain.*forecast|rainfall.*redevelop)\b/i),
      idea("water-coast","Coastal water levels","If the event is coastal, tide or surge could alter the timing and extent of inundation.","Check the agency’s coastal gauge readings and tide or surge forecast.",/\b(?:coastal flood|tide|tidal|surge)\b/i),
    ],
  },
  {
    applies:/\b(?:earthquake|seismic|usgs|magnitude)\b/i,
    unknown:"What effects have local authorities verified beyond the instrumental estimate?",
    ideas:[
      idea("quake-revision","Revised instrument estimate","New stations or reviewed measurements could account for a change in estimated magnitude or depth.","Compare the agency’s revision history and event identifier.",/\b(?:preliminary|reviewed|revised|magnitude|depth)\b/i),
      idea("quake-impact","Uneven local impact","Local shaking and exposure could explain why impacts differ across the reported area.","Compare the official shaking or impact assessment with attributed local damage reports.",/\b(?:shaking|felt reports?|impact estimate|damage|exposure)\b/i),
    ],
  },
  {
    applies:/\b(?:wildfire|storm|tornado|cyclone|hurricane|weather|tsunami|volcanic|volcano|landslide|natural event)\b/i,
    unknown:"Has a change in hazard intensity been measured, or has the published forecast or affected area changed?",
    ideas:[
      idea("hazard-change","Changing physical conditions","A measured change in the hazard could account for a new or extended notice.","Compare the issuing agency’s observations and the two notice periods.",/\b(?:measured|observed|intensif\w*|winds?|burned|lava|monitoring station|increased)\b/i),
      idea("hazard-revision","Revised coverage or forecast","New observations or forecast revisions could change the area covered without establishing a new incident.","Compare the public notice identifiers, boundaries and forecast language.",/\b(?:revis\w*|forecast|updated|expanded|extended|warning area)\b/i),
    ],
  },
  {
    applies:/\b(?:outage|infrastructure|electricity|rail|telecom|water service|transport disruption|bridge closure)\b/i,
    unknown:"What initiated the disruption, and which services remain affected?",
    ideas:[
      idea("utility-failure","Local equipment or service failure","A fault confined to one part of the service could explain an initial disruption.","Check whether the operator identifies a component fault and restores the affected service.",/\b(?:equipment|fault|failure|repair|damaged|breakdown)\b/i),
      idea("utility-dependency","An external service dependency","Loss of power, supply or another service could have prolonged the disruption.","Compare public restoration statements from the operator and its service providers.",/\b(?:supply|upstream|power loss|lost power|dependency|supplier)\b/i),
    ],
  },
  {
    applies:/\b(?:bank|regulator|capital controls|financial|exchange|withdrawals?|economic disruption|sovereign default)\b/i,
    unknown:"Which restrictions are binding, for whom, and for how long?",
    ideas:[
      idea("finance-temporary","A temporary precaution","A time-limited restriction could be intended to stabilize access while conditions are reviewed.","Check the regulator’s published terms, effective dates and restart criteria.",/\b(?:temporary|precaution|halt|suspend|review)\b/i),
      idea("finance-stress","Longer-lived financial stress","Persistent funding or settlement problems could keep restrictions in place.","Check the regulator’s next public assessment and any change in the duration or scope of restrictions.",/\b(?:liquidity|insolven\w*|funding|default|settlement)\b/i),
    ],
  },
  {
    applies:/\b(?:conflict|humanitarian|ceasefire|diploma\w*|military|geopolitical|border|politic\w*|government|legislati\w*|curfew|policy|parliament|election)\b/i,
    unknown:"Which announced actions have been implemented, and what civilian or diplomatic effects are documented?",
    ideas:[
      idea("policy-implementation","Implementation on the ground","A formal decision could change civilian access or public services if implementing measures take effect.","Check effective dates, public implementation orders and independently attributed civilian outcomes.",/\b(?:effective|enacted|signed|in force|implemented|closed|halted|displaced|suspended)\b/i),
      idea("policy-announcement","An announcement before implementation","The report may describe a proposal, negotiation or announcement whose actual effects remain unsettled.","Compare the announcement with the final text and subsequent public implementation reports.",/\b(?:proposal|proposed|talks|negotiat\w*|announcement|draft|planned)\b/i),
    ],
  },
  {
    applies:/\b(?:outbreak|public health|recall|advisory|drinking water|water safety|food safety)\b/i,
    unknown:"What exposure and affected group have the issuing authorities confirmed?",
    ideas:[
      idea("health-precaution","Precautionary guidance","A protective notice may have been issued before the extent of exposure was known.","Check the issuing authority’s stated basis and its follow-up sampling or surveillance results.",/\b(?:precaution|possible exposure|suspected|pending results|advisory)\b/i),
      idea("health-observation","A documented change in exposure","Additional verified observations could account for a change in guidance.","Compare successive official notices and the evidence each notice cites.",/\b(?:confirmed|tested positive|sample|laboratory|verified exposure)\b/i),
    ],
  },
  {
    applies:/\b(?:ufo|uap|unidentified|unexplained|claim coverage|conspiracy|qanon|allegation|rumou?r)\b/i,
    unknown:"Is the originating material available, and does an independent public source verify the interpretation?",
    ideas:[
      idea("claim-context","Missing context","A partial description, image or measurement could allow several interpretations of the same observation.","Look for the original dated material, full context and a published independent analysis.",/\b(?:partial|limited data|incomplete|misidentif\w*|unclear|context)\b/i),
      idea("claim-instrument","An instrument or recording artifact","An identified instrument limitation could explain part of an unusual observation. The relevant technical findings must connect it to this record.","Check published calibration findings and the original recording for a documented artifact.",/\b(?:sensor error|instrument error|calibration error|recording artifact|sensor artifact)\b/i),
      idea("claim-recirculation","Recirculation of an earlier claim","Renewed discussion could reflect circulation of an older account rather than new evidence.","Check the earliest publication date and whether later reports add independently obtained evidence.",/\b(?:recirculat\w*|repost\w*|resurfac\w*|older|previously published|archival)\b/i),
    ],
  },
];
const general = {
  unknown:"What independent documentation confirms the scope, timing and underlying cause?",
  ideas:[
    idea("new-development","A material development","The report could reflect a new development if it documents a change from the preceding public account.","Compare the newest dated source with the prior version for changed facts or decisions.",/\b(?:revised|first confirmed|announced|ordered|new findings|expanded)\b/i),
    idea("reporting-revision","A change in reporting","Additional coverage could reflect revised wording or fuller documentation of an existing event.","Check whether the source identifies a new occurrence or a revision to an earlier account.",/\b(?:update|revised|clarified|previous|reissue|correction)\b/i),
  ],
};

export const reviewOfInterference = idea("attributed-inquiry","An explicitly reported inquiry",
  "The cited public material establishes that an inquiry was reported. Deliberate interference is one question under review. An inquiry does not identify a cause or establish responsibility.",
  "Look for a public finding from the investigating authority that substantiates or rules out interference.",
  /\b(?:sabotage|interference|intelligence operation|covert operation)\b/i);

export function investigationProfile(event) {
  const scope = [event.intelligence?.category, event.category, event.title, event.summary].join(" ");
  if (event.topicClaim || event.status === "speculation") return profiles.at(-1);
  return profiles.find(item => item.applies.test(scope) && (!item.context || item.context.test(scope))) || general;
}
