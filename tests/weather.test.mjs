import test from "node:test";
import assert from "node:assert/strict";
import {point,findPlaces,weatherBounds,radarRegion,imageUrl,radarFrames,normalizeForecast,weatherAt} from "../server/weather.mjs";
import weather from "../netlify/functions/weather.mjs";
const date="2026-11-20T10:00:00Z",now=Date.parse(date),place={latitude:20.891,longitude:-156.505};

test("world place selection accepts coordinates, Unicode city names, and rejects invalid points",()=>{
  assert.equal(findPlaces("Maui County, Hawaiʻi")[0].latitude,20.891);
  assert.ok(findPlaces("São Paulo").some(p=>p.label.includes("Brazil")));
  assert.deepEqual(findPlaces("20.891, -156.505")[0],{...place,label:"20.891°, -156.505°"});
  for(const bad of [[null,45],["",45],[91,180],[55,200],[NaN,50]])assert.equal(point(...bad),null);
  assert.deepEqual(findPlaces("99, -300"),[]);
});
test("maps restrict protocols, provider regions, real frame times and bounds",()=>{
  assert.equal(radarRegion(place),"hawaii");
  assert.equal(imageUrl({latitude:35.7,longitude:139.7},"radar","regional",date,now),null);
  assert.equal(imageUrl(place,"satellite","regional","https://example.org/",now),null);
  assert.equal(imageUrl(place,"satellite","regional","2026-11-01",now),null);
  assert.equal(imageUrl(place,"https://example.org/","close",date,now),null);
  const radar=new URL(imageUrl(place,"radar","close",date,now));assert.equal(radar.host,"opengeo.ncep.noaa.gov");assert.equal(radar.searchParams.get("LAYERS"),"hawaii:hawaii_bref_qcd");
  const bounds=weatherBounds({latitude:89.9,longitude:179.9},"wide");assert.ok(bounds.every(Number.isFinite));assert.ok(bounds[2]<=180&&bounds[3]<=90);
  const records=Array.from({length:8},(_,i)=>new Date(now-i*120000).toISOString()).reverse();
  const xml='<Dimension name="time" units="ISO8601">'+records.join(",")+'</Dimension>';
  assert.equal(radarFrames(xml,now).at(-1),records.at(-1));assert.throws(()=>radarFrames(xml,now+3600000*5));
});
const series={properties:{meta:{updated_at:date},timeseries:[
  {time:date,data:{instant:{details:{air_temperature:0,wind_speed:0,relative_humidity:72}},next_1_hours:{summary:{symbol_code:"cloudy"},details:{precipitation_amount:0}}}},
  {time:"2026-11-20T11:00:00Z",data:{instant:{details:{air_temperature:3,wind_speed:2}}}},
]}};
test("forecast retains zero values and gaps and derives daily extrema only from available samples",()=>{
  const r=normalizeForecast(series,now);assert.equal(r.hours[0].rain,0);assert.equal(r.hours[1].rain,null);assert.equal(r.days[0].low,0);assert.equal(r.days[0].high,3);
  assert.throws(()=>normalizeForecast(series,now+7*86400000));
});
test("weather sources fail independently and distinguish unsupported local warnings from a verified zero",async()=>{
  const download=async(url)=>{if(url.includes("api.met.no"))return series;if(url.includes("CurrentStorms"))return {activeStorms:[]};if(url.includes("eonet"))return {events:[]};if(url.includes("points/"))return {properties:{gridId:"HFO"}};if(url.includes("alerts/active"))return {features:[]};throw Error("off");};
  const a=await weatherAt(place,{now,download});assert.equal(a.forecast.status,"ok");assert.equal(a.alerts.status,"ok");assert.equal(a.radar.status,"unavailable");
  const b=await weatherAt({latitude:35.7,longitude:139.7},{now,download});assert.equal(b.alerts.status,"regional");assert.equal(b.radar.status,"regional");
});
test("public endpoint validates inputs before any upstream fetch",async()=>{
  for(const url of ["?lat=0&lon=201","?view=image&lat=0&lon=0&layer=ftp&zoom=regional","?view=surprise"]){
    assert.equal((await weather(new Request("https://example.org/api/weather"+url))).status,400);}
  assert.equal((await weather(new Request("https://example.org/api/weather",{method:"POST"}))).status,405);
});
