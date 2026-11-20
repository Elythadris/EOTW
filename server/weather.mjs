import places from "./weather-places.json" with { type: "json" };

const AGENT="EOTW-Weather/1.0 (+https://github.com/Elythadris/EOTW)";
const MET="https://api.met.no/weatherapi/locationforecast/2.0/compact";
const NWS="https://api.weather.gov/alerts/active";
const NHC="https://www.nhc.noaa.gov/CurrentStorms.json";
const EONET="https://eonet.gsfc.nasa.gov/api/v3/events?category=severeStorms&status=open&days=14&limit=30";
const GIBS="https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi";
const HOUR=3600000;
const cache=new Map();
const num=x=>typeof x==="number"&&Number.isFinite(x)?x:null;
const clean=(s,n=240)=>String(s||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,n);
const validTime=t=>typeof t==="string"&&Number.isFinite(Date.parse(t));
const fold=s=>String(s).normalize("NFKD").replace(/\p{M}/gu,"").toLowerCase().replace(/[‘’ʻ']/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim();
const catalog=places.map(([label,latitude,longitude])=>({label,latitude,longitude,key:fold(label),city:fold(label.split(",")[0])}));
export function point(latitude,longitude) {
  if (latitude==null||longitude==null||String(latitude).trim()===""||String(longitude).trim()==="") return null;
  const lat=Number(latitude),lon=Number(longitude);
  if (!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180) return null;
  return {latitude:Number(lat.toFixed(3)),longitude:Number(lon.toFixed(3))};
}
export function findPlaces(term) {
  const text=String(term||"").trim().slice(0,100);
  const pair=/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(text);
  if(pair){const p=point(pair[1],pair[2]);return p?[{...p,label:p.latitude+"°, "+p.longitude+"°"}]:[];}
  let query=fold(text);
  if(!query)return [];
  if(["maui","maui county","maui hawaii","maui county hawaii"].includes(query))query="wailuku";
  const words=query.split(" ");
  return catalog.filter(p=>words.every(w=>p.key.includes(w))).map(p=>({p,score:p.city===query?3:p.key.startsWith(query)?2:p.city.includes(words[0])?1:0}))
    .sort((a,b)=>b.score-a.score).slice(0,12).map(({p:{key,city,...place}})=>place);
}
const regions=[
  ["hawaii",17,24,-162,-153],["conus",24,52,-130,-64],["alaska",50,72,-180,-129],
  ["carib",15,21,-69,-62],["guam",12,16,143,147],
];
export function radarRegion({latitude,longitude}) {
  return regions.find(([,s,n,w,e])=>latitude>=s&&latitude<=n&&longitude>=w&&longitude<=e)?.[0]||null;
}
function radarBase(region){return "https://opengeo.ncep.noaa.gov/geoserver/"+region+"/"+region+"_bref_qcd/ows";}
function locatedUrl(base,p){const url=new URL(base);url.searchParams.set("lat",String(p.latitude));url.searchParams.set("lon",String(p.longitude));return url.href;}
async function read(url,{kind="json",ttl=300,limit=2200000}={}) {
  const prior=cache.get(url);
  if(prior&&prior.until>Date.now())return prior.value;
  const value=(async()=>{
    const response=await fetch(url,{headers:{"User-Agent":AGENT},redirect:"error",signal:AbortSignal.timeout(8500)});
    if(!response.ok)throw Object.assign(Error("Provider HTTP "+response.status),{status:response.status});
    if(response.status===204 && (kind==="observations"||kind==="sigmets"))return [];
    const reader=response.body.getReader();const chunks=[];let length=0;
    for(;;){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit){await reader.cancel();throw Error("Oversized weather response");}chunks.push(value);}
    const data=Buffer.concat(chunks);const type=response.headers.get("content-type")||"";
    if(kind==="image"&&(!type.includes("image/png")||data[0]!==137||data[1]!==80))throw Error("Imagery unavailable");
    const parsed=kind==="image"?data:kind==="text"?data.toString("utf8"):JSON.parse(data.toString("utf8"));
    const expiry=Date.parse(response.headers.get("expires")||"");
    const entry=cache.get(url);if(entry)entry.until=Number.isFinite(expiry)?Math.max(Date.now()+15000,expiry):Date.now()+ttl*1000;
    return parsed;
  })();
  if(cache.size>=96)cache.delete(cache.keys().next().value);
  cache.set(url,{value,until:Date.now()+12000});
  try{return await value;}catch(error){if(cache.get(url)?.value===value)cache.delete(url);throw error;}
}
function stationUrl(p){
  const width=Math.min(5,1.1/Math.max(.25,Math.cos(p.latitude*Math.PI/180)));
  const limits=[Math.max(-90,p.latitude-1),Math.max(-180,p.longitude-width),Math.min(90,p.latitude+1),Math.min(180,p.longitude+width)];
  const u=new URL("https://aviationweather.gov/api/data/metar");u.search=new URLSearchParams({bbox:limits.map(d=>d.toFixed(2)).join(","),format:"json",hours:"3"});return u.href;
}
export function nearbyStation(list,p,now){
  if(!Array.isArray(list))throw Error("Invalid station response");
  const candidates=list.flatMap(row=>{
    const t=Number(row.obsTime)*1000;
    if(!/^[A-Z0-9]{3,5}$/.test(row.icaoId)||!point(row.lat,row.lon)||!Number.isFinite(t)||t<now-3*HOUR||t>now+60000||num(row.temp)===null)return [];
    const rad=Math.PI/180;
    const hav=Math.sin((row.lat-p.latitude)*rad/2)**2+Math.cos(p.latitude*rad)*Math.cos(row.lat*rad)*Math.sin((row.lon-p.longitude)*rad/2)**2;
    const distance=Math.round(12742*Math.asin(Math.min(1,Math.sqrt(hav))));if(distance>100)return [];
    return [{station:row.icaoId,label:clean(row.name,100)||row.icaoId,at:new Date(t).toISOString(),distance,temp:row.temp,windKnots:num(row.wspd),wx:clean(row.wxString,50),url:"https://aviationweather.gov/data/metar/?ids="+row.icaoId}];
  });
  return candidates.sort((a,b)=>a.distance-b.distance||Date.parse(b.at)-Date.parse(a.at))[0]||null;
}
const SIGMET="https://aviationweather.gov/api/data/isigmet?format=json";
export function pointAdvisories(list,p,now) {
  if(!Array.isArray(list))throw Error("Invalid airspace bulletin response");
  return list.flatMap(row=>{
    const start=Number(row.validTimeFrom)*1000,end=Number(row.validTimeTo)*1000;
    if(row.geom!=="AREA"||!Array.isArray(row.coords)||row.coords.length<3||!row.coords.every(c=>point(c.lat,c.lon))||!(start<=now&&now<end))return [];
    // Unwrap the polygon along the shortest longitude steps, then test each nearby world copy.
    const ring=[];let prior=p.longitude;
    for(const v of row.coords){const lon=prior+(((v.lon-prior+540)%360)-180);ring.push([lon,v.lat]);prior=lon;}
    const inside=[p.longitude-360,p.longitude,p.longitude+360].some(x=>{
      let found=false;
      for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [ax,ay]=ring[i],[bx,by]=ring[j];if((ay>p.latitude)!==(by>p.latitude)&&x<(bx-ax)*(p.latitude-ay)/(by-ay)+ax)found=!found;}
      return found;
    });
    if(!inside)return [];
    return [{id:clean(row.firId+"-"+row.seriesId+"-"+row.validTimeFrom,90),title:clean(({TS:"Thunderstorms",TURB:"Turbulence",ICE:"Icing",VA:"Volcanic ash",TC:"Tropical cyclone",MTW:"Mountain waves",DS:"Dust storm",SS:"Sandstorm"})[row.hazard]||row.hazard||"Significant weather"),area:clean(row.firName,120),raw:clean(row.rawSigmet,600),issued:new Date(start).toISOString(),end:new Date(end).toISOString(),url:SIGMET}];
  }).slice(0,12);
}
async function pointAlerts(p,alertsUrl,download){
  try {
    const coverage=await download("https://api.weather.gov/points/"+p.latitude+","+p.longitude,{ttl:86400});
    if(!coverage?.properties?.gridId)throw Error("Invalid NWS coverage response");
    return {status:"ok",data:normalizeAlerts(await download(alertsUrl,{ttl:180}))};
  } catch(error){return {status:error?.status===404?"regional":"unavailable",data:null};}
}
export function normalizeForecast(body,now=Date.now()) {
  const all=body?.properties?.timeseries;
  if(!Array.isArray(all)||!validTime(body?.properties?.meta?.updated_at))throw Error("Invalid forecast");
  const hourly=all.filter(row=>validTime(row.time)&&Date.parse(row.time)>=now-HOUR).flatMap(row=>{
    const d=row.data?.instant?.details;
    if(!d||num(d.air_temperature)===null)return [];
    const range=row.data.next_1_hours||row.data.next_6_hours||{};
    return [{time:row.time,temp:d.air_temperature,wind:num(d.wind_speed),direction:num(d.wind_from_direction),humidity:num(d.relative_humidity),pressure:num(d.air_pressure_at_sea_level),cloud:num(d.cloud_area_fraction),symbol:clean(range.summary?.symbol_code,70),rain:num(row.data.next_1_hours?.details?.precipitation_amount)}];
  });
  if(!hourly.length)throw Error("Expired forecast");
  const days=new Map();
  for(const h of hourly){const day=h.time.slice(0,10);const d=days.get(day)||{date:day,low:h.temp,high:h.temp,wind:null,symbol:"",hour:100,samples:0};
    d.low=Math.min(d.low,h.temp);d.high=Math.max(d.high,h.temp);if(h.wind!==null)d.wind=Math.max(d.wind??0,h.wind);
    const distance=Math.abs(new Date(h.time).getUTCHours()-12);if(distance<d.hour&&h.symbol){d.symbol=h.symbol;d.hour=distance;}d.samples++;days.set(day,d);}
  return {issuedAt:body.properties.meta.updated_at,hours:hourly.slice(0,24),days:[...days.values()].slice(0,7).map(({hour,...d})=>d)};
}
function safeOfficial(value,hosts,fallback){
  try{const u=new URL(value);if(u.protocol==="https:"&&hosts.includes(u.hostname)&&!u.username&&!u.password)return u.href;}catch{}
  return fallback;
}
function normalizeAlerts(data) {
  if(!Array.isArray(data.features))throw Error("Invalid alerts");
  return data.features.slice(0,30).flatMap(f=>{
    const p=f.properties;if(!p||p.status!=="Actual"||p.messageType==="Cancel")return [];
    return [{title:clean(p.event),headline:clean(p.headline,380),severity:clean(p.severity,30),area:clean(p.areaDesc,300),issued:validTime(p.sent)?p.sent:null,end:validTime(p.ends||p.expires)?p.ends||p.expires:null,
      instructions:clean(p.instruction,850),url:safeOfficial(f.id,["api.weather.gov"],"https://www.weather.gov/alerts")}];
  });
}
function severeStorms(data){
  if(!Array.isArray(data.events))throw Error("Invalid storm catalog");
  return data.events.flatMap(e=>{
    const path=(e.geometry||[]).filter(g=>g.type==="Point"&&g.coordinates?.length===2&&validTime(g.date)&&point(g.coordinates[1],g.coordinates[0])).sort((a,b)=>Date.parse(a.date)-Date.parse(b.date)).slice(-90);
    if(!path.length)return [];const last=path.at(-1);return [{name:clean(e.title),source:"NASA EONET",at:last.date,windKnots:last.magnitudeUnit==="kts"?num(last.magnitudeValue):null,latitude:last.coordinates[1],longitude:last.coordinates[0],
      track:path.map(g=>[g.coordinates[0],g.coordinates[1]]),url:safeOfficial(e.link,["eonet.gsfc.nasa.gov"],"https://eonet.gsfc.nasa.gov/")}];
  });
}
function advisories(data){
  if(!Array.isArray(data.activeStorms))throw Error("Invalid NHC index");
  return data.activeStorms.flatMap(s=>{
    if(!s.name||!point(s.latitudeNumeric,s.longitudeNumeric)||!validTime(s.lastUpdate))return [];
    return [{name:clean(s.name),source:"NOAA NHC",at:s.lastUpdate,windKnots:s.intensity==null?null:num(Number(s.intensity)),latitude:s.latitudeNumeric,longitude:s.longitudeNumeric,track:[[s.longitudeNumeric,s.latitudeNumeric]],url:safeOfficial(s.publicAdvisory?.url,["www.nhc.noaa.gov"],"https://www.nhc.noaa.gov/")}];
  });
}
export function radarFrames(xml,now=Date.now()){
  const match=/<Dimension\b[^>]*\bname="time"[^>]*>([^<]+)<\/Dimension>/i.exec(xml);
  if(!match)throw Error("Radar timestamps unavailable");
  const values=[...new Set(match[1].split(",").map(s=>s.trim()).filter(t=>validTime(t)&&Date.parse(t)<=now+60000&&Date.parse(t)>now-3*HOUR))].sort();
  if(!values.length)throw Error("Recent radar unavailable");
  return values.filter((_,i)=>i===values.length-1||(values.length-1-i)%5===0).slice(-6);
}
export function weatherBounds(p,zoom) {
  const span=zoom==="wide"?60:zoom==="close"?6:18;
  const halfWidth=Math.min(90,span/Math.max(.3,Math.cos(p.latitude*Math.PI/180)));
  const x=Math.max(-180+halfWidth,Math.min(180-halfWidth,p.longitude));
  const y=Math.max(-90+span/2,Math.min(90-span/2,p.latitude));
  return [x-halfWidth,y-span/2,x+halfWidth,y+span/2];
}
export function imageUrl(p,kind,zoom,at,now=Date.now()){
  const bounds=weatherBounds(p,zoom);let base,layer,time;
  if(kind==="radar"){
    const region=radarRegion(p);if(!region||!validTime(at)||Math.abs(now-Date.parse(at))>3*HOUR||Date.parse(at)>now+60000)return null;
    base=radarBase(region);layer=region+":"+region+"_bref_qcd";time=new Date(at).toISOString();
  }else if(kind==="base"){base=GIBS;layer="BlueMarble_ShadedRelief_Bathymetry";}
  else if(kind==="satellite"){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(at||"")||!validTime(at)||Date.parse(at)>now||now-Date.parse(at)>6*24*HOUR)return null;
    base=GIBS;layer="MODIS_Terra_CorrectedReflectance_TrueColor";time=at;
  }else return null;
  const u=new URL(base);u.search=new URLSearchParams({SERVICE:"WMS",VERSION:"1.1.1",REQUEST:"GetMap",SRS:"EPSG:4326",FORMAT:"image/png",TRANSPARENT:"TRUE",LAYERS:layer,STYLES:"",BBOX:bounds.map(n=>n.toFixed(5)).join(","),WIDTH:"768",HEIGHT:"384",...(time?{TIME:time}:{})});return u.href;
}
export async function imageBytes(url){return read(url,{kind:"image",ttl:1800,limit:1600000});}
const settled=task=>task.then(data=>({status:"ok",data}),()=>({status:"unavailable",data:null}));
export async function weatherAt(p,{download=read,now=Date.now()}={}) {
  const region=radarRegion(p),nwsScope=!!region||(p.latitude>=-15.5&&p.latitude<=-10&&p.longitude>=-173&&p.longitude<=-167);
  const alertsUrl=NWS+"?point="+p.latitude+","+p.longitude;
  const forecastUrl=locatedUrl(MET,p);
  const [forecast,alerts,nhc,eonet,radar,station,airspace]=await Promise.all([
    settled(download(forecastUrl,{ttl:1200}).then(v=>normalizeForecast(v,now))),
    nwsScope?pointAlerts(p,alertsUrl,download):Promise.resolve({status:"regional",data:null}),
    settled(download(NHC,{ttl:300}).then(advisories)),
    settled(download(EONET,{ttl:900}).then(severeStorms)),
    region?settled(download(radarBase(region)+"?service=WMS&version=1.3.0&request=GetCapabilities",{kind:"text",ttl:150}).then(v=>radarFrames(v,now))):Promise.resolve({status:"regional",data:null}),
    settled(download(stationUrl(p),{ttl:300,kind:"observations"}).then(rows=>nearbyStation(rows,p,now))),
    settled(download(SIGMET,{ttl:300,kind:"sigmets"}).then(rows=>pointAdvisories(rows,p,now))),
  ]);
  const satelliteDates=Array.from({length:4},(_,i)=>new Date(now-(i+1)*24*HOUR).toISOString().slice(0,10));
  return {point:p,checkedAt:new Date(now).toISOString(),station,airspace,forecast:{...forecast,url:forecastUrl},alerts:{...alerts,url:alerts.status!=="regional"?alertsUrl:"https://severeweather.wmo.int/"},nhc,eonet,radar:{...radar,region},satelliteDates,
    bounds:Object.fromEntries(["close","regional","wide"].map(z=>[z,weatherBounds(p,z)]))};
}
export async function weatherEvidence({latitude,longitude}) {
  const p=point(latitude,longitude);if(!p)return [];
  const w=await weatherAt(p);const evidence=[];
  if(w.forecast.data){const f=w.forecast.data;const h=f.hours[0];const next=f.hours.slice(0,12).map(row=>row.time+" "+row.temp+" °C"+(row.rain!==null?", "+row.rain+" mm next hour":"")).join(" | ");
    evidence.push({title:"MET Norway forecast at "+p.latitude+"°, "+p.longitude+"°",source:"MET Norway",url:w.forecast.url,publishedAt:f.issuedAt,excerpt:"Model forecast valid "+h.time+": "+h.temp+" °C; wind "+(h.wind??"unavailable")+" m/s; relative humidity "+(h.humidity??"unavailable")+"%. Upcoming model samples: "+next});}
  if(w.station.data){const s=w.station.data;evidence.push({title:"Observed conditions at "+s.station,source:"NOAA Aviation Weather Center",url:s.url,publishedAt:s.at,excerpt:s.label+" reported "+s.temp+" °C"+(s.windKnots!==null?" with wind "+s.windKnots+" kt":"")+". The station is "+s.distance+" km from the selected coordinate."});}
  for(const a of (w.airspace.data||[]).slice(0,1))evidence.push({title:"Aviation SIGMET: "+a.title,source:"NOAA Aviation Weather Center",url:a.url,publishedAt:a.issued,excerpt:"International aviation warning polygon contains the coordinate. "+a.raw});
  if(w.alerts.status==="ok"){const alerts=w.alerts.data;if(!alerts.length)evidence.push({title:"NWS point alert query",source:"National Weather Service",url:w.alerts.url,publishedAt:w.checkedAt,excerpt:"NWS returned zero active alerts for this coordinate at "+w.checkedAt+"."});
    for(const a of alerts.slice(0,3))evidence.push({title:a.headline||a.title,source:"National Weather Service",url:a.url,publishedAt:a.issued||w.checkedAt,excerpt:[a.area,a.severity,a.instructions].filter(Boolean).join(". ")});}
  const systems=[...(w.nhc.data||[]),...(w.eonet.data||[])].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
  for(const s of systems.slice(0,2))evidence.push({title:s.name,source:s.source,url:s.url,publishedAt:s.at,excerpt:"Storm bulletin lists center at "+s.latitude+"°, "+s.longitude+"° at "+s.at+(s.windKnots!==null?" with "+s.windKnots+" kt winds.":".")+" This basin or global bulletin does not establish impacts at the selected forecast point."});
  return evidence;
}
