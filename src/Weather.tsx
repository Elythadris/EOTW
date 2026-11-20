import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, ArrowUpRight, Cloud, CloudLightning, CloudRain, Compass, LocateFixed, MapPin, Minus, Plus, Radio, Search, Sun, Thermometer, Wind } from "lucide-react";
import "./weather.css";

type Place={label:string;latitude:number;longitude:number};
type Hour={time:string;temp:number;wind:number|null;direction:number|null;rain:number|null;humidity:number|null;pressure:number|null;symbol:string};
type Day={date:string;low:number;high:number;wind:number|null;symbol:string};
type Forecast={issuedAt:string;hours:Hour[];days:Day[]};
type Alert={title:string;headline:string;area:string;severity:string;end:string|null;issued:string|null;instructions:string;url:string};
type Storm={name:string;source:string;at:string;windKnots:number|null;latitude:number;longitude:number;track:[number,number][];url:string};
type Source<T>={status:"ok"|"unavailable"|"regional";data:T|null};
type Zoom="close"|"regional"|"wide";
type Station={station:string;label:string;at:string;distance:number;temp:number;windKnots:number|null;url:string};
type AviationAlert={id:string;title:string;area:string;raw:string;issued:string;end:string;url:string};
type WeatherData={station:Source<Station>;airspace:Source<AviationAlert[]>;point:{latitude:number;longitude:number};checkedAt:string;forecast:Source<Forecast>&{url:string};alerts:Source<Alert[]>&{url:string};nhc:Source<Storm[]>;eonet:Source<Storm[]>;radar:Source<string[]>&{region:string|null};satelliteDates:string[];bounds:Record<Zoom,[number,number,number,number]>};
type WeatherContext={kind:"weather";latitude:number;longitude:number;label:string};
type Props={location:string;onAsk:(question:string,context:WeatherContext)=>void};
type Layer="satellite"|"radar"|"storms";
const layers:Layer[]=["satellite","radar","storms"];
const names:Record<Layer,string>={satellite:"Satellite",radar:"Radar",storms:"Storm tracks"};
const zooms:Zoom[]=["wide","regional","close"];
const formats=new Intl.DateTimeFormat(undefined,{timeZone:"UTC",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const timestamp=(s:string)=>formats.format(new Date(s))+" UTC";
const shortHour=(s:string)=>s.slice(11,16);
function symbol(code:string) {
  const raw=(code||"").split("_")[0];
  if(!raw)return "Condition unavailable";
  const parts=raw.replace(/andthunder/g," and thunder").replace(/showers/g," showers").replace(/(light|heavy|partly|clear|fair)(?=[a-z])/g,"$1 ").replace(/(rain|sleet|snow)(?=and)/g,"$1 ");
  const label=parts==="clearsky"?"Clear sky":parts.trim();
  return label[0].toUpperCase()+label.slice(1);
}
function Condition({code,size=28}:{code:string;size?:number}) {
  const Icon=code.includes("thunder")?CloudLightning:/rain|sleet|snow/.test(code)?CloudRain:/clearsky|fair/.test(code)?Sun:Cloud;
  return <Icon size={size} aria-hidden="true"/>;
}
function temp(c:number,unit:"C"|"F"){return Math.round(unit==="F"?c*9/5+32:c)+"°";}
function wind(m:number|null,unit:"C"|"F"){return m===null?"Unavailable":unit==="F"?Math.round(m*2.237)+" mph":Math.round(m*3.6)+" km/h";}
function WeatherMap({data,place,storms,layer,setLayer}:{data:WeatherData;place:Place;storms:Storm[];layer:Layer;setLayer:(l:Layer)=>void}) {
  const [zoom,setZoom]=useState<Zoom>("regional");
  const [frame,setFrame]=useState(0),[playing,setPlaying]=useState(false);
  const [failed,setFailed]=useState("");
  const frames=layer==="satellite"?data.satelliteDates:layer==="radar"?[...(data.radar.data||[])].reverse():[];
  useEffect(()=>{if(!playing||layer!=="radar"||frames.length<2)return;
    const timer=window.setInterval(()=>setFrame(i=>(i-1+frames.length)%frames.length),950);
    return()=>window.clearInterval(timer);},[playing,layer,frames.length]);
  const frameIndex=Math.min(frame,Math.max(0,frames.length-1)),at=frames[frameIndex]||"";
  const params=new URLSearchParams({view:"image",lat:String(place.latitude),lon:String(place.longitude),zoom});
  const base="/api/weather?"+params.toString()+"&layer=base";
  const overlay=layer==="storms"||!at?"":"/api/weather?"+params.toString()+"&layer="+layer+"&at="+encodeURIComponent(at);
  const [w,s,e,n]=data.bounds[zoom];
  const x=(lon:number)=>(lon-w)*768/(e-w),y=(lat:number)=>(n-lat)*384/(n-s);
  const inFrame=(lon:number,lat:number)=>lon>=w&&lon<=e&&lat>=s&&lat<=n;
  const mk=[x(place.longitude),y(place.latitude)];
  const dateLabel=at?(layer==="satellite"?at+" UTC":timestamp(at)):"";
  return <section className="wx-panel wx-map" aria-label="Weather imagery">
    <header className="wx-panel-head"><h2><Compass size={18}/> Weather map</h2>
      <div className="wx-switch" role="group" aria-label="Weather map layers">{layers.map(l=><button key={l} type="button" aria-pressed={l===layer} onClick={()=>{setPlaying(false);setLayer(l);setFrame(0);setFailed("");}}>{names[l]}</button>)}</div>
    </header>
    <div className="wx-map-image">
      <img src={base} alt="" className="wx-layer" onError={()=>setFailed(base)} />
      {overlay&&failed!==overlay&&<img src={overlay} className="wx-layer" alt={names[layer]+" imagery centered on "+place.label} onError={()=>setFailed(overlay)}/>}
      <svg viewBox="0 0 768 384" preserveAspectRatio="none" aria-hidden="true" className="wx-map-vectors">
        {layer==="storms"&&storms.map(storm=><g key={storm.source+storm.name}>
          {storm.track.slice(1).map(([lon,lat],i)=>{const [pLon,pLat]=storm.track[i];return Math.abs(lon-pLon)<180?<line key={i} x1={x(pLon)} y1={y(pLat)} x2={x(lon)} y2={y(lat)} stroke="#ffd18a" strokeWidth="2.5" vectorEffect="non-scaling-stroke"/>:null;})}
          {inFrame(storm.longitude,storm.latitude)&&<circle cx={x(storm.longitude)} cy={y(storm.latitude)} r="7" fill="#ffbe76" stroke="#152a38" strokeWidth="2"/>}
        </g>)}
        <path d={`M${mk[0]-11} ${mk[1]}h22M${mk[0]} ${mk[1]-11}v22`} stroke="#10222d" strokeWidth="4"/>
        <circle cx={mk[0]} cy={mk[1]} r="7" stroke="#fff" strokeWidth="2" fill="none"/>
      </svg>
      <span className="wx-map-label"><MapPin size={13}/>{place.label.split(",")[0]}</span>
      <div className="wx-zoom" aria-label="Map extent"><button aria-label="Zoom out weather map" disabled={zoom==="wide"} onClick={()=>setZoom(zooms[zooms.indexOf(zoom)-1])}><Minus size={16}/></button><button aria-label="Zoom in weather map" disabled={zoom==="close"} onClick={()=>setZoom(zooms[zooms.indexOf(zoom)+1])}><Plus size={16}/></button></div>
    </div>
    <div className="wx-map-info"><strong>{layer==="satellite"?"Terra MODIS · true color":layer==="radar"?"NOAA · base reflectivity":"Observed storm positions"}</strong>
      {layer==="radar"&&!frames.length?<p role="status">{data.radar.status==="regional"?"NOAA radar mosaics cover selected U.S. regions. Satellite imagery is available for this location.":"Recent radar frames are unavailable from NOAA."}</p>:
       layer==="storms"?<p>{storms.filter(t=>inFrame(t.longitude,t.latitude)).length} reported centers within this view. Lines join time-ordered observations from NASA EONET. Select a storm below to recenter.</p>:<span>{dateLabel}</span>}
      {frames.length>1&&<label className="wx-frames">{layer==="satellite"?"Imagery date":"Radar observation"}<select value={frameIndex} onChange={ev=>{setPlaying(false);setFrame(Number(ev.target.value));}}>{frames.map((f,i)=><option key={f} value={i}>{layer==="satellite"?f+" UTC":timestamp(f)}</option>)}</select></label>}
      {layer==="radar"&&frames.length>1&&<button type="button" className="wx-play" aria-pressed={playing} onClick={()=>{if(!playing)setFrame(frames.length-1);setPlaying(v=>!v);}}>{playing?"Pause radar history":"Play radar history"}</button>}
      {layer==="satellite"&&<small>Daily satellite mosaic. Cloud, polar night and gaps between overpasses can obscure the surface.</small>}
      {failed===base||overlay&&failed===overlay?<p role="status">The imagery provider could not return this frame. Change the date or layer to try another.</p>:null}
      <a href={layer==="radar"?"https://radar.weather.gov/":layer==="satellite"?"https://worldview.earthdata.nasa.gov/":"https://eonet.gsfc.nasa.gov/"} target="_blank" rel="noreferrer">Open {layer==="radar"?"NWS Radar":layer==="satellite"?"NASA Worldview":"NASA EONET"} <ArrowUpRight size={13}/></a>
    </div>
  </section>;
}
function ForecastPanel({f,unit,setUnit}:{f:Forecast;unit:"C"|"F";setUnit:(u:"C"|"F")=>void}) {
  const first=f.hours[0],hours=f.hours.slice(0,12);
  const low=Math.min(...hours.map(h=>h.temp)),high=Math.max(...hours.map(h=>h.temp));
  const line=hours.map((h,i)=>(5+90*i/Math.max(1,hours.length-1)).toFixed(1)+","+(27-19*(h.temp-low)/Math.max(1,high-low)).toFixed(1)).join(" ");
  return <section className="wx-panel wx-forecast" aria-label="Forecast">
    <header className="wx-panel-head"><h2><Thermometer size={18}/> Forecast</h2><div className="wx-switch" role="group" aria-label="Weather units">{(["C","F"] as const).map(u=><button key={u} aria-pressed={u===unit} onClick={()=>setUnit(u)}>°{u}</button>)}</div></header>
    <div className="wx-now"><div><small>Model estimate · {timestamp(first.time)}</small><div className="wx-current"><Condition code={first.symbol} size={39}/><b>{temp(first.temp,unit)}</b><span>{symbol(first.symbol)}</span></div></div>
      <dl><div><dt>Wind</dt><dd>{wind(first.wind,unit)}{first.direction!==null?" · "+Math.round(first.direction)+"°":""}</dd></div><div><dt>Humidity</dt><dd>{first.humidity===null?"Unavailable":Math.round(first.humidity)+"%"}</dd></div><div><dt>Next hour rain</dt><dd>{first.rain===null?"Unavailable":unit==="F"?(first.rain/25.4).toFixed(2)+" in":first.rain+" mm"}</dd></div></dl></div>
    <details className="wx-hours"><summary>Hourly outlook · UTC</summary><svg viewBox="0 0 100 34" preserveAspectRatio="none" role="img" aria-label="Temperature trend for the displayed hours"><polyline points={line} stroke="#90ddc8" strokeWidth="2" fill="none" vectorEffect="non-scaling-stroke"/></svg><div className="wx-hour-strip">{hours.map(h=><div key={h.time}><time dateTime={h.time}>{shortHour(h.time)}</time><Condition code={h.symbol} size={19}/><b>{temp(h.temp,unit)}</b><small>{symbol(h.symbol)}</small></div>)}</div></details>
    <div className="wx-days"><h3>Daily outlook <small>UTC · sampled low / high</small></h3>{f.days.map(d=><div className="wx-day" key={d.date}><time dateTime={d.date}>{new Intl.DateTimeFormat(undefined,{timeZone:"UTC",weekday:"short",month:"short",day:"numeric"}).format(new Date(d.date+"T12:00:00Z"))}</time><span><Condition code={d.symbol} size={17}/>{symbol(d.symbol)}</span><b>{temp(d.low,unit)} / {temp(d.high,unit)}</b></div>)}</div>
    <footer className="wx-credit">Issued {timestamp(f.issuedAt)} · <a href="https://api.met.no/weatherapi/locationforecast/2.0/documentation" target="_blank" rel="noreferrer">MET Norway</a> · <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a></footer>
  </section>;
}
async function lookup(query:string,signal:AbortSignal):Promise<Place[]>{
  const response=await fetch("/api/weather?view=places&q="+encodeURIComponent(query),{signal});if(!response.ok)throw Error("Search unavailable");return (await response.json()).places;
}
export default function Weather({location,onAsk}:Props) {
  const [query,setQuery]=useState(location||"Maui"),[matches,setMatches]=useState<Place[]>([]),[place,setPlace]=useState<Place|null>(null);
  const [status,setStatus]=useState(""),[searching,setSearching]=useState(false),[data,setData]=useState<WeatherData|null>(null),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [unit,setUnit]=useState<"C"|"F">("C"),[layer,setLayer]=useState<Layer>("satellite");
  const searchController=useRef<AbortController|null>(null);
  function choose(p:Place){setPlace(p);setMatches([]);setQuery(p.label);setStatus("");}
  async function search(value:string,initial=false){
    searchController.current?.abort();const controller=new AbortController();searchController.current=controller;
    setSearching(true);setMatches([]);setStatus("");
    try{const list=await lookup(value,controller.signal);if(controller.signal.aborted)return;
      if((initial||list.length===1)&&list[0])choose(list[0]);else if(list.length)setMatches(list);else setStatus("No matching reference city. Try a nearby city or enter latitude, longitude.");}
    catch{if(!controller.signal.aborted)setStatus("Location search is temporarily unavailable. Try again.");}
    finally{if(!controller.signal.aborted)setSearching(false);}
  }
  useEffect(()=>{const start=location.trim()||"Maui";setQuery(start);void search(start,true);return()=>searchController.current?.abort();},[location]);
  useEffect(()=>{if(!place)return;const controller=new AbortController();setData(null);setError("");
    let updating=false;
    async function update(){if(updating||!place)return;updating=true;try{const params=new URLSearchParams({lat:String(place.latitude),lon:String(place.longitude)});const res=await fetch("/api/weather?"+params,{signal:controller.signal});if(!res.ok)throw Error();const next=await res.json();if(!controller.signal.aborted){setData(next);setError("");}}catch{if(!controller.signal.aborted)setError("Weather data could not be refreshed.");}finally{updating=false;}}
    void update();const tick=window.setInterval(()=>{if(!document.hidden)void update();},600000);
    return()=>{controller.abort();window.clearInterval(tick);};},[place,retry]);
  function submit(ev:FormEvent){ev.preventDefault();if(query.trim())void search(query.trim());}
  const storms=[...(data?.nhc.data||[]),...(data?.eonet.data||[])];
  return <div className="wx-view">
    <form onSubmit={submit} className="wx-search"><label htmlFor="weather-location"><LocateFixed size={15}/> Forecast location</label><div><input id="weather-location" value={query} onChange={e=>setQuery(e.target.value)} maxLength={100} placeholder="City or latitude, longitude"/><button type="submit" disabled={searching||!query.trim()}><Search size={16}/> Search</button></div></form>
    {matches.length>0&&<div className="wx-matches" role="group" aria-label="Matching locations">{matches.map(p=><button key={p.label+p.latitude} onClick={()=>choose(p)}><MapPin size={15}/>{p.label}<ArrowRight size={14}/></button>)}</div>}
    {(status||searching)&&<p role="status" className="wx-status">{searching?"Looking up location…":status}</p>}
    {place&&<div className="wx-location"><div><small>Weather for</small><h2>{place.label}</h2><p>{place.latitude}°, {place.longitude}°</p></div><button className="secondary" onClick={()=>onAsk("Summarize the forecast and official weather alerts for "+place.label+". What should I watch next?",{kind:"weather",...place})}><Radio size={16}/> Ask about this weather</button></div>}
    {error&&<div className="wx-status" role="status">{error} <button onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
    {place&&!data&&!error&&<p className="wx-status" role="status">Checking forecasts, imagery and weather bulletins…</p>}
    {data&&place&&<>
      <div className="wx-grid"><WeatherMap data={data} place={place} storms={storms} layer={layer} setLayer={setLayer}/>
        {data.forecast.data?<ForecastPanel f={data.forecast.data} unit={unit} setUnit={setUnit}/>:<section className="wx-panel wx-message"><h2>Forecast unavailable</h2><p>MET Norway could not supply a current forecast for this location.</p><button className="secondary" onClick={()=>setRetry(v=>v+1)}>Check again</button></section>}</div>
      <section className="wx-panel wx-station" aria-label="Observed weather">
        <header className="wx-panel-head"><h2><Thermometer size={18}/> Observed weather</h2></header>
        <div className="wx-content">{data.station?.data?<><strong>{temp(data.station.data.temp,unit)}{unit} at {data.station.data.label}</strong><p>{data.station.data.station} · {data.station.data.distance} km from the selected point · {timestamp(data.station.data.at)}{data.station.data.windKnots!==null?" · Wind "+data.station.data.windKnots+" kt":""}</p><a href={data.station.data.url} target="_blank" rel="noreferrer">NOAA station report <ArrowUpRight size={13}/></a></>:<p>{data.station?.status==="ok"?"No station within 100 km reported a temperature in the last three hours.":"Nearby station observations are currently unavailable."}</p>}</div>
      </section>
      <div className="wx-lower"><section className="wx-panel"><header className="wx-panel-head"><h2><Radio size={18}/> Official alerts</h2></header><div className="wx-content">
        {data.alerts.status==="regional"?<p>This location is outside the NOAA regional alert view. Use the WMO directory to find the responsible warning agency.</p>:data.alerts.status!=="ok"?<p>Local warning status could not be verified from NWS.</p>:!data.alerts.data?.length?<p>NWS lists no active alerts at this point as of {timestamp(data.checkedAt)}.</p>:data.alerts.data.map(a=><details key={a.url} className="wx-alert"><summary>{a.title} · {a.severity}</summary><p>{a.headline}</p><p>{a.area}</p>{a.end&&<p>Scheduled end {timestamp(a.end)}</p>}{a.instructions&&<p>{a.instructions}</p>}<a href={a.url} target="_blank" rel="noreferrer">Official bulletin <ArrowUpRight size={13}/></a></details>)}
        {data.airspace?.status==="ok"?<div className="wx-airspace"><h3>International aviation warnings</h3>{data.airspace.data?.length?data.airspace.data.map(a=><details className="wx-alert" key={a.id}><summary>{a.title} · {a.area}</summary><p>{a.raw}</p><p>Valid until {timestamp(a.end)}.</p><a href={a.url} target="_blank" rel="noreferrer">NOAA Aviation Weather Center <ArrowUpRight size={13}/></a></details>):<p>No active international SIGMET polygon in the NOAA feed covers this point.</p>}</div>:<p>International aviation warnings are currently unavailable.</p>}
        <a href={data.alerts.status==="regional"?"https://severeweather.wmo.int/":"https://www.weather.gov/alerts"} target="_blank" rel="noreferrer">{data.alerts.status==="regional"?"World Meteorological Organization":"National Weather Service"} <ArrowUpRight size={13}/></a>
      </div></section><section className="wx-panel"><header className="wx-panel-head"><h2><Wind size={18}/> Storm tracker</h2></header><div className="wx-content">
        <p>NASA EONET tracks reported storms worldwide. NHC supplies advisories for the Atlantic and eastern and central North Pacific.</p>
        {data.nhc.status!=="ok"&&<p>NHC advisories are temporarily unavailable.</p>}{data.eonet.status!=="ok"&&<p>NASA storm tracks are temporarily unavailable.</p>}
        {data.nhc.status==="ok"&&!data.nhc.data?.length&&<p>No active systems listed by NHC.</p>}
        {data.eonet.status==="ok"&&!data.eonet.data?.length&&<p>No open severe storms listed by EONET in its 14-day window.</p>}
        {storms.map(s=><article className="wx-storm" key={s.name+s.source}><h3>{s.name}</h3><p>{s.source} · {timestamp(s.at)}{s.windKnots!==null?" · "+s.windKnots+" kt":""}</p><div><button onClick={()=>{choose({label:s.name+" reported center",latitude:s.latitude,longitude:s.longitude});setLayer("storms");window.scrollTo({top:0,behavior:"instant"});}}><LocateFixed size={15}/> View position</button><a href={s.url} target="_blank" rel="noreferrer">Source <ArrowUpRight size={13}/></a></div></article>)}
      </div></section></div>
    </>}
    <p className="wx-credit">City references from <a href="https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/" target="_blank" rel="noreferrer">Natural Earth</a>. Coordinates select any point worldwide.</p>
  </div>;
}
