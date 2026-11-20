import { findPlaces, imageBytes, imageUrl, point, weatherAt } from "../../server/weather.mjs";

const headers=(ttl,more={})=>({
  "Cache-Control":"public, max-age="+Math.min(ttl,120),
  "Netlify-CDN-Cache-Control":"public, s-maxage="+ttl+", stale-while-revalidate=60",
  "Netlify-Vary":"query","X-Content-Type-Options":"nosniff",...more,
});
const invalid=message=>Response.json({error:message},{status:400,headers:{"Cache-Control":"no-store"}});
export default async function weather(req) {
  if(req.method!=="GET")return new Response(null,{status:405,headers:{Allow:"GET"}});
  const params=new URL(req.url).searchParams,view=params.get("view")||"forecast";
  if(view==="places"){
    const term=params.get("q")?.trim();if(!term||term.length>100)return invalid("Enter a city or latitude, longitude.");
    return Response.json({places:findPlaces(term)},{headers:headers(3600)});
  }
  if(!["forecast","image"].includes(view))return invalid("Unknown weather view.");
  const p=point(params.get("lat"),params.get("lon"));if(!p)return invalid("Enter valid latitude and longitude.");
  if(view==="image"){
    const zoom=params.get("zoom")||"regional";if(!["close","regional","wide"].includes(zoom))return invalid("Invalid map extent.");
    const layer=params.get("layer");const url=imageUrl(p,layer,zoom,params.get("at"));if(!url)return invalid("Invalid layer, coverage or observation time.");
    try {return new Response(await imageBytes(url),{headers:headers(900,{"Content-Type":"image/png"})});}
    catch{return new Response(null,{status:503,headers:{"Cache-Control":"no-store","Retry-After":"120"}});}
  }
  return Response.json(await weatherAt(p),{headers:headers(180)});
}
export const config={path:"/api/weather",rateLimit:{windowLimit:100,windowSize:60,aggregateBy:["ip","domain"]}};
