import { useMemo, useState } from "react";
import { Activity, ArrowUpRight, BookOpen, ChevronRight, Compass, Crosshair, Globe2, MapPin, Network, Radar, Radio, ScanLine, Telescope, TrendingUp, TriangleAlert } from "lucide-react";
import EventMap from "./EventMap";
import { NoItems, Skeleton } from "./components";
import { useFeed, useSituation, type PrefsState } from "./data";
import { ClaimReview, OpsPanel, StoryLink, StoryReview } from "./Operations";
import { dateTime, relative, sourceURL, type BriefPoint, type Feed, type IntelEvent, type Page, type Scope, type Situation } from "./types";

type Props = {data: Feed; busy:boolean; state:PrefsState; open:(e:IntelEvent)=>void; save:(e:IntelEvent)=>void; go:(page:Page)=>void; setLocation:()=>void; ask:()=>void};
function Cite({point,report}:{point:BriefPoint;report:Situation}){
  return <>{point.citationIds.map((id,i)=>{
    const c=report.citations.find(ref=>String(ref.id)===String(id));
    return c && sourceURL(c.url)?<a key={id+i} className="point-cite" href={sourceURL(c.url)} target="_blank" rel="noreferrer" aria-label={"Source "+c.id+" · "+c.title} title={c.source+" · "+c.title}>[{c.id}]</a>:null;
  })}</>;
}
function BriefSection({name,points,report}:{name:string;points:BriefPoint[];report:Situation}){
  if(!points.length)return null;
  return <section className="brief-section"><h3>{name}</h3><ul>{points.slice(0,1).map((p,i)=><li key={i}>{p.text} <Cite point={p} report={report}/></li>)}</ul>
    {points.length>1&&<details className="brief-more"><summary>More {name.toLowerCase()}</summary><ul>{points.slice(1).map((p,i)=><li key={i}>{p.text} <Cite point={p} report={report}/></li>)}</ul></details>}
  </section>;
}
const regionNames={local:"Local",us:"United States",global:"Global"};
function ShowLinked({ids,events,open}:{ids:string[];events:IntelEvent[];open:(e:IntelEvent)=>void}){
  const matches=ids.flatMap(id=>{const e=events.find(e=>e.id===id);return e?[e]:[]});
  return <ul className="linked-events">{matches.map(e=><li key={e.id}><StoryLink event={e} open={open}/></li>)}{ids.filter(id=>!matches.some(e=>e.id===id)).map(id=><li key={id}><a href={"/story/"+encodeURIComponent(id)}>Open linked report<ArrowUpRight size={12}/></a></li>)}</ul>;
}
export default function Briefing({data,busy,state,open,save,go,setLocation,ask}:Props){
  const {prefs}=state;
  const intel=data.intelligence;
  const last=intel?.lastScan;
  const known=!!last;
  const where=prefs.location;
  const situation=useSituation(where);
  const hot=useFeed({view:"trending",scope:"all",location:where,limit:"4"});
  const claims=useFeed({view:"rabbit",scope:"all",location:where,limit:"2"});
  const [scope,setScope]=useState<Scope>("all");
  const [limit,setLimit]=useState(4);
  const signals=data.events;
  const filtered=scope==="all"?signals:signals.filter(e=>e.scope===scope);
  const recent=situation.report;
  const lead=signals[0];
  const ok=data.health.filter(s=>s.status==="ok").length;
  const failures=data.health.filter(s=>s.status==="error").length;
  const enabled=data.health.filter(s=>s.status!=="disabled").length;
  const disabled=data.health.filter(s=>s.status==="disabled").length;
  const regions=useMemo(()=>(["local","us","global"] as const).map(key=>intel?.regions?.find(r=>r.scope===key)||{scope:key,level:"unknown" as const,reason:"No source scan is available for this area.",eventIds:[] as string[]}),[intel]);
  const choose=(s:Scope)=>{setScope(s);setLimit(4)};
  const action=(label:string,fn:()=>void)=><button className="panel-action" onClick={fn}>{label}<ChevronRight size={14}/></button>;
  return <div className="ops">
    <div className="monitor-bar" aria-label="Scan telemetry">
      <button onClick={()=>go("health")}><span><Radio size={14}/>Source health</span><strong>{data.health.length?ok+" / "+enabled:"—"}</strong><small>{failures?failures+" unavailable":disabled?disabled+" disabled":"Reporting sources"}</small></button>
      <div><span><ScanLine size={14}/>Last successful scan</span><strong className="time-number" title={dateTime(last)}>{last?relative(last):"Pending"}</strong><small>{last?dateTime(last):"Awaiting collector"}</small></div>
      <div><span><Crosshair size={14}/>Priority signals</span><strong>{known?signals.length:"—"}</strong><small>{known?intel!.scanned+" records scanned":"Awaiting scan"}</small></div>
      <div><span><TriangleAlert size={14}/>Active alerts</span><strong className={known&&intel!.alerts>0?"warn-number":""}>{known?intel!.alerts:"—"}</strong><small>Currently in force</small></div>
    </div>
    <div className="ops-lead-grid">
      <OpsPanel title="Situation briefing" icon={<BookOpen size={19}/>} className="situation-panel" action={action("Ask analyst",ask)}>
        <div className="narrative">
          <div className="brief-metadata"><span className="brief-mode">{recent?.mode==="ai"?"AI assessment":"Source assessment"}</span>{recent?.generatedAt&&<time dateTime={recent.generatedAt} title={dateTime(recent.generatedAt)}>{relative(recent.generatedAt)}</time>}</div>
          {recent && Object.values(recent.sections).some(points=>points.length)?<>
            <BriefSection name="What happened" points={recent.sections.whatHappened} report={recent}/>
            <BriefSection name="Why it matters" points={recent.sections.whyItMatters} report={recent}/>
            <BriefSection name="Monitor next" points={recent.sections.whatToMonitor} report={recent}/>
          </>:lead?<><section className="brief-section"><h3>What happened</h3><h4><StoryLink event={lead} open={open}/></h4><p>{lead.summary||lead.source}</p></section>
            {lead.intelligence&&<><section className="brief-section"><h3>Why it matters</h3><p>{lead.intelligence.why}</p></section><section className="brief-section"><h3>Monitor next</h3><p>{lead.intelligence.monitor}</p></section></>}
            {sourceURL(lead.url)&&<a className="brief-source" href={sourceURL(lead.url)} target="_blank" rel="noreferrer">{lead.source}<ArrowUpRight size={13}/></a>}
          </>:busy||situation.loading?<Skeleton/>:<NoItems title={known?"No significant developments detected":"Awaiting published reports"} detail={known?"The latest scan found no qualifying signals. Source health shows the coverage available.":"The first successful scan will establish the regional briefing."}/>}
          {recent?.notice&&<p className="brief-notice">{recent.notice}</p>}
          {(recent?.stale||situation.error)&&<p className="brief-notice">{recent?"Showing the last available assessment.":lead?"Showing the lead source assessment while the compiled briefing is unavailable.":"The compiled briefing is unavailable."}</p>}
        </div>
      </OpsPanel>
      <OpsPanel title="Intelligence map" icon={<Radar size={20}/>} className="ops-map" action={action("Explore map",()=>go("map"))}>
        <EventMap events={signals} onSelect={open} compact scanAt={last}/>
      </OpsPanel>
    </div>
    <OpsPanel title="Threat scanner" icon={<ScanLine size={19}/>} className="scanner-panel" action={action(where,setLocation)}>
      <div className="regions">{regions.map(r=>{
        const RegionIcon=r.scope==="local"?MapPin:r.scope==="us"?Compass:Globe2;
        const position=["quiet","watch","elevated","high"].indexOf(r.level);
        return <div className={"region-cell tone-"+r.level} key={r.scope}>
          <div className="region-title"><RegionIcon size={16}/><h3>{r.scope==="local"?where:regionNames[r.scope]}</h3>{r.scope==="local"&&<span>Local</span>}</div>
          <div className="region-state"><strong>{r.level==="unknown"?"Unknown":r.level}</strong><div className="meter" aria-hidden="true">{[0,1,2,3].map(i=><i key={i} className={position>=i?"filled":""}/>)}</div></div>
          <p>{r.reason}</p>
          {r.eventIds.length>0&&<button className="text-action" onClick={()=>{choose(r.scope);requestAnimationFrame(()=>document.getElementById("priority-signals")?.scrollIntoView({block:"start"}))}}>Review signals <ChevronRight size={13}/></button>}
        </div>
      })}</div>
    </OpsPanel>
    <div className="ops-stream-grid">
      <div id="priority-signals"><OpsPanel title="Priority signals" icon={<Crosshair size={19}/>} count={known?signals.length:undefined}>
        <div className="signal-filters" role="group" aria-label="Priority signal coverage">{(["all","local","us","global"] as const).map(s=><button key={s} aria-pressed={scope===s} onClick={()=>choose(s)}>{s==="all"?"All areas":regionNames[s]}</button>)}</div>
        {filtered.length?filtered.slice(0,limit).map(e=><StoryReview key={e.id} event={e} open={open} saved={prefs.saved.includes(e.id)} save={()=>save(e)}/>):busy?<Skeleton/>:<NoItems title={known?"No qualifying signals in this area":"Signal scan pending"} detail={known?"New or escalating developments appear here when the available evidence meets the threshold.":"Collection and source status are available above."}/>}
        {filtered.length>limit&&<button className="load-more" onClick={()=>setLimit(v=>v+6)}>Show more signals</button>}
      </OpsPanel></div>
      <aside className="ops-side">
        <OpsPanel title="Escalation monitor" icon={<TrendingUp size={18}/>} count={known?intel!.escalations.length:undefined}>
          {intel?.escalations.length?<div className="scan-log">{intel.escalations.map((x,i)=><div key={x.eventId+i}><time dateTime={x.at}>{relative(x.at)}</time><p>{x.description}</p><ShowLinked ids={[x.eventId]} events={signals} open={open}/></div>)}</div>:<p className="quiet-note">{known?"No material escalation was recorded in the current scan.":"Waiting for comparison data."}</p>}
        </OpsPanel>
        <OpsPanel title="Anomaly detection" icon={<Activity size={18}/>} count={known?intel!.anomalies.length:undefined}>
          {intel?.anomalies.map((x,i)=><article className="anomaly" key={i}><h3>{x.label}</h3><p>{x.description}</p><small>Baseline confidence · {x.confidence}</small><ShowLinked ids={x.eventIds} events={signals} open={open}/></article>)}
          {!intel?.anomalies.length&&<p className="quiet-note">{known?"No anomalies meet the current evidence threshold.":"Baseline comparison pending."}</p>}
          {intel?.baselineNote&&<details className="baseline"><summary>Baseline coverage</summary><p>{intel.baselineNote}</p></details>}
        </OpsPanel>
        <OpsPanel title="Related signals" icon={<Network size={18}/>} initiallyOpen={false} count={known?intel!.related.length:undefined}>
          {intel?.related.length?intel.related.map((group,i)=><div className="anomaly" key={i}><p>{group.reason}</p><ShowLinked ids={group.eventIds} events={signals} open={open}/></div>):<p className="quiet-note">No documented relationships are available for this scan.</p>}
        </OpsPanel>
      </aside>
    </div>
    <div className="ops-bottom-grid">
      <OpsPanel title="Hot 24" icon={<TrendingUp size={18}/>} action={action("View all",()=>go("trending"))}>
        {hot.data.events.length?hot.data.events.slice(0,3).map((e,i)=><div className="hot-line" key={e.id}><span>{String(i+1).padStart(2,"0")}</span><div><StoryLink event={e} open={open}/><small>{e.rankReasons?.[0]||e.source}</small></div></div>):hot.busy?<Skeleton/>:<p className="quiet-note">{hot.error?"The Hot 24 index is unavailable.":"No reports currently qualify for Hot 24."}</p>}
      </OpsPanel>
      <OpsPanel title="Rabbit hole" icon={<Telescope size={18}/>} action={action("View claims",()=>go("rabbit"))}>
        {claims.data.events[0]?<ClaimReview event={claims.data.events[0]} open={open} saved={prefs.saved.includes(claims.data.events[0].id)} save={()=>save(claims.data.events[0])}/>:claims.busy?<Skeleton/>:<p className="quiet-note">{claims.error?"The claim tracker is unavailable.":"No indexed narratives in the current coverage window."}</p>}
      </OpsPanel>
    </div>
  </div>;
}
