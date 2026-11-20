import { getFinance } from "../../server/finance/market.mjs";
export async function financeHandler(request,load=getFinance) {
  if(request.method !== "GET") return Response.json({error:"Use GET."},{status:405,headers:{Allow:"GET","Cache-Control":"no-store"}});
  try {
    const snapshot=await load();
    const ok=snapshot.sources.filter(s=>s.status==="ok").length;
    return Response.json(snapshot,{status:ok?200:503,headers:{"X-Content-Type-Options":"nosniff","Cache-Control":"public, max-age=30","Netlify-CDN-Cache-Control":ok===snapshot.sources.length?"public, s-maxage=300, stale-while-revalidate=60":"public, s-maxage=30"}});
  } catch { return Response.json({error:"Financial sources unavailable."},{status:503,headers:{"Cache-Control":"no-store","Retry-After":"60"}}); }
}
export default request => financeHandler(request);
export const config={path:"/api/finance",rateLimit:{windowLimit:90,windowSize:60,aggregateBy:["ip","domain"]}};
