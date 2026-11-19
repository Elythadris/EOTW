// Read-only network probe. Invoke on a remote runner: node server/feeds/smoke.mjs
import { definitions, fetchProvider } from "./providers.mjs";
const result=await Promise.all(definitions().map(async def=>{
  if(def.disabled) return {id:def.id,status:"disabled",reason:def.disabled};
  try {
    const batch=await fetchProvider(def);
    return {id:def.id,status:"ok",normalized:batch.events.length};
  } catch(error) {
    return {id:def.id,status:"error",reason:error.status ? "HTTP "+error.status : error.name};
  }
}));
console.table(result);
if (result.every(provider=>provider.status!=="ok")) process.exitCode=1;
