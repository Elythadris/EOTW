import { XMLParser } from "fast-xml-parser";

const DAY = 86400000;
const FED = { name:"Federal Reserve Bank of New York", url:"https://www.newyorkfed.org/markets/reference-rates/sofr", endpoint:"https://markets.newyorkfed.org/api/rates/secured/sofr/last/90.json" };
const ECB = { name:"European Central Bank", url:"https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html", endpoint:"https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml" };
const TREASURY = { name:"TreasuryDirect", url:"https://www.treasurydirect.gov/auctions/upcoming/", endpoint:"https://www.treasurydirect.gov/TA_WS/securities/upcoming?format=json" };
const xml = new XMLParser({ignoreAttributes:false, attributeNamePrefix:"", removeNSPrefix:true, parseAttributeValue:false});
const reference = {
  SOFR:["Secured Overnight Financing Rate","%","rate",2,FED],
  EURUSD:["Euro / U.S. dollar","USD per EUR","fx",4,ECB],
  EURJPY:["Euro / Japanese yen","JPY per EUR","fx",2,ECB],
  EURGBP:["Euro / pound sterling","GBP per EUR","fx",5,ECB],
};
const items = x => Array.isArray(x) ? x : x == null ? [] : [x];
function day(value) {
  const s = String(value || "").slice(0,10);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(s) ? Date.parse(s+"T00:00:00Z") : NaN;
  return Number.isFinite(t) && new Date(t).toISOString().slice(0,10) === s ? s : null;
}
function move(a,b,kind) { return kind === "rate" ? (b-a)*100 : (b/a-1)*100; }
function amount(v,d=2) { return Number(v.toFixed(d)).toLocaleString("en-US", {maximumFractionDigits:d}); }
export function marketSeries(symbol, input, now=Date.now()) {
  const [label,unit,kind,precision,source] = reference[symbol];
  const latestDay = new Date(now).toISOString().slice(0,10);
  const valid = input.filter(p => day(p.date) && p.date <= latestDay && Number.isFinite(p.value) && (kind === "rate" || p.value>0));
  const points = [...new Map(valid.map(p => [p.date,p])).values()].sort((a,b)=>a.date.localeCompare(b.date)).slice(-90);
  if (!points.length) throw Error("No dated observations.");
  const latest = points.at(-1), previous = points.at(-2);
  const change = previous ? move(previous.value,latest.value,kind) : null;
  const unitChange = kind === "rate" ? "bp" : "%";
  let comparison = null;
  if (points.length >= 22) {
    const history = points.slice(-22,-1);
    const baseline = history.slice(1).map((p,i) => Math.abs(move(history[i].value,p.value,kind)));
    const exceeded = baseline.filter(v => v+1e-8 < Math.abs(change)).length;
    comparison = {sample:baseline.length,exceeded,unusual:exceeded>=19,median:(baseline.sort((a,b)=>a-b)[9]+baseline[10])/2};
  }
  const changeText = change === null ? "A previous observation is unavailable."
    : Math.abs(change) < .00001 ? "Unchanged from "+previous.date+"."
    : (change>0?"Up ":"Down ")+amount(Math.abs(change),kind==="rate"?1:3)+" "+unitChange+" from "+previous.date+".";
  const narrative = kind === "rate"
    ? "The New York Fed measured overnight borrowing secured by U.S. Treasury securities at "+latest.value.toFixed(2)+"%. "+changeText
    : "One euro bought "+latest.value.toFixed(precision)+" "+symbol.slice(3)+" at the ECB reference rate. "+changeText;
  return {symbol,label,unit,kind,precision,source:source.name,sourceUrl:source.url,asOf:latest.date,points,change,unitChange,comparison,narrative,
    stale:now-Date.parse(latest.date+"T23:59:59Z")>5*DAY,
    ...(symbol==="SOFR"?{termsUrl:"https://www.newyorkfed.org/privacy/termsofuse.html"}:{})};
}
async function readRemote(source,fetcher) {
  const response = await fetcher(source.endpoint, {signal:AbortSignal.timeout(8000), headers:{"User-Agent":"EOTW/1.0 (+https://github.com/Elythadris/EOTW)"}});
  if (!response.ok) { await response.body?.cancel(); throw Error("Upstream HTTP "+response.status); }
  const reader = response.body?.getReader();
  if (!reader) throw Error("Empty response.");
  const decoder=new TextDecoder();let size=0,body="";
  for (;;) {
    const {value,done}=await reader.read();
    if(done)break;
    size+=value.byteLength;
    if (size>900000){await reader.cancel();throw Error("Response exceeded size limit.");}
    body+=decoder.decode(value,{stream:true});
  }
  return body+decoder.decode();
}
function fedSeries(raw,now) {
  const rows = JSON.parse(raw).refRates;
  if (!Array.isArray(rows)) throw Error("Unexpected reference-rate response.");
  return [marketSeries("SOFR",rows.filter(r=>r.type==="SOFR" && typeof r.percentRate==="number")
    .map(r=>({date:day(r.effectiveDate),value:r.percentRate})),now)];
}
function ecbSeries(raw,now) {
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw Error("Unsupported XML.");
  const rows = items(xml.parse(raw).Envelope?.Cube?.Cube);
  return ["EURUSD","EURJPY","EURGBP"].flatMap(symbol=>{
    const points=rows.flatMap(r=>{
      const match=items(r.Cube).find(c=>c.currency===symbol.slice(3));
      return match && match.rate ? [{date:day(r.time),value:Number(match.rate)}] : [];
    });
    return points.length ? [marketSeries(symbol,points,now)] : [];
  });
}
function auctions(raw,now) {
  const rows=JSON.parse(raw);
  if(!Array.isArray(rows))throw Error("Unexpected auction response.");
  const today = new Intl.DateTimeFormat("en-CA",{timeZone:"America/New_York",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  return rows.flatMap(r=>{
    const date=day(r.competitiveAuctionCloseDate || r.auctionDate), published=day(r.announcementDate);
    if(!date || date<today || !published || published>today || !/^[A-Z0-9]{9}$/.test(r.cusip || "") || !r.securityType || !r.securityTerm) return [];
    return [{id:r.cusip,title:r.securityTerm+" Treasury "+r.securityType,date,published,time:/^\d{1,2}:\d\d [AP]M$/.test(r.competitiveAuctionCloseTime)?r.competitiveAuctionCloseTime+" ET":null,
      amount:r.offeringAmount && Number.isFinite(Number(r.offeringAmount)) && Number(r.offeringAmount)>0 ? Number(r.offeringAmount) : null,url:TREASURY.url}];
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id)).slice(0,12);
}
export async function loadFinance({now=Date.now(),fetcher=fetch}={}) {
  const jobs=[[FED,fedSeries],[ECB,ecbSeries],[TREASURY,auctions]];
  const results=await Promise.allSettled(jobs.map(async ([source,parse])=>{
    const values=parse(await readRemote(source,fetcher),now);
    if(source !== TREASURY && !values.length)throw Error("No dated observations.");
    return values;
  }));
  const from=(i)=>results[i].status==="fulfilled" ? results[i].value : [];
  const sources=jobs.map(([s],i)=>({name:s.name,url:s.url,status:results[i].status==="fulfilled"?"ok":"unavailable"}));
  return {checkedAt:new Date(now).toISOString(),series:[...from(0),...from(1)],auctions:from(2),sources};
}
let cache;
export async function getFinance() {
  const now=Date.now();
  if(cache && now<cache.until)return cache.promise;
  const entry={until:now+300000,promise:loadFinance()};
  cache=entry;
  const value=await entry.promise;
  if(value.sources.some(s=>s.status!=="ok"))entry.until=now+60000;
  return value;
}
export async function financeEvidence(symbol) {
  if(!Object.hasOwn(reference,symbol))return [];
  const snapshot=await getFinance();
  const s=snapshot.series.find(item=>item.symbol===symbol);
  if(!s)return [];
  const rows=[{title:s.label+" · "+s.asOf,source:s.source,url:s.sourceUrl,publishedAt:s.asOf,
    excerpt:"Effective observation date "+s.asOf+". "+s.narrative+(s.stale?" This observation is over five calendar days old.":"")+
      (s.comparison?" The absolute latest move exceeded "+s.comparison.exceeded+" of the preceding "+s.comparison.sample+" absolute period changes.":"")}];
  if(symbol==="SOFR" && snapshot.auctions.length) {
    const a=snapshot.auctions[0];
    rows.push({title:a.title+" auction announcement",source:TREASURY.name,url:a.url,publishedAt:a.published,
      excerpt:"TreasuryDirect lists this auction for "+a.date+(a.time?" at "+a.time:"")+", CUSIP "+a.id+(a.amount?", announced offering $"+amount(a.amount,0):"")+". A scheduled auction does not establish a cause for a market move."});
  }
  return rows;
}
