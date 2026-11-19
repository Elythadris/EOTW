import { DAY, HOUR } from "./model.mjs";
import { incidentKey } from "./detection.mjs";

const series = {
  usgs: { label: "USGS earthquakes of magnitude 4.5+", accepts: e => Number.isFinite(e.origin?.magnitude) && e.origin.magnitude>=4.5 },
  "nws-us": {label:"U.S. severe or extreme NWS warning episodes",accepts:e=>e.origin?.episode && e.origin.issued && /\bwarning\b/i.test(e.origin.event) && ["Severe","Extreme"].includes(e.origin.severity)},
  "nws-hi": {label:"Hawaiʻi NWS warning episodes",accepts:e=>e.origin?.episode && e.origin.issued && /\bwarning\b/i.test(e.origin.event)},
};
const dateKey = time => new Date(time).toISOString().slice(0,10);
const bits = n => { let count=0; while(n){count+=n&1;n>>=1;} return count; };
const median = numbers => {
  const values=[...numbers].sort((a,b)=>a-b);
  return (values[Math.floor((values.length-1)/2)] + values[Math.floor(values.length/2)])/2;
};
function daySeries() {
  return { slots:Array(24).fill(0), counts:Array(24).fill(0), seen:[], samples:[] };
}
// Slot masks are recorded only for successful checks. Missing data remains missing.
export function addPoll(state,provider,now,events,continuous) {
  const kind=series[provider];
  if (!kind) return;
  const today=dateKey(now), date=new Date(now), hour=date.getUTCHours();
  state.baselineDays ||= {};
  const days=state.baselineDays;
  for (const key of Object.keys(days)) {
    if(key<dateKey(now-21*DAY)) delete days[key];
    else if(key<today) for(const row of Object.values(days[key])) { delete row.seen;delete row.samples; }
  }
  days[today] ||= {};
  const row=days[today][provider] ||= daySeries();
  if(!continuous) return;
  row.slots[hour] |= 1 << Math.floor(date.getUTCMinutes()/5);
  const seen=new Set(row.seen || []);
  for(const e of events) {
    if (!kind.accepts(e)) continue;
    const key=incidentKey(e);
    // Exclude backlog, first-sync batches, revisions of old incidents, and date-boundary replay.
    const born=Date.parse(e.origin?.incidentStart || e.publishedAt);
    if (!Number.isFinite(born) || born>now+60000 || now-born>15*60000 || dateKey(born)!==today || seen.has(key)) continue;
    const eventHour=new Date(born).getUTCHours();
    seen.add(key);
    row.counts[eventHour]++;
    row.samples.push({id:e.id,hour:eventHour});
  }
  row.seen=[...seen];
  row.samples=row.samples.slice(-80);
}
export function anomaliesFor(state,now,health) {
  const days=state.baselineDays || {};
  const today=dateKey(now), completed=new Date(now).getUTCHours();
  const anomalies=[];
  let best=0,ready=0;
  const activeHealth=new Set(health.filter(h=>h.status==="ok").map(h=>h.id));
  for(const [name,kind] of Object.entries(series)) {
    const current=days[today]?.[name];
    const history=Object.keys(days).filter(d=>d<today && d>=dateKey(now-14*DAY))
      .map(d=>days[d][name]).filter(d=>d?.slots?.length===24 && d.slots.every(mask=>bits(mask)>=10));
    best=Math.max(best,history.length);
    if(!activeHealth.has(name) || history.length<7 || !current || completed<3 || current.slots.slice(0,completed).some(mask=>bits(mask)<10)) continue;
    ready++;
    const total=row=>row.counts.slice(0,completed).reduce((a,b)=>a+b,0);
    const numbers=history.map(total), center=median(numbers), mad=median(numbers.map(n=>Math.abs(n-center)));
    const value=total(current), threshold=center+Math.max(3,3*1.4826*mad,2*Math.sqrt(center+1));
    if(value<4 || value<threshold || value<2*Math.max(1,center)) continue;
    anomalies.push({label:kind.label,description:value+" new episodes in the first "+completed+" complete UTC hours versus a median of "+center+" across "+history.length+" adequately sampled days. This is an increase in observed records.",
      eventIds:[...new Set((current.samples || []).filter(s=>s.hour<completed).map(s=>s.id))].slice(-6),
      confidence:history.length>=12?"high":"moderate"});
  }
  let baselineNote=ready ? "Comparisons use matched UTC hours and well-covered prior days. Counts describe monitored reports, not a forecast or a probability." :
    best<7 ? "Baseline warming up: "+best+" of 7 required complete, adequately sampled UTC days for the best-covered series." :
    "No comparable window yet. Each series needs three completed UTC hours today, recent source health and at least 10 of 12 checks in every compared hour.";
  return {anomalies,baselineNote};
}
