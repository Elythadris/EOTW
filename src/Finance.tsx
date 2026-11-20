import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Activity, ArrowUpRight, CalendarDays, ChartNoAxesCombined, ExternalLink, MessageCircle, RefreshCw } from "lucide-react";
import "./finance.css";

type Point = {date:string;value:number};
type Series = {symbol:string;label:string;unit:string;kind:"fx"|"rate";precision:number;source:string;sourceUrl:string;asOf:string;points:Point[];
  change:number|null;unitChange:string;comparison:{sample:number;exceeded:number;unusual:boolean;median:number}|null;narrative:string;stale:boolean;termsUrl?:string};
type Auction = {id:string;title:string;date:string;published:string;time:string|null;amount:number|null;url:string};
type Snapshot = {checkedAt:string;series:Series[];auctions:Auction[];sources:{name:string;url:string;status:"ok"|"unavailable"}[]};
type FinancialContext = {kind:"finance";symbol:string;label:string};
type Ask = (question:string,context?:FinancialContext)=>void;
const trading = [
  {label:"Bitcoin / USD",short:"BTC/USD",ticker:"BITSTAMP:BTCUSD",page:"BITSTAMP-BTCUSD",venue:"Bitstamp"},
  {label:"Apple",short:"AAPL",ticker:"NASDAQ:AAPL",page:"NASDAQ-AAPL",venue:"Nasdaq"},
  {label:"SPDR S&P 500 ETF Trust",short:"SPY",ticker:"AMEX:SPY",page:"AMEX-SPY",venue:"NYSE Arca"},
];
const dateLabel = (s:string) => new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"}).format(new Date(s.slice(0,10)+"T12:00:00Z"));
const number = (n:number,p:number) => n.toLocaleString(undefined,{minimumFractionDigits:p,maximumFractionDigits:p});
const changeLabel=(s:Series)=>s.change===null?"Previous observation unavailable":(s.change>0?"+":"")+number(s.change,s.kind==="rate"?1:3)+" "+s.unitChange;
const dollars=(n:number)=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",notation:"compact",maximumFractionDigits:2}).format(n);
function WebLink({href,children}:{href:string;children:React.ReactNode}) {
  return <a className="fin-link" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={13} aria-hidden="true"/></a>;
}
function Intraday() {
  const [selected,setSelected]=useState(0);
  const market=trading[selected];
  const config={symbol:market.ticker,interval:"15",timezone:"Etc/UTC",theme:"dark",style:"1",locale:"en",autosize:true,allow_symbol_change:false,
    hide_side_toolbar:true,hide_top_toolbar:false,hide_legend:false,hide_volume:false,save_image:false,withdateranges:true,
    backgroundColor:"#102330",gridColor:"rgba(116,153,162,0.17)"};
  const src="https://www.tradingview-widget.com/embed-widget/advanced-chart/?locale=en#"+encodeURIComponent(JSON.stringify(config));
  return <div className="fin-chartbody">
    <div className="fin-chart-heading"><div><span className="fin-eyeline">{market.venue} · 15-minute candles by default</span><h3>{market.label}</h3></div>
      <div className="fin-picks" role="group" aria-label="Intraday instrument">{trading.map((item,i)=><button key={item.ticker} aria-pressed={i===selected} onClick={()=>setSelected(i)}>{item.short}</button>)}</div>
    </div>
    <iframe className="fin-widget" key={market.ticker} src={src} title={market.label+" market chart by TradingView"} referrerPolicy="strict-origin-when-cross-origin"
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads" allowFullScreen/>
    <div className="fin-foot"><span>Intraday prices follow the provider’s session and exchange delay. Times shown in UTC.</span>
      <WebLink href={"https://www.tradingview.com/symbols/"+market.page+"/"}>Open {market.short} chart on TradingView</WebLink></div>
  </div>;
}
function ReferenceChart({series,onAsk}:{series:Series;onAsk:Ask}) {
  const [range,setRange]=useState(30),[position,setPosition]=useState<number|null>(null);
  const [hovered,setHovered]=useState<number|null>(null);
  const points=range?series.points.slice(-range):series.points;
  const at=Math.max(0,Math.min(points.length-1,hovered??position??points.length-1)), selected=points[at];
  const chartId=useId().replace(/[^a-z0-9]/gi,"");
  const values=points.map(p=>p.value), rawMin=Math.min(...values), rawMax=Math.max(...values);
  const padding=Math.max((rawMax-rawMin)*.09,series.kind==="rate"?.005:Math.abs(rawMax)*.00005,1e-7), top=rawMax+padding, bottom=rawMin-padding;
  const first=Date.parse(points[0].date),last=Date.parse(points.at(-1)!.date);
  const toX=(p:Point)=>last===first?50:1+98*(Date.parse(p.date)-first)/(last-first);
  const toY=(p:Point)=>100-(p.value-bottom)/(top-bottom)*100;
  const coords=points.map(p=>toX(p).toFixed(3)+","+toY(p).toFixed(3)).join(" ");
  const nearest=(element:SVGSVGElement,x:number)=>{
    const rect=element.getBoundingClientRect(); const f=100*(x-rect.left)/rect.width;
    return points.reduce((best,p,i)=>Math.abs(toX(p)-f)<Math.abs(toX(points[best])-f)?i:best,0);
  };
  return <section aria-label={series.label+" historical chart"}>
    <div className="fin-chart-heading"><div><span className="fin-eyeline">{series.source} · {series.asOf} {series.stale?" · older observation":""}</span>
      <h3>{series.label}</h3><div className="fin-quote"><strong>{number(series.points.at(-1)!.value,series.precision)}</strong><span>{series.unit}</span><b>{changeLabel(series)}</b></div>
      </div><div className="fin-picks" role="group" aria-label="Chart history length">{[[15,"15 obs."],[30,"30 obs."],[0,"All"]].map(([n,label])=>
        <button key={n} onClick={()=>{setRange(Number(n));setPosition(null);setHovered(null);}} aria-pressed={n===range}>{label}</button>)}</div></div>
    <div className="fin-plotrow"><div className="fin-y" aria-hidden="true"><span>{number(top,series.precision)}</span><span>{number((top+bottom)/2,series.precision)}</span><span>{number(bottom,series.precision)}</span></div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label={series.label+" from "+points[0].date+" to "+points.at(-1)!.date}
        onPointerMove={e=>{if(e.pointerType==="mouse")setHovered(nearest(e.currentTarget,e.clientX));}} onClick={e=>setPosition(nearest(e.currentTarget,e.clientX))} onPointerLeave={()=>setHovered(null)}>
        <defs><linearGradient id={"fin"+chartId} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#68c6b4" stopOpacity=".30"/><stop offset="1" stopColor="#68c6b4" stopOpacity=".01"/></linearGradient></defs>
        {[0,25,50,75,100].map(y=><line key={y} x1="0" x2="100" y1={y} y2={y} className="fin-gridline" vectorEffect="non-scaling-stroke"/>)}
        <polygon points={toX(points[0])+",100 "+coords+" "+toX(points.at(-1)!)+",100"} fill={"url(#fin"+chartId+")"}/>
        <polyline points={coords} fill="none" stroke="#98e1d1" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
        <line x1={toX(selected)} x2={toX(selected)} y1="0" y2="100" stroke="#b4c7c8" strokeDasharray="3 3" vectorEffect="non-scaling-stroke"/>
      </svg></div>
    <div className="fin-axis" aria-hidden="true"><span>{dateLabel(points[0].date)}</span><span>{dateLabel(points.at(-1)!.date)}</span></div>
    <label className="fin-reader"><span>Inspect observation</span><input aria-label={"Inspect "+series.label+" observation"} type="range" min="0" max={points.length-1} value={at} disabled={points.length<2}
      onChange={e=>{setHovered(null);setPosition(Number(e.target.value));}}/><output>{dateLabel(selected.date)} · {number(selected.value,series.precision)} {series.unit}</output></label>
    <p className="fin-reading">{series.narrative}</p>
    <div className="fin-foot"><WebLink href={series.sourceUrl}>Source observations</WebLink><button className="fin-ask" onClick={()=>onAsk("Explain the latest "+series.label+" observation, its measured change, and what evidence would help interpret it.",{kind:"finance",symbol:series.symbol,label:series.label})}><MessageCircle size={15}/>Ask about {series.symbol}</button></div>
    {series.symbol==="SOFR"&&<details className="fin-attrib"><summary>Source attribution and terms</summary><p>SOFR is subject to the <a href={series.termsUrl} target="_blank" rel="noreferrer">Terms of Use posted at newyorkfed.org</a>. The New York Fed is not responsible for publication of SOFR by EOTW, does not sanction or endorse any particular republication, and has no liability for your use. Comparison calculations are by EOTW.</p></details>}
  </section>;
}
export default function Finance({onAsk}:{onAsk:Ask}) {
  const [data,setData]=useState<Snapshot|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const [view,setView]=useState<"market"|"reference">("market"),[symbol,setSymbol]=useState("SOFR");
  const active=useRef<AbortController|null>(null);
  const refresh=useCallback(async()=>{
    active.current?.abort();const controller=new AbortController();active.current=controller;setBusy(true);
    try {
      const resp=await fetch("/api/finance",{signal:controller.signal,cache:"no-store"});
      const result=await resp.json() as Snapshot;
      if(!Array.isArray(result.series)||!Array.isArray(result.auctions)||!Array.isArray(result.sources)||!result.checkedAt)throw Error();
      if(controller.signal.aborted)return;
      if(!resp.ok)throw Error();
      setData(result);setError("");
    } catch { if(!controller.signal.aborted)setError("The latest reference data could not be retrieved."); }
    finally { if(!controller.signal.aborted)setBusy(false); }
  },[]);
  useEffect(()=>{
    void refresh();
    const check=()=>{if(!document.hidden)void refresh();};
    const timer=window.setInterval(check,300000);window.addEventListener("online",check);document.addEventListener("visibilitychange",check);
    return ()=>{clearInterval(timer);active.current?.abort();window.removeEventListener("online",check);document.removeEventListener("visibilitychange",check);};
  },[refresh]);
  const selected=data?.series.find(s=>s.symbol===symbol)||data?.series[0];
  const missing=data?.sources.filter(s=>s.status!=="ok").map(s=>s.name)||[];
  const auctionSource=data?.sources.find(s=>s.name==="TreasuryDirect");
  const choose=(id:string)=>{setSymbol(id);setView("reference");};
  return <div className="fin-page">
    <div className="fin-status"><span>{data?"Reference feeds checked "+new Date(data.checkedAt).toLocaleString(undefined,{month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"}):busy?"Reading official financial sources…":"Reference feeds unavailable"}</span>
      <button onClick={()=>void refresh()} disabled={busy} aria-label="Refresh financial data"><RefreshCw size={14}/>{busy?"Checking":"Refresh"}</button></div>
    {error&&<p className="fin-notice" role="status">{error}{data?" Showing the last response for this visit.":""}</p>}
    {missing.length>0&&<p className="fin-notice" role="status">Unavailable on this check · {missing.join(", ")}</p>}
    <section className="fin-card"><header className="fin-card-head"><h2><ChartNoAxesCombined size={19}/>Market charts</h2><div className="fin-picks" role="group" aria-label="Chart type">
      <button aria-pressed={view==="market"} onClick={()=>setView("market")}>Intraday markets</button><button aria-pressed={view==="reference"} onClick={()=>setView("reference")}>Rates &amp; FX</button></div></header>
      {view==="market"?<Intraday/>:<div className="fin-chartbody">
        <label className="fin-select">Reference series<select value={selected?.symbol||""} onChange={e=>setSymbol(e.target.value)} disabled={!selected}>
          {!selected&&<option value="">Awaiting observations</option>}{data?.series.map(s=><option key={s.symbol} value={s.symbol}>{s.label}</option>)}</select></label>
        {selected?<ReferenceChart key={selected.symbol} series={selected} onAsk={onAsk}/>:<p className="fin-empty">{busy?"Loading dated observations…":"No official series is available. Check source status or refresh."}</p>}
      </div>}
    </section>
    <div className="fin-lower">
      <section className="fin-card"><header className="fin-card-head"><h2><Activity size={18}/>Move monitor</h2></header>
        <p className="fin-method">A move is flagged when its size exceeds at least 19 of the previous 20 changes in the same series.</p>
        {data?.series.map(s=><button type="button" key={s.symbol} className="fin-move" onClick={()=>choose(s.symbol)}>
          <span><strong>{s.symbol}</strong><small>{s.asOf}{s.stale?" · older observation":""}</small></span>
          <span className="fin-move-value">{changeLabel(s)}<small className={s.comparison?.unusual?"fin-unusual":""}>{!s.comparison?"History incomplete":s.comparison.unusual?"Unusually large move":"Within recent range"}</small></span><ArrowUpRight size={15}/></button>)}
        {!data?.series.length&&<p className="fin-empty">{busy?"Fetching observations…":"No observations available for comparison."}</p>}
      </section>
      <section className="fin-card"><header className="fin-card-head"><h2><CalendarDays size={18}/>Treasury auctions</h2>
        <WebLink href="https://www.treasurydirect.gov/auctions/upcoming/">Calendar</WebLink></header>
        <p className="fin-method">Announced competitive bidding deadlines · Eastern Time</p>
        {(data?.auctions||[]).slice(0,5).map(a=><article key={a.id} className="fin-auction"><time dateTime={a.date}>{new Intl.DateTimeFormat("en-US",{month:"short",day:"2-digit",timeZone:"UTC"}).format(new Date(a.date+"T12:00:00Z"))}</time>
          <div><h3>{a.title}</h3><p>{a.time||"Time unavailable"}{a.amount?" · "+dollars(a.amount)+" offered":""}</p><small>CUSIP {a.id}</small></div></article>)}
        {!data?.auctions.length&&<p className="fin-empty">{busy?"Reading TreasuryDirect…":auctionSource?.status==="ok"?"TreasuryDirect lists no upcoming announcements.":"Auction schedule unavailable."}</p>}
      </section>
    </div>
    <section className="fin-card"><header className="fin-card-head"><h2><MessageCircle size={18}/>Financial claims</h2></header>
      <div className="fin-claims"><p>Search published reports and tracked narratives about financial disruptions. Open a report to inspect its sources. A price change alone cannot establish manipulation.</p>
        <nav aria-label="Search financial coverage"><a className="fin-link" href="/archive?q=market%20manipulation">Search manipulation reports <ArrowUpRight size={14}/></a><a className="fin-link" href="/rabbit-hole?q=bank%20failure">Explore bank-failure claims <ArrowUpRight size={14}/></a></nav>
      </div>
    </section>
    <footer className="fin-cadence"><ExternalLink size={14} aria-hidden="true"/><span>SOFR and ECB reference rates are published on business days. EOTW checks the reference feeds every five minutes while this page is visible.</span></footer>
  </div>;
}

