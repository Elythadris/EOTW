import assert from "node:assert/strict";
import test from "node:test";
import { askHandler } from "../server/assistant/ask.mjs";
import { inputContext } from "../server/assistant/data-context.mjs";

test("selecting a data view only forwards a validated symbol or rounded coordinates", () => {
  assert.deepEqual(inputContext({kind:"weather",latitude:20.799,longitude:-156.303,label:"untrusted"}),{kind:"weather",latitude:20.8,longitude:-156.3});
  assert.deepEqual(inputContext({kind:"finance",symbol:"EURUSD",url:"https://untrusted.example"}),{kind:"finance",symbol:"EURUSD"});
  for (const focus of [{kind:"weather",latitude:200,longitude:0},{kind:"finance",symbol:"https://example.com"},{kind:"arbitrary"}]) assert.throws(()=>inputContext(focus),{status:400});
});

test("the assistant uses provider evidence for data views and retains citations in source mode",async()=>{
  const handler=askHandler({
    search:()=>assert.fail("A chart selection should use its specific provider"),
    model:()=>null,
    contextEvidence:async focus=>{
      assert.deepEqual(focus,{kind:"finance",symbol:"SOFR"});
      return [{id:"1",title:"SOFR reference rate",source:"New York Fed",status:"reported by source",kind:"market data",url:"https://www.newyorkfed.org/markets/reference-rates/sofr",excerpt:"Observed annualized rate 3.98%."}];
    },
  });
  const response=await handler(new Request("https://watch.example/api/ask",{method:"POST",headers:{origin:"https://watch.example","content-type":"application/json"},body:JSON.stringify({question:"What does this chart show?",context:{kind:"finance",symbol:"SOFR",reported:"999%"}})}));
  const answer=await response.json();
  assert.equal(answer.mode,"sources");
  assert.match(answer.answer,/3\.98%/);
  assert.doesNotMatch(answer.answer,/999/);
  assert.equal(answer.citations[0].url,"https://www.newyorkfed.org/markets/reference-rates/sofr");
});
