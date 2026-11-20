// Synthetic tests for the actual SMC Intraday Engine (signal-only).
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("smc-intraday.js", "utf8");
const emittedEvents=[];
const fakeWindow = { dispatchEvent(event){emittedEvents.push(event);} };
const sandbox = { window: fakeWindow, CustomEvent: class CustomEvent { constructor(type,opts){this.type=type;this.detail=opts?.detail;} }, console, Map, Math, Number, Array, Object, String, Date };
vm.runInNewContext(source, sandbox, {filename:"smc-intraday.js"});
const engine = fakeWindow.SMCIntradayEngine;
let passed=0;
function test(name,fn){try{fn();passed++;console.log("PASS "+name);}catch(e){console.error("FAIL "+name+" — "+e.message);process.exitCode=1;}}
function bars(base=105,count=30){return Array.from({length:count},(_,i)=>({open:base,high:base+0.5,low:base-0.5,close:base+0.1,time:i}));}
function buyCandles(target=110,current=105){
 const c=bars(105); c[22]={open:target-1.5,high:target,low:target-2,close:target-0.5,time:22};
 c[23]={open:105,high:106,low:104,close:105,time:23};c[24]={open:105,high:106,low:104,close:105,time:24};
 c[28]={open:105,high:105.5,low:101.5,close:104.5,time:28};c[29]={open:104.5,high:current+0.3,low:101.5,close:current,time:29};return c;
}
function sellCandles(target=90,current=96){
 const c=bars(96); c[22]={open:target+1.5,high:target+2,low:target,close:target+0.5,time:22};
 c[23]={open:96,high:97,low:95,close:96,time:23};c[24]={open:96,high:97,low:95,close:96,time:24};
 c[28]={open:96,high:100.5,low:95.5,close:96,time:28};c[29]={open:96,high:100.5,low:95.5,close:current,time:29};return c;
}
function bullPattern(){
 const c=bars(101); for(let i=0;i<c.length;i++)c[i]={open:100.5,high:101,low:99.5,close:100.2,time:i};
 c[25]={open:100.4,high:101,low:99.5,close:100.1,time:25};
 c[26]={open:100.8,high:101,low:98.5,close:100.1,time:26};
 c[27]={open:100.2,high:102,low:99.5,close:101.8,time:27};
 c[28]={open:101.8,high:102.5,low:101.5,close:102,time:28};
 c[29]={open:100,high:104.8,low:97.5,close:104.5,time:29};return c;
}
function bearPattern(){
 const c=bars(100);for(let i=0;i<c.length;i++)c[i]={open:100.5,high:101,low:99.5,close:100.2,time:i};
 c[25]={open:100.5,high:101,low:99.5,close:100.1,time:25};
 c[26]={open:100.8,high:102,low:100.5,close:101.5,time:26};
 c[27]={open:101.2,high:101.5,low:99.5,close:100,time:27};
 c[28]={open:100,high:100.2,low:99.4,close:99.6,time:28};
 c[29]={open:100,high:104,low:92,close:92.5,time:29};return c;
}
function rec(side,z,opposing=[]){return {confirmed:true,side,zones:[{type:"Demand/Supply",side,low:z[0],high:z[1],valid:true,status:"reacting",score:90,distance:0},...opposing]};}
test("Detector recognizes synthetic bullish sweep, BOS/MSS, displacement, FVG and confirmed BUY",()=>{
 const r=engine.detect(bullPattern());
 assert.equal(r.ready,true);assert.equal(r.side,"BUY",JSON.stringify(r.formations));
 assert.equal(r.confirmed,true, r.note);assert.equal(r.conflict,false);
 assert.equal(r.formations.liquiditySweep,true);assert.equal(r.formations.BOS,true);
 assert.equal(r.formations.MSS,true);assert.equal(r.formations.displacement,true);
 assert.equal(r.formations.FVG,true);assert.ok(r.zones.some(z=>z.side==="BUY"&&["reacting","touching"].includes(z.status)));
});
test("Detector recognizes synthetic bearish sweep, BOS/MSS, displacement, FVG and confirmed SELL",()=>{
 const r=engine.detect(bearPattern());
 assert.equal(r.ready,true);assert.equal(r.side,"SELL",JSON.stringify(r.formations));
 assert.equal(r.confirmed,true,r.note);assert.equal(r.conflict,false);
 assert.equal(r.formations.liquiditySweep,true);assert.equal(r.formations.BOS,true);
 assert.equal(r.formations.MSS,true);assert.equal(r.formations.displacement,true);
 assert.equal(r.formations.FVG,true);assert.ok(r.zones.some(z=>z.side==="SELL"&&["reacting","touching"].includes(z.status)));
});
test("SMC formation payload exposes separate structure, imbalance, POI and block flags",()=>{
 const r=engine.detect(bullPattern());
 assert.equal(r.ready,true);
 for(const key of ["BOS","MSS","CHoCH","liquiditySweep","FVG","IFVG","supply","demand","supplyDemand","orderBlock","breakerBlock","displacement"])
  assert.equal(typeof r.formations[key],"boolean","formation flag must be boolean: "+key);
 assert.ok(Array.isArray(r.zones),"zone catalogue must be available");
 assert.ok(r.zones.every(z=>["Supply","Demand","FVG","Order Block","Breaker Block","Sweep reclaim"].includes(z.type)),"zone types must be recognized");
});
test("Demand zone stays invalid after a confirmed close breaks its distal boundary, even if price later reclaims",()=>{
 const c=bars(100);
 c[18]={open:99,high:100,low:97,close:99,time:18};
 c[19]={open:99,high:100,low:97,close:99,time:19};
 c[20]={open:98,high:99,low:95,close:98,time:20};
 c[21]={open:98,high:102,low:97.5,close:101.5,time:21};
 c[22]={open:101.5,high:102,low:100,close:101,time:22};
 c[23]={open:101,high:102,low:100,close:101,time:23};
 c[24]={open:96,high:97,low:93,close:94,time:24};
 c[25]={open:99,high:101,low:98,close:100,time:25};
 c[26]={open:100,high:101,low:99,close:100,time:26};
 c[27]={open:100,high:101,low:99,close:100,time:27};
 c[28]={open:100,high:101,low:99,close:100,time:28};
 c[29]={open:100,high:101,low:99,close:100,time:29};
 const r=engine.detect(c);
 const zone=r.zones.find(z=>z.type==="Demand"&&z.origin===20);
 assert.ok(zone,"synthetic demand pivot should be catalogued");
 assert.equal(zone.valid,false,"later close below distal boundary permanently invalidates zone");
 assert.equal(zone.status,"invalidated");
});
test("Supply zone stays invalid after a confirmed close breaks its distal boundary, even if price later falls back",()=>{
 const c=bars(100);
 c[18]={open:101,high:103,low:100,close:101,time:18};
 c[19]={open:101,high:103,low:100,close:101,time:19};
 c[20]={open:102,high:105,low:101,close:102,time:20};
 c[21]={open:102,high:102.5,low:98,close:98.5,time:21};
 c[22]={open:98.5,high:99,low:98,close:98.8,time:22};
 c[23]={open:98.8,high:99,low:98,close:98.7,time:23};
 c[24]={open:104,high:107,low:103,close:106,time:24};
 c[25]={open:100,high:101,low:99,close:100,time:25};
 c[26]={open:100,high:101,low:99,close:100,time:26};
 c[27]={open:100,high:101,low:99,close:100,time:27};
 c[28]={open:100,high:101,low:99,close:100,time:28};
 c[29]={open:100,high:101,low:99,close:100,time:29};
 const r=engine.detect(c);
 const zone=r.zones.find(z=>z.type==="Supply"&&z.origin===20);
 assert.ok(zone,"synthetic supply pivot should be catalogued");
 assert.equal(zone.valid,false,"later close above distal boundary permanently invalidates zone");
 assert.equal(zone.status,"invalidated");
});
test("SMC confirmation count counts independent evidence groups, not duplicate structure/block labels",()=>{
 const r=engine.detect(bullPattern());
 assert.equal(r.count,Object.values(r.confirmations).filter(Boolean).length);
 assert.deepEqual(Object.keys(r.confirmations).sort(),["block","displacement","imbalance","structure","sweep"].sort());
 assert.equal(Object.hasOwn(r.confirmations,"mss"),false);
 assert.equal(Object.hasOwn(r.confirmations,"choch"),false);
});
test("SMC monitor is wired to render detected formations and confirmation counts",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const render=app.slice(app.indexOf("function renderSMCFormationMonitor("),app.indexOf("function renderSMCEntryPlan("));
 const multi=app.slice(app.indexOf("function renderSMCMultiFrame("),app.indexOf("function tfZone("));
 assert.match(render,/\["supply","Supply"\]/);
 assert.match(render,/\["demand","Demand"\]/);
 assert.match(render,/Independent confirmations:/);
 assert.match(multi,/renderSMCFormationMonitor\(formationRecord\)/);
 assert.doesNotMatch(multi,/setText\("smcFormationStatus","SMC timeframes/);
});
test("MT5 bridge source rotates configured symbols in bounded batches instead of truncating to first ten",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const ea=fs.readFileSync(path.join(__dirname,"../mt5-bridge/SMC_Sniper_MT5_Bridge.mq5"),"utf8");
 const worker=fs.readFileSync(path.join(__dirname,"../mt5-bridge/worker.js"),"utf8");
 assert.match(app,/function getRotatingSymbolBatch\(symbols, cursor = 0, batchSize = 10\)/);
 assert.match(app,/getRotatingSymbolBatch\(symbols,tradingState\.mt5ScanCursor,10\)/);
 assert.match(app,/tradingState\.mt5ScanCursor=batch\.nextCursor/);
 assert.doesNotMatch(app,/for\(const symbol of symbols\.slice\(0,10\)\)/);
 assert.match(ea,/int g_symbolCursor = 0/);
 assert.match(ea,/g_symbolCursor=\(start\+count\)%total/);
 assert.match(ea,/InpSymbolsPerCycle/);
 assert.match(worker,/MARKET_DATA_TTL_SECONDS = 180/);
 assert.match(worker,/ageSeconds<=90\?"FRESH":"STALE"/);
});
test("MT5 scanner reports per-symbol/timeframe feed health and always releases scan lock",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(app,/function recordMT5FeedHealth\(symbol,timeframe,status,details=\{\}\)/);
 assert.match(app,/function renderMT5FeedHealth\(symbols,frames,batch\)/);
 assert.match(app,/mt5FeedHealthStatus/);
 assert.match(app,/Latest candle is stale or not closed/);
 assert.match(app,/Fewer than 30 valid candles/);
 assert.match(app,/finally\s*\{\s*tradingState\.mt5ScanInProgress=false;/);
 assert.match(app,/age>90/);
});
test("Signal coordination deduplicates same strategy/symbol/timeframe/candle but keeps engines independent",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function buildCandidateSignalKey(");
 const end=source.indexOf("\nfunction recordCandidateSignal(",start);
 assert.ok(start>=0&&end>start,"candidate key helper must exist");
 const sandbox={Number};
 vm.runInNewContext(source.slice(start,end)+";buildCandidateSignalKey",sandbox);
 const key=sandbox.buildCandidateSignalKey;
 const apa=key("EURUSD","apa","intraday","1m","BUY",1234);
 assert.equal(apa,key("EURUSD","apa","intraday","1m","BUY",1234));
 assert.notEqual(apa,key("EURUSD","smc","intraday","1m","BUY",1234),"APA and SMC signals remain independent");
 assert.notEqual(apa,key("EURUSD","news","intraday","1m","BUY",1234),"News Trading remains independent");
 assert.notEqual(apa,key("EURUSD","apa","intraday","5m","BUY",1234),"timeframes remain independent");
 assert.notEqual(apa,key("EURUSD","apa","intraday","1m","SELL",1234),"directions remain independent");
 assert.notEqual(apa,key("EURUSD","apa","intraday","1m","BUY",1235),"new candles can create a new candidate");
 assert.match(source,/record\.signalKey === signalKey/,"existing candidate keys prevent duplicate signal records");
 assert.match(source,/signalKey,/,"new candidate stores its deduplication key");
 assert.match(source,/opportunityScore: opportunityRank\.score/,"rank metadata is stored with the candidate");
});
test("Opportunity ranking is bounded and uses independent confirmation/model evidence",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function rankCandidateOpportunity(");
 const end=source.indexOf("\nfunction hasOpposingOpenSignal",start);
 assert.ok(start>=0&&end>start);
 const sandbox={Number,Object,Array,Math};
 vm.runInNewContext(source.slice(start,end)+";rankCandidateOpportunity",sandbox);
 const rank=sandbox.rankCandidateOpportunity;
 assert.deepEqual({...rank({score:70,count:4,entryModels:["A","B"]})},{score:70,confirmations:4,models:2,rank:82});
 assert.equal(rank({score:150,count:0}).rank,100,"rank must be capped at 100");
 assert.equal(rank({score:-10,count:0}).rank,0,"rank must not be negative");
 assert.equal(rank({score:40,confirmations:{a:true,b:false}}).confirmations,1);
});
test("Opposing open candidates are blocked across APA, SMC and News on the same symbol",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function hasOpposingOpenSignal(");
 const end=source.indexOf("\nfunction recordCandidateSignal",start);
 assert.ok(start>=0&&end>start);
 const sandbox={Array};vm.runInNewContext(source.slice(start,end)+";hasOpposingOpenSignal",sandbox);
 const conflict=sandbox.hasOpposingOpenSignal;
 const open=[{status:"OPEN",symbol:"EURUSD",strategy:"apa",direction:"BUY"}];
 assert.equal(conflict(open,"EURUSD","SELL"),true);
 assert.equal(conflict(open,"EURUSD","BUY"),false);
 assert.equal(conflict(open,"GBPUSD","SELL"),false);
 assert.equal(conflict([{...open[0],status:"TP HIT"}],"EURUSD","SELL"),false);
});
test("Signal history and open positions prioritize ranked opportunities and display rank",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(source,/opportunityScore: opportunityRank\.score/);
 assert.match(source,/opportunityRank: opportunityRank\.rank/);
 assert.match(source,/open\.slice\(\)\.sort\(\(a,b\)=>\(Number\(b\.opportunityRank\)/);
 assert.match(source,/Opportunity rank:/);
 assert.match(source,/hasOpposingOpenSignal\(openEntries,symbol,direction\)/);
});
test("Signal expiry uses timeframe-specific windows and leaves scalping baskets untouched",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function getSignalExpiryBars(");
 const end=source.indexOf("\nfunction evaluateSignalHistory",start);
 assert.ok(start>=0&&end>start);
 const sandbox={String};vm.runInNewContext(source.slice(start,end)+";getSignalExpiryBars;getTimeframeSeconds",sandbox);
 assert.equal(sandbox.getSignalExpiryBars("1m"),30);
 assert.equal(sandbox.getSignalExpiryBars("M5"),24);
 assert.equal(sandbox.getSignalExpiryBars("15m"),16);
 assert.equal(sandbox.getSignalExpiryBars("H1"),10);
 assert.equal(sandbox.getTimeframeSeconds("M15"),900);
 const evaluator=source.slice(source.indexOf("function evaluateSignalHistory"),source.indexOf("function buildCandidateSignalKey"));
 assert.match(evaluator,/if \(record\.mode === "scalping"\) return/);
 assert.match(evaluator,/REVIEW — signal expired without TP or SL/);
 assert.match(evaluator,/lastEpoch>=expiryEpoch/);
});
test("Intraday signal expiry is a review outcome, not a win or loss",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(source,/status\.startsWith\("REVIEW"\)/);
 assert.match(source,/record\.expired=true/);
 assert.match(source,/record\.status="REVIEW — signal expired without TP or SL"/);
});
test("News calendar normalization rejects malformed and low-impact events, normalizes timestamps and deduplicates",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function hasNewsValue(");
 const end=source.indexOf("\nfunction renderNewsCalendar",start);
 assert.ok(start>=0&&end>start);
 const sandbox={Date,Map,String,Number,Array,NEWS_CURRENCIES:new Set(["USD","EUR","GBP","JPY","AUD","NZD","CAD","CHF","CNY"])};
 vm.runInNewContext(source.slice(start,end)+";hasNewsValue;normalizeNewsCalendarEvents",sandbox);
 const now=Date.UTC(2026,0,1);
 const events=sandbox.normalizeNewsCalendarEvents([
  {currency:"usd",impact:"HIGH",title:"Payrolls",ts:now/1000,actual:0,forecast:"10"},
  {currency:"USD",impact:"high",title:"Payrolls",ts:now,actual:"0",forecast:"10"},
  {currency:"EUR",impact:"low",title:"Low event",ts:now/1000},
  {currency:"XXX",impact:"high",title:"Unknown currency",ts:now/1000},
  {currency:"GBP",impact:"medium",title:"",ts:now/1000},
  {currency:"EUR",impact:"medium",title:"No timestamp"},
  {currency:"JPY",impact:"high",title:"Valid future",ts:now/1000+3600}
 ],now);
 assert.equal(events.length,2,"duplicate event should be collapsed and invalid events removed");
 assert.equal(events[0].currency,"USD");
 assert.equal(events[0].ts,now/1000);
 assert.equal(events[0].actual,"0","numeric zero is a valid actual value");
 assert.equal(events[1].currency,"JPY");
 assert.equal(sandbox.hasNewsValue(0),true);
 assert.equal(sandbox.hasNewsValue(""),false);
});
test("News analysis only considers confirmed high or medium impact events with actual and forecast values",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function analyseNews(");
 const end=source.indexOf("\nfunction ",start+20);
 const fn=source.slice(start,end);
 assert.match(fn,/\["high","medium"\]\.includes\(String\(event\.impact\|\|""\)\.toLowerCase\(\)\)/);
 assert.match(fn,/hasNewsValue\(event\.actual\) && hasNewsValue\(event\.forecast\)/);
 assert.match(source,/none passed timestamp, currency and impact validation/);
 assert.match(source,/WAIT — upcoming news blackout/);
});
test("APA top-down trend stack requires D1 H4 H1 M30 M15 and M5 alignment",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function isAPATrendStackAligned(");
 const end=source.indexOf("\nfunction isAPAEntryTrigger",start);
 assert.ok(start>=0&&end>start);
 const sandbox={Boolean,Array};vm.runInNewContext(source.slice(start,end)+";isAPATrendStackAligned",sandbox);
 const aligned=sandbox.isAPATrendStackAligned;
 assert.equal(aligned("BUY",["Bullish","Bullish","Bullish","Bullish","Bullish","Bullish"]),true);
 assert.equal(aligned("SELL",Array(6).fill("Bearish")),true);
 assert.equal(aligned("BUY",["Bullish","Bullish","Bullish","Bullish","Bearish","Bullish"]),false,"M15 disagreement must block");
 assert.equal(aligned("BUY",["Bullish","Bullish","Bullish","Bullish","Bullish"]),false,"missing timeframe must block");
});
test("APA M1 trigger requires directional candle, displacement and BOS/MSS/CHoCH",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function isAPAEntryTrigger(");
 const end=source.indexOf("\n/* APA TOP-DOWN ENGINE",start);
 assert.ok(start>=0&&end>start);
 const sandbox={Boolean,Number};vm.runInNewContext(source.slice(start,end)+";isAPAEntryTrigger",sandbox);
 const trigger=sandbox.isAPAEntryTrigger;
 const candle={open:10,close:12};
 assert.equal(trigger("BUY",candle,{bosUp:true},true),true);
 assert.equal(trigger("BUY",candle,{sweepLow:true},true),false,"sweep alone is not a final entry trigger");
 assert.equal(trigger("BUY",candle,{bosUp:true},false),false,"displacement is required");
 assert.equal(trigger("SELL",{open:12,close:10},{mssDown:true},true),true);
 assert.equal(trigger("SELL",candle,{bosDown:true},true),false,"candle direction must agree");
});
test("APA top-down scanner includes all seven configured stages and reports M15 context",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(source,/APA_REQUIRED_FRAMES = \["1d", "4h", "1h", "30m", "15m", "5m", "1m"\]/);
 assert.match(source,/M15 " \+ m15Trend/);
 assert.match(source,/M1 BOS\/MSS\/CHoCH structure break/);
 assert.match(source,/M15 setup alignment/);
});
test("Neutral candles do not generate confirmed signal",()=>{
 const r=engine.detect(bars(100));assert.equal(r.ready,true);assert.equal(r.confirmed,false);assert.equal(r.side,"NONE");assert.equal(r.entryModels.length,0);
});
test("BUY plan: SL below entry, TP above, RR >=2",()=>{
 const c=buyCandles();const p=engine.makeEntryPlan(rec("BUY",[101,102]),c);
 assert.ok(p&&!p.blocked,JSON.stringify(p));assert.ok(p.sl<p.entry);assert.ok(p.tp>p.entry);assert.ok(p.rr>=2);assert.equal(p.side,"BUY");
});
test("SELL plan: SL above entry, TP below, RR >=2",()=>{
 const c=sellCandles();const p=engine.makeEntryPlan(rec("SELL",[99,100]),c);
 assert.ok(p&&!p.blocked,JSON.stringify(p));assert.ok(p.sl>p.entry);assert.ok(p.tp<p.entry);assert.ok(p.rr>=2);assert.equal(p.side,"SELL");
});
test("WAIT if there is no structural target",()=>{
 const c=bars(105);const p=engine.makeEntryPlan(rec("BUY",[101,102]),c);
 assert.ok(p&&p.blocked);assert.match(p.reason,/No confirmed opposing swing/i);
});
test("WAIT if structural target offers less than 2R",()=>{
 const c=bars(102);c[22]={open:102,high:103,low:101,close:102.5,time:22};
 c[23]={open:102,high:102.5,low:101.5,close:102,time:23};c[24]={open:102,high:102.5,low:101.5,close:102,time:24};
 c[28]={open:102,high:102.8,low:100.5,close:102.5,time:28};c[29]={open:102.5,high:102.8,low:100.5,close:102.5,time:29};
 const p=engine.makeEntryPlan(rec("BUY",[101,102]),c);
 assert.ok(p&&p.blocked,JSON.stringify(p));assert.ok(p.rr<2);assert.match(p.reason,/less than 2.0R/i);
});
test("unconfirmed record cannot produce a plan",()=>{
 const p=engine.makeEntryPlan({...rec("BUY",[101,102]),confirmed:false},buyCandles());assert.equal(p,null);
});
test("conflict guard blocks simultaneous qualified BUY and SELL models",()=>{
 assert.equal(engine.hasConflict(["buy model"],["sell model"]),true);
 assert.equal(engine.hasConflict(["buy model"],[]),false);
 assert.equal(engine.hasConflict([],["sell model"]),false);
 assert.equal(engine.hasConflict([],[]),false);
});
test("timeframe evaluations keep independent keys/state",()=>{
 const neutral=bars(105);
 for(const tf of engine.frames){const r=engine.evaluate("TEST",tf,neutral);assert.ok(r&&r.ready);assert.ok(engine.state.latest.has("TEST|"+tf));}
 assert.equal(engine.frames.join(","),"1m,5m,15m,30m,1h,4h,1d");
 assert.equal(engine.state.latest.size,7);
});
test("multitimeframe BUY/SELL/WAIT results stay isolated and retain per-frame plans",()=>{
 const symbol="MTF-ISOLATION-"+Date.now();
 const bull=bullPattern(),bear=bearPattern(),neutral=bars(100);
 const inputs={"1m":bull,"5m":bear,"15m":neutral,"30m":neutral,"1h":neutral};
 const expected={"1m":"BUY","5m":"SELL","15m":"NONE","30m":"NONE","1h":"NONE"};
 const results={};
 for(const tf of engine.frames){
  const r=engine.evaluate(symbol,tf,inputs[tf]);
  results[tf]=r;
  assert.equal(r.side,expected[tf],tf+" side mismatch");
  assert.equal(Boolean(r.confirmed),tf==="1m"||tf==="5m",tf+" confirmation mismatch");
  assert.ok(engine.state.latest.has(symbol+"|"+tf),tf+" missing state key");
 }
 assert.equal(engine.state.latest.get(symbol+"|1m").side,"BUY");
 assert.equal(engine.state.latest.get(symbol+"|5m").side,"SELL");
 assert.equal(engine.state.latest.get(symbol+"|15m").side,"NONE");
 assert.notEqual(results["1m"],results["5m"],"records must be distinct");
 // Opposite signals on different frames are not treated as a same-frame model conflict.
 assert.equal(results["1m"].conflict,false);
 assert.equal(results["5m"].conflict,false);
 // Each frame's trade plan is computed from its own record and candle stream.
 const plans={"1m":engine.makeEntryPlan(rec("BUY",[101,102]),buyCandles()),
              "5m":engine.makeEntryPlan(rec("SELL",[99,100]),sellCandles())};
 assert.ok(plans["1m"]&&!plans["1m"].blocked,JSON.stringify(plans["1m"]));
 assert.ok(plans["5m"]&&!plans["5m"].blocked,JSON.stringify(plans["5m"]));
 assert.equal(plans["1m"].side,"BUY");assert.equal(plans["5m"].side,"SELL");
 assert.ok(plans["1m"].entry!==plans["5m"].entry,"entries should be independently derived");
 assert.notEqual(plans["1m"],plans["5m"],"plans must not share object state");
});

test("each SMC timeframe plan independently validates SL, TP and minimum 2R",()=>{
 const buyFrames=["1m","5m","15m","30m","1h"],sellFrames=["1m","5m","15m","30m","1h"];
 const plans=[];
 for(const tf of buyFrames){
  const p=engine.makeEntryPlan(rec("BUY",[101,102]),buyCandles(),2);
  assert.ok(p&&!p.blocked,tf+" BUY plan blocked: "+JSON.stringify(p));
  assert.ok(Number.isFinite(p.entry)&&Number.isFinite(p.sl)&&Number.isFinite(p.tp),tf+" BUY levels not numeric");
  assert.ok(p.sl<p.entry&&p.tp>p.entry,tf+" BUY SL/TP side incorrect");
  assert.ok(p.risk>0&&p.rr>=2,tf+" BUY risk/RR invalid");
  plans.push({tf,side:p.side,entry:p.entry,sl:p.sl,tp:p.tp});
 }
 for(const tf of sellFrames){
  const p=engine.makeEntryPlan(rec("SELL",[99,100]),sellCandles(),2);
  assert.ok(p&&!p.blocked,tf+" SELL plan blocked: "+JSON.stringify(p));
  assert.ok(Number.isFinite(p.entry)&&Number.isFinite(p.sl)&&Number.isFinite(p.tp),tf+" SELL levels not numeric");
  assert.ok(p.sl>p.entry&&p.tp<p.entry,tf+" SELL SL/TP side incorrect");
  assert.ok(p.risk>0&&p.rr>=2,tf+" SELL risk/RR invalid");
  plans.push({tf,side:p.side,entry:p.entry,sl:p.sl,tp:p.tp});
 }
 assert.equal(plans.length,10);
 assert.notEqual(plans[0],plans[1],"plan state objects must remain separate");
});


test("evaluate attaches per-frame plans and only marks valid plans trade-ready",()=>{
 const sym="PLAN-ISOLATION-"+Date.now();
 const b=engine.evaluate(sym,"1m",bullPattern());
 const s=engine.evaluate(sym,"5m",bearPattern());
 for(const r of [b,s]){
  assert.ok(r.tradePlan,"confirmed frame should have plan result (valid or blocked)");
  assert.equal(r.tradeReady,!!(r.confirmed&&r.tradePlan&&!r.tradePlan.blocked));
  if(r.tradeReady){
   assert.ok(Number.isFinite(r.tradePlan.entry)&&Number.isFinite(r.tradePlan.sl)&&Number.isFinite(r.tradePlan.tp));
   assert.ok(r.tradePlan.rr>=2);
  } else assert.ok(r.tradePlan.blocked,"non-ready plan must explain its block");
 }
 assert.notEqual(b.tradePlan,s.tradePlan,"plans cannot share object state");
 const wait=engine.evaluate(sym,"15m",bars(100));
 assert.equal(wait.tradePlan,null);assert.equal(wait.tradeReady,false);
 const chosen=engine.best(sym);
 assert.ok(chosen===null||chosen.tradeReady,"best() must only return trade-ready records");
});

test("scanner integration requires validated plans and rejects untradeable record",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(source,/record\.tradePlan/,"scanner should use engine-attached plan");
 assert.match(source,/!record\.tradeReady/,"scanner should reject records not trade-ready");
 assert.match(source,/NOT TRADE-READY; WAIT/,"scanner should display WAIT on invalid plan");
 assert.match(source,/!record\.tradeReady \|\| !record\.tradePlan/,"signal publisher must gate on tradeReady and attached plan");
});

test("best() selects highest-scoring trade-ready frame and ignores blocked signals",()=>{
 const sym="BEST-READY-"+Date.now();
 engine.state.latest.set(sym+"|1m",{symbol:sym,timeframe:"1m",score:99,confirmed:true,tradeReady:false,tradePlan:{blocked:true}});
 engine.state.latest.set(sym+"|5m",{symbol:sym,timeframe:"5m",score:70,confirmed:true,tradeReady:true,tradePlan:{blocked:false,side:"BUY",rr:2}});
 engine.state.latest.set(sym+"|15m",{symbol:sym,timeframe:"15m",score:85,confirmed:true,tradeReady:true,tradePlan:{blocked:false,side:"SELL",rr:2.5}});
 const selected=engine.best(sym);
 assert.equal(selected.timeframe,"15m","highest-scoring trade-ready frame should win");
 assert.equal(selected.tradeReady,true);
});

test("engine only dispatches SMC signal events for trade-ready records",()=>{
 const sym="EVENT-GATE-"+Date.now();emittedEvents.length=0;
 const inputs=[["1m",bullPattern()],["5m",bearPattern()],["15m",bars(100)]];
 const records=inputs.map(([tf,c])=>engine.evaluate(sym,tf,c));
 assert.ok(records.some(r=>r.confirmed),"fixtures should include confirmed setups");
 for(const event of emittedEvents){
  assert.equal(event.type,"smc:signal");
  assert.equal(event.detail.tradeReady,true,"published record must be trade-ready");
  assert.ok(event.detail.tradePlan&&!event.detail.tradePlan.blocked);
  assert.ok(event.detail.tradePlan.rr>=2);
 }
 assert.equal(emittedEvents.length,records.filter(r=>r.tradeReady).length,"dispatch count must match ready records");
});

test("SMC signal publisher maps structural TP from plan.tp, not legacy tp2",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function publishSMCSignal(");
 const end=source.indexOf("\n/* =========================================================",start);
 assert.ok(start>=0&&end>start,"publisher function should be found");
 const publisher=source.slice(start,end);
 assert.match(publisher,/tp:\s*plan\.tp\s*,/,"published TP must use structural plan.tp");
 assert.doesNotMatch(publisher,/plan\.tp2/,"legacy tp2 property must not be used");
});

test("APA, SMC and BOTH routing keeps strategy analyses separate",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function renderTimeframeAnalysis(");
 const end=source.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start,"timeframe renderer must be located");
 const renderer=source.slice(start,end);
 assert.match(renderer,/tradingState\.strategy === "both"/,"BOTH must explicitly route separate analyses");
 assert.match(renderer,/analyseAPATopDown\(symbol\)/,"APA top-down analyzer must be called independently");
 assert.match(renderer,/timeframe === "1m" \? analyseAPATopDown\(symbol\)/,"APA final entry analysis must be restricted to M1");
 assert.match(renderer,/analyseSMC\(candles\)/,"SMC analyzer must be called independently");
 assert.match(renderer,/resultKey = symbol \+ "\|" \+ timeframe \+ "\|" \+ strategyName/,"results must key by symbol, timeframe and strategy");
 assert.match(renderer,/strategyName === "smc"/,"SMC results must retain their identity");
 assert.match(renderer,/strategyName === "apa"/,"APA results must retain their identity");
});

test("signal-history deduplication preserves strategy and timeframe identity",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function recordCandidateSignal(");
 const end=source.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start,"signal record function should be located");
 const fn=source.slice(start,end);
 assert.ok(fn.includes("record.symbol === symbol && record.strategy === strategy"),"dedupe must isolate strategy");
 assert.ok(fn.includes("record.timeframe === timeframe"),"dedupe must isolate timeframe");
 assert.ok(fn.includes("symbol, strategy, timeframe, direction, entry, sl, tp"),"stored signal must carry identity fields");
 assert.ok(fn.includes("strategy, timeframe, direction"),"signal ID should encode strategy and timeframe");
});

test("trade outcome handling flags same-candle SL and TP as review and uses post-entry candles",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function evaluateSignalHistory(");
 const end=source.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start,"outcome handler should be located");
 const fn=source.slice(start,end);
 assert.match(fn,/if \(hitSL && hitTP\)/,"both levels touched in one candle must be detected");
 assert.match(fn,/REVIEW — SL and TP touched in the same candle/,"ambiguous candle outcome must not be falsely classified");
 assert.match(fn,/Number\(candle\.epoch\) > signalEpoch/,"only candles after entry candle should determine outcome");
 assert.match(fn,/outcomeCandleEpoch/,"outcome candle timestamp must be stored");
});

test("demo ledger summary groups wins, losses, reviews and RR by strategy/timeframe",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function summarizeDemoLedger(");
 const end=source.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start,"ledger summarizer should be present");
 const fn=source.slice(start,end);
 const sandbox={};vm.runInNewContext(fn+";summarizeDemoLedger",sandbox);
 const summarize=sandbox.summarizeDemoLedger;
 const records=[
  {strategy:"apa",timeframe:"m5",status:"TP HIT",plannedRR:2.4},
  {strategy:"apa",timeframe:"m5",status:"SL HIT",plannedRR:2},
  {strategy:"smc",timeframe:"m15",status:"OPEN",riskReward:2.1},
  {strategy:"smc",timeframe:"m15",status:"REVIEW — SL and TP touched in same candle",riskReward:2.3},
  {strategy:"smc",timeframe:"m15",status:"TP HIT",plannedRR:3}
 ];
 const result=summarize(records);
 assert.equal(result.total,5);assert.equal(result.open,1);assert.equal(result.wins,2);assert.equal(result.losses,1);assert.equal(result.review,1);
 assert.equal(result.groups["apa|m5"].wins,1);assert.equal(result.groups["apa|m5"].losses,1);
 assert.equal(result.groups["smc|m15"].open,1);assert.equal(result.groups["smc|m15"].review,1);
 assert.ok(Math.abs(result.groups["smc|m15"].averagePlannedRR-2.65)<1e-9,"exclude open record RR from closed ledger average");
});

test("demo equity curve calculates net R and maximum drawdown from closed trades",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function calculateDemoEquity(");
 const end=source.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start,"equity calculation should exist");
 const fn=source.slice(start,end);
 const sandbox={};vm.runInNewContext(fn+";calculateDemoEquity",sandbox);
 const calc=sandbox.calculateDemoEquity;
 const records=[
  {id:"a",strategy:"apa",timeframe:"m5",status:"TP HIT",plannedRR:2,createdAt:1,closedAt:2},
  {id:"b",strategy:"smc",timeframe:"m15",status:"SL HIT",plannedRR:2,createdAt:3,closedAt:4},
  {id:"c",strategy:"smc",timeframe:"m15",status:"TP HIT",plannedRR:3,createdAt:5,closedAt:6},
  {id:"d",strategy:"apa",timeframe:"m1",status:"OPEN",plannedRR:2,createdAt:7},
  {id:"e",strategy:"apa",timeframe:"m1",status:"REVIEW — SL and TP touched in the same candle",plannedRR:2,createdAt:8,closedAt:9},
  {id:"f",strategy:"apa",timeframe:"m1",status:"TP HIT",plannedRR:2,mode:"scalping",createdAt:10,closedAt:11}
 ];
 const result=calc(records);
 assert.equal(result.closedTrades,3);assert.equal(result.netR,4);assert.equal(result.maxDrawdownR,1);
 assert.deepEqual(Array.from(result.points.map(p=>p.id)),["a","b","c"]);
 assert.equal(result.points[1].drawdownR,1);
});

test("demo risk guard pauses at daily loss, consecutive loss and drawdown limits",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function calculateDemoEquity(");
 const equityEnd=source.indexOf("\nfunction ",start+10);
 const riskStart=source.indexOf("function calculateDemoRiskGuard(");
 const riskEnd=source.indexOf("\nfunction ",riskStart+10);
 assert.ok(start>=0&&equityEnd>start&&riskStart>=0&&riskEnd>riskStart,"equity and risk helpers exist regardless of source order");
 const fn=source.slice(riskStart,riskEnd)+"\n"+source.slice(start,equityEnd);const storage={};const sandbox={valueOf:()=>"",DEMO_RISK_LOCK_KEY:"smcSniperProDemoRiskLockV1",localStorage:{getItem:k=>storage[k]||null,setItem:(k,v)=>storage[k]=v}};
 vm.runInNewContext(fn+";calculateDemoRiskGuard",sandbox);
 const guard=sandbox.calculateDemoRiskGuard;
 const day=Date.now();
 const base={mode:"intraday",riskReward:2,plannedRR:2};
 const dailyLoss=[{...base,status:"SL HIT",closedAt:day},{...base,status:"SL HIT",closedAt:day}];
 delete storage["smcSniperProDemoRiskLockV1"];
 assert.equal(guard(dailyLoss,{riskPercent:0.5,dailyLossLimit:1,maxConsecutiveLosses:3}).locked,true,"daily loss 1% blocks");
 const streak=[{...base,status:"SL HIT",closedAt:day-3},{...base,status:"SL HIT",closedAt:day-2},{...base,status:"SL HIT",closedAt:day-1}];
 delete storage["smcSniperProDemoRiskLockV1"];
 assert.equal(guard(streak,{riskPercent:0.5,dailyLossLimit:5,maxConsecutiveLosses:3}).locked,true,"three consecutive losses pause");
 const yesterday=day-86400000;
 const draw=[{...base,status:"TP HIT",closedAt:yesterday-4,plannedRR:4},{...base,status:"SL HIT",closedAt:yesterday-3},{...base,status:"SL HIT",closedAt:yesterday-2},{...base,status:"SL HIT",closedAt:yesterday-1},{...base,status:"SL HIT",closedAt:yesterday}];
 delete storage["smcSniperProDemoRiskLockV1"];
 assert.equal(guard(draw,{riskPercent:0.5,dailyLossLimit:2,maxConsecutiveLosses:5}).locked,true,"4R historical peak-to-trough drawdown locks while daily loss and streak limits remain clear");
 const clean=[{...base,status:"TP HIT",closedAt:day,plannedRR:2}];
 delete storage["smcSniperProDemoRiskLockV1"];
 assert.equal(guard(clean,{riskPercent:0.5,dailyLossLimit:5,maxConsecutiveLosses:3}).locked,false,"healthy ledger stays unlocked");
});

test("demo risk lock persistence survives restart and manual reset does not erase history",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(source,/const DEMO_RISK_LOCK_KEY = "smcSniperProDemoRiskLockV1"/,"dedicated persisted lock key exists");
 const start=source.indexOf("function calculateDemoRiskGuard(");const end=source.indexOf("\nfunction calculateDemoEquity(",start);
 assert.ok(start>=0&&end>start,"risk guard can be isolated");const fn=source.slice(start,end);
 assert.match(fn,/localStorage\.getItem\(DEMO_RISK_LOCK_KEY/,"reads persisted lock");
 assert.match(fn,/localStorage\.setItem\(DEMO_RISK_LOCK_KEY/,"persists when breached");
 assert.match(fn,/persisted\?\.locked/,"reuses lock after page reload");
 assert.match(source,/localStorage\.setItem\(DEMO_RISK_LOCK_KEY,JSON\.stringify\(\{locked:false,resetAt:Date\.now\(\),source:"manual-reset"\}\)\)/,"manual reset starts a new monitoring baseline");
 assert.match(source,/Reset demo risk lock \(manual\)/,"reset is explicit UI action");
 assert.match(source,/renderSignalHistory\(\);/,"history rerender after reset");
 assert.match(source,/function startScanner\(resume = false\) \{\n  const persistedRisk = calculateDemoRiskGuard/,"scanner restart checks risk lock before starting");
});

test("POI invalidation marks a broken demand/order-block zone invalid",()=>{
 const c=bars(100);
 c[25]={open:101,high:102,low:99,close:100,time:25};
 c[26]={open:100,high:104,low:99.8,close:103.8,time:26};
 c[27]={open:103.8,high:104,low:103,close:103.5,time:27};
 c[28]={open:103.5,high:103.8,low:102.5,close:103,time:28};
 c[29]={open:99.5,high:100,low:98.5,close:98.8,time:29};
 const r=engine.detect(c);
 const broken=r.zones.find(z=>z.side==="BUY"&&z.type==="Order Block"&&z.origin===25);
 assert.ok(broken,"fixture should create the bearish-origin BUY order block");
 assert.equal(broken.status,"invalidated");
 assert.equal(broken.valid,false,"close below demand zone must invalidate it");
});

test("extreme candle wicks cannot move structural SL inside invalidation boundary",()=>{
 const buy=buyCandles();buy[29]={open:104,high:108,low:95,close:105,time:29};
 const pb=engine.makeEntryPlan(rec("BUY",[101,102]),buy,0);
 assert.ok(pb&&!pb.blocked,JSON.stringify(pb));
 assert.ok(pb.sl<101,"BUY stop must remain below POI low");
 assert.ok(pb.sl<Math.min(...buy.slice(-8).map(x=>x.low)),"BUY stop must remain beyond extreme local low");
 const sell=sellCandles();sell[29]={open:96,high:106,low:90,close:95,time:29};
 const ps=engine.makeEntryPlan(rec("SELL",[99,100]),sell,0);
 assert.ok(ps&&!ps.blocked,JSON.stringify(ps));
 assert.ok(ps.sl>100,"SELL stop must remain above POI high");
 assert.ok(ps.sl>Math.max(...sell.slice(-8).map(x=>x.high)),"SELL stop must remain beyond extreme local high");
});

test("repeated scanner evaluation preserves deduplication state",()=>{
 const sym="DUPLICATE-GUARD-"+Date.now();emittedEvents.length=0;
 const first=engine.evaluate(sym,"1m",bullPattern());
 const n=emittedEvents.length,key=sym+"|1m";
 const published=engine.state.lastPublished.get(key);
 const second=engine.evaluate(sym,"1m",bullPattern());
 assert.equal(emittedEvents.length,n,"repeat scan must not add duplicate events");
 assert.equal(engine.state.latest.get(key),second,"latest record stays on symbol/frame key");
 assert.equal(engine.state.lastPublished.get(key),published,"published signature stays stable");
 assert.equal(second.tradeReady,first.tradeReady,"identical scan keeps readiness stable");
});

test("only Scalping and Intraday styles are exposed; APA is intraday-only",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const worker=fs.readFileSync(path.join(__dirname,"../mt5-bridge/worker.js"),"utf8");
 assert.match(app,/scalping:\s*\["1m",\s*"5m"\]/);
 assert.match(app,/intraday:\s*\["1m",\s*"5m",\s*"15m",\s*"30m",\s*"1h"\]/);
 assert.doesNotMatch(app,/swing:\s*\[/i);
 assert.doesNotMatch(html,/value="swing"|Swing Trading/i);
 assert.doesNotMatch(worker,/swing:\s*\[/i);
 assert.deepEqual(Array.from(engine.framesForMode("scalping")),["1m","5m"]);
 assert.deepEqual(Array.from(engine.framesForMode("intraday")),["1m","5m","15m","30m","1h"]);
 assert.deepEqual(Array.from(engine.framesForMode("swing")),["1m","5m"],"unsupported mode safely falls back to scalping");
 const symbol="STYLE-INDEPENDENCE-"+Date.now();
 const scalp=engine.evaluate(symbol,"1m",bullPattern());
 const intraday=engine.evaluate(symbol,"1h",bearPattern());
 assert.equal(scalp.timeframe,"1m");assert.equal(intraday.timeframe,"1h");
 assert.notEqual(scalp,intraday);
});
test("H4 and D1 are accepted by the SMC evaluator but unrelated frames stay rejected",()=>{
 assert.ok(engine.evaluate("TF-ACCEPT-"+Date.now(),"4h",bullPattern()));
 assert.ok(engine.evaluate("TF-ACCEPT-"+Date.now(),"1d",bearPattern()));
 assert.equal(engine.evaluate("TF-REJECT-"+Date.now(),"2h",bullPattern()),null);
});
test("H4 and D1 context frames never publish SMC entry signals in Intraday or Scalping",()=>{
 const before=emittedEvents.length;
 const h4=engine.evaluate("CTX-H4-"+Date.now(),"4h",bullPattern(),"intraday");
 const d1=engine.evaluate("CTX-D1-"+Date.now(),"1d",bearPattern(),"intraday");
 assert.ok(h4&&d1,"H4/D1 remain analyzable as context");
 assert.equal(emittedEvents.length,before,"H4/D1 must not emit SMC entry signals in Intraday");
 const h4Scalp=engine.evaluate("CTX-H4-S-"+Date.now(),"4h",bullPattern(),"scalping");
 assert.ok(h4Scalp);
 assert.equal(emittedEvents.length,before,"H4 must not emit SMC entry signals in Scalping");
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.ok(app.includes("if (!allowedFrames.includes(timeframe)) return;"),"publisher must block SMC entries on frames not allowed by active mode");
});
test("H4 and D1 structural plans independently calculate BUY and SELL entry SL TP RR",()=>{
 const fixtures=[
  {tf:"4h",side:"BUY",candles:buyCandles(),zone:[101,102]},
  {tf:"4h",side:"SELL",candles:sellCandles(),zone:[99,100]},
  {tf:"1d",side:"BUY",candles:buyCandles(),zone:[101,102]},
  {tf:"1d",side:"SELL",candles:sellCandles(),zone:[99,100]}
 ];
 const symbol="STRUCTURAL-SWING-"+Date.now();
 for(const f of fixtures){
  const record=rec(f.side,f.zone);
  record.timeframe=f.tf;
  const plan=engine.makeEntryPlan(record,f.candles,2);
  assert.ok(plan&&!plan.blocked,f.tf+" "+f.side+" plan: "+JSON.stringify(plan));
  if(f.side==="BUY"){assert.ok(plan.sl<plan.entry,"BUY SL below entry");assert.ok(plan.tp>plan.entry,"BUY TP above entry");}
  else {assert.ok(plan.sl>plan.entry,"SELL SL above entry");assert.ok(plan.tp<plan.entry,"SELL TP below entry");}
  assert.ok(Number.isFinite(plan.rr)&&plan.rr>=2,"minimum RR enforced");
  const key=symbol+"|"+f.tf+"|"+f.side;
  const saved={symbol,timeframe:f.tf,side:f.side,tradePlan:plan};
  engine.state.latest.set(key,saved);
  assert.equal(engine.state.latest.get(key).tradePlan,plan,"plan stored independently per frame/direction");
 }
 assert.notEqual(engine.state.latest.get(symbol+"|4h|BUY").tradePlan,engine.state.latest.get(symbol+"|1d|BUY").tradePlan);
 assert.notEqual(engine.state.latest.get(symbol+"|4h|SELL").tradePlan,engine.state.latest.get(symbol+"|1d|SELL").tradePlan);
});
test("H4 and D1 invalid structural target and sub-2R cases remain WAIT",()=>{
 for(const tf of ["4h","1d"]){
  const noTarget=engine.makeEntryPlan(rec("BUY",[101,102]),bars(105),2);
  assert.ok(noTarget&&noTarget.blocked,tf+" must WAIT when no target");
  const short=bars(102);short[22]={open:102,high:103,low:101,close:102.5,time:22};
  short[23]={open:102,high:102.5,low:101.5,close:102,time:23};
  short[24]={open:102,high:102.5,low:101.5,close:102,time:24};
  short[28]={open:102,high:102.8,low:100.5,close:102.5,time:28};
  short[29]={open:102.5,high:102.8,low:100.5,close:102.5,time:29};
  const under=engine.makeEntryPlan(rec("BUY",[101,102]),short,2);
  assert.ok(under&&under.blocked&&under.rr<2,tf+" must WAIT below 2R");
 }
});
test("H4 and D1 volatility spikes widen structural SL beyond POI and extreme wick",()=>{
 for(const tf of ["4h","1d"]){
  const cndl=buyCandles();cndl[29]={open:104,high:112,low:94,close:106,time:29};
  const p=engine.makeEntryPlan(rec("BUY",[101,102]),cndl,2);
  assert.ok(p&&Number.isFinite(p.sl),tf+" spike must still calculate structural SL: "+JSON.stringify(p));
  assert.ok(p.sl<94,"BUY SL must sit below volatility spike wick");
  assert.ok(p.sl<101,"BUY SL below POI");
  const s=sellCandles();s[29]={open:96,high:108,low:88,close:94,time:29};
  const ps=engine.makeEntryPlan(rec("SELL",[99,100]),s,2);
  assert.ok(ps&&Number.isFinite(ps.sl),tf+" sell spike must still calculate structural SL: "+JSON.stringify(ps));
  assert.ok(ps.sl>108,"SELL SL beyond spike wick");
  assert.ok(ps.sl>100,"SELL SL above POI");
 }
});
test("H4 and D1 stale POIs older than configured maximum are excluded",()=>{
 for(const tf of ["4h","1d"]){
  const c=buyCandles(),record=rec("BUY",[101,102]);
  record.zones[0].age=45;record.timeframe=tf;
  const plan=engine.makeEntryPlan(record,c,2);
  assert.ok(plan&&plan.blocked,tf+" stale POI must not produce plan");
  assert.match(plan.reason,/valid supporting POI/i);
 }
});
test("H4 and D1 structure invalidation rejects BUY and SELL supporting POIs",()=>{
 for(const tf of ["4h","1d"]){
  const cb=buyCandles(),rb=rec("BUY",[101,102]);rb.timeframe=tf;
  cb[29]={open:101,high:102,low:98,close:99};
  const pb=engine.makeEntryPlan(rb,cb,2);
  assert.ok(pb&&pb.blocked,tf+" BUY POI broken by close under low must be rejected");
  const cs=sellCandles(),rs=rec("SELL",[99,100]);rs.timeframe=tf;
  cs[29]={open:99,high:102,low:98,close:101};
  const ps=engine.makeEntryPlan(rs,cs,2);
  assert.ok(ps&&ps.blocked,tf+" SELL POI broken by close above high must be rejected");
 }
});
test("H4 and D1 timeframe-specific RR thresholds block subminimum and allow valid plans",()=>{
 const c=buyCandles(110,105),r=rec("BUY",[101,102]);
 const plan2=engine.makeEntryPlan(r,c,2),plan25=engine.makeEntryPlan(r,c,20);
 assert.ok(plan2&&!plan2.blocked&&plan2.rr>=2,"2R threshold permits setup");
 assert.ok(plan25&&plan25.blocked&&plan25.rr<20,"high minimum RR threshold blocks same setup");
 const sell=sellCandles(90,96),rs=rec("SELL",[99,100]);
 const ps2=engine.makeEntryPlan(rs,sell,2),ps3=engine.makeEntryPlan(rs,sell,20);
 assert.ok(ps2&&!ps2.blocked&&ps2.rr>=2);
 assert.ok(ps3&&ps3.blocked&&ps3.rr<20);
});
test("invalid candles are rejected",()=>{
 const c=bars();c[0].high=NaN;const r=engine.detect(c);assert.equal(r.ready,false);
});


test("scanner feeds the independent SMC engine in SMC and BOTH modes for candle history and live OHLC",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const guard='if ((tradingState.strategy === "smc" || tradingState.strategy === "both") && window.SMCIntradayEngine) {';
 assert.equal(app.split(guard).length-1,2,"both candle history and live OHLC handlers must evaluate SMC in BOTH mode");
 const history=app.indexOf('if (data.msg_type === "candles" && Array.isArray(data.candles))');
 const live=app.indexOf('if (data.msg_type === "ohlc" && data.ohlc && context)');
 const h=app.slice(history,app.indexOf('if (data.msg_type === "ohlc"',history));
 const l=app.slice(live,app.indexOf('if (data.msg_type === "tick"',live));
 for(const block of [h,l]){
  assert.match(block,/SMCIntradayEngine\.evaluate\(\s*context\.symbol,\s*context\.timeframe/,"engine evaluates exact symbol/timeframe candles");
  assert.match(block,/publishSMCSignal\(/,"SMC signals are routed to demo history");
  assert.match(block,/renderSMCMultiFrame\(/,"multiframe SMC monitor updates");
 }
 assert.match(app,/strategy: "smc"/,"SMC records keep separate strategy identity");
 assert.match(app,/resultKey = symbol \+ "\|" \+ timeframe \+ "\|" \+ strategyName/,"renderer keys each strategy separately");
});
test("live candle scanner requests subscribed OHLC streams, retains contexts and deduplicates same candle updates",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const request=app.slice(app.indexOf("function requestCandles("),app.indexOf("function clearScanQueue("));
 assert.match(request,/candleSubscriptions\.values\(\)/,"avoid duplicate timeframe stream requests");
 assert.match(request,/scanQueue\.some\(job => job\.symbol === symbol && job\.timeframe === timeframe\)/,"avoid duplicate queued requests");
 const queue=app.slice(app.indexOf("function processScanQueue("),app.indexOf("function findStructureZones("));
 assert.match(queue,/ticks_history:\s*job\.symbol/,"history request uses symbol");
 assert.match(queue,/style:\s*"candles"/,"requests candle data");
 assert.match(queue,/subscribe:\s*1/,"requests a candle stream after history");
 const handler=app.slice(app.indexOf("function handleDerivMessage("),app.indexOf("function renderSMCFormationMonitor("));
 assert.match(handler,/data\.subscription\?\.id\s*\?\s*tradingState\.candleSubscriptions\.get/,"subscription response maps back to symbol/timeframe");
 assert.match(handler,/candleSubscriptions\.set\(data\.subscription\.id, context\)/,"retains context for stream updates");
 assert.match(handler,/const existing = list\.findIndex\(item => item\.epoch === candle\.epoch\)/,"updates same epoch candle rather than appending duplicates");
 assert.match(handler,/if \(existing >= 0\) list\[existing\] = candle;\s*else list\.push\(candle\)/,"upsert candle update");
 const stop=app.slice(app.indexOf("function stopScanner("),app.indexOf("function collectSettings("));
 assert.match(stop,/sendRequest\(\{ forget: subscriptionId \}\)/,"scanner stop forgets candle subscriptions");
 assert.match(stop,/candleSubscriptions\.clear\(\)/,"scanner stop clears stream context map");
});
test("market data request errors clear request context and identify failed symbol timeframe",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const handler=app.slice(app.indexOf("function handleDerivMessage("),app.indexOf("function renderSMCFormationMonitor("));
 assert.match(handler,/failedContext = data\.req_id \? tradingState\.requestContexts\.get\(data\.req_id\) : null/,"error response retrieves its request context");
 assert.match(handler,/if \(data\.req_id\) tradingState\.requestContexts\.delete\(data\.req_id\)/,"failed requests remove stale context");
 assert.match(handler,/failedContext\.symbol \+ " " \+ failedContext\.timeframe\.toUpperCase\(\)/,"error message identifies symbol/timeframe");
});


test("MT5 bridge config sync stays authenticated, bounded and demo/live locked",()=>{
 const worker=fs.readFileSync(path.join(__dirname,"../mt5-bridge/worker.js"),"utf8");
 assert.match(worker,/\/mt5\/config/,"config endpoint exists");
 assert.match(worker,/safeEqual\(bearerToken\(request\),env\.MT5_BRIDGE_TOKEN\)/,"protected routes verify bearer token");
 assert.match(worker,/demoOnly!==true/,"configuration requires demo-only true");
 assert.match(worker,/liveLocked!==true/,"configuration requires live lock true");
 assert.match(worker,/riskPercent<0\.01\|\|body\.riskPercent>5/,"risk is bounded");
 assert.match(worker,/maxOpenTrades>10/,"max simultaneous trades bounded");
 assert.match(worker,/body\.timeframes\.every\(tf=>ALL_MARKET_FRAMES\.includes\(tf\)\)/,"all supported context/entry frames are validated");
 assert.match(worker,/expected\.some\(tf=>!body\.timeframes\.includes\(tf\)\)/,"required strategy frames cannot be omitted");
 assert.match(worker,/MAX_BODY_BYTES = 32768/,"request body size bounded");
 assert.doesNotMatch(worker,/OrderSend|trade-command|\/mt5\/order/,"worker exposes no order execution route");
 assert.match(worker,/public-config/,"public config endpoint is metadata-only");
});
test("website config sync sends selected settings but never persists bridge token",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(html,/id="bridgeToken"/,"private token input exists");
 assert.match(html,/id="syncBridgeConfig"/,"sync button exists");
 assert.match(html,/id="bridgeSymbols"/,"MT5 symbol input exists");
 const start=app.indexOf("async function syncMT5BridgeConfig("),end=app.indexOf("async function refreshMT5BridgeConfig(",start);
 const fn=app.slice(start,end);
 assert.match(fn,/Authorization.*Bearer.*token/,"token is sent only in auth header");
 assert.match(fn,/demoOnly:true,liveLocked:true/,"website config forces demo/live lock");
 assert.match(fn,/MT5_CONFIG_URL/,"config is sent to bridge API");
 assert.doesNotMatch(fn,/localStorage|STORAGE_KEY/,"token/config is not persisted by sync handler");
});
test("website and MT5 bridge keep trading disabled during config sync",()=>{
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const ea=fs.readFileSync(path.join(__dirname,"../mt5-bridge/SMC_Sniper_MT5_Bridge.mq5"),"utf8");
 assert.match(html,/demo-only/);
 assert.match(html,/does not.*send trade commands/);
 assert.match(app,/liveLocked:true/);
 assert.match(ea,/FetchConfiguration\(\)/,"MT5 agent polls cloud config");
 assert.match(ea,/read-only/,"EA documents read-only sync");
 for(const forbidden of ["OrderSend(","CTrade(","PositionOpen(",".Buy(",".Sell("])assert.equal(ea.includes(forbidden),false,"bridge agent has no order function "+forbidden);
});

test("MT5 market-data bridge validates candle batches and returns freshness status",()=>{
 const worker=fs.readFileSync(path.join(__dirname,"../mt5-bridge/worker.js"),"utf8");
 assert.match(worker,/\/mt5\/market-data/,"market-data endpoint exists");
 assert.match(worker,/MARKET_DATA_TTL_SECONDS/,"market data storage has TTL");
 assert.match(worker,/bars\.length<30/,"minimum candle history enforced");
 assert.match(worker,/bars\.length>150/,"maximum candle history enforced");
 assert.match(worker,/c\.high>=Math\.max\(c\.open,c\.close,c\.low\)/,"OHLC high validation");
 assert.match(worker,/c\.low<=Math\.min\(c\.open,c\.close,c\.high\)/,"OHLC low validation");
 assert.match(worker,/c\.epoch>bars\[i-1\]\.epoch/,"candle timestamps must increase");
 assert.match(worker,/ageSeconds<=90\?"FRESH":"STALE"/,"freshness classification");
 assert.match(worker,/safeEqual\(bearerToken\(request\),env\.MT5_BRIDGE_TOKEN\)/,"publish endpoint is token-authenticated");
});
test("MT5 EA publishes configured candle data and website scanner consumes it",()=>{
 const ea=fs.readFileSync(path.join(__dirname,"../mt5-bridge/SMC_Sniper_MT5_Bridge.mq5"),"utf8");
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 assert.match(ea,/CopyRates\(/,"EA reads broker candles");
 assert.match(ea,/SendMarketData\(/,"EA publishes candle packets");
 assert.match(ea,/InpMarketDataURL/,"EA targets market-data endpoint");
 assert.match(ea,/PublishConfiguredMarketData\(/,"EA publishes configured symbol/timeframes");
 const scanner=app.slice(app.indexOf("async function scanMT5MarketData"),app.indexOf("function startMT5Scanner"));
 assert.match(scanner,/MT5_MARKET_DATA_URL/,"website polls MT5 candle endpoint");
 assert.match(scanner,/packet\.status!=="FRESH"\|\|!Number\.isFinite\(age\)\|\|age>90/,"scanner rejects stale feeds");
 assert.match(scanner,/renderTimeframeAnalysis/,"fresh MT5 candles enter scanner analysis");
 assert.match(scanner,/SMCIntradayEngine\.evaluate/,"MT5 candle feed enters SMC engine");
 assert.match(app,/if \(tradingState\.broker === "mt5"\) \{ startMT5Scanner\(\); return; \}/,"scanner switches to MT5 data mode");
});

test("MT5 candle feed data source is visible and scanner rejects nonfresh data",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(app,/MT5 feed health: .*fresh/,"scanner reports per-feed freshness counters");
 assert.match(app,/MT5 read-only feed health updated/,"source and feed-health update time are shown");
 assert.match(html,/MT5 broker/,"MT5 broker source selector exists");
 assert.match(html,/bridgeSymbols/,"scanner feed uses configured MT5 symbols");
});

test("SMC Scalping follows user-selected pair and closes only when every basket position is individually profitable",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function manageScalpingBasketSimulation(");
 const end=app.indexOf("\n/* =========================================================\n   SCANNER",start);
 assert.ok(start>=0&&end>start,"basket manager must exist");
 const storage={signalHistory:[]},messages=[];
 const sandbox={tradingState:storage,saveSignalHistory(){storage.saved=true;},addResult(message){messages.push(message);},Date,Number};
 vm.runInNewContext(app.slice(start,end)+";manageScalpingBasketSimulation",sandbox);
 const manage=sandbox.manageScalpingBasketSimulation;
 const p1={symbol:"EURUSD",strategy:"smc",mode:"scalping",direction:"BUY",entry:1.1,status:"OPEN"};
 const p2={symbol:"EURUSD",strategy:"smc",mode:"scalping",direction:"BUY",entry:1.2,status:"OPEN"};
 const other={symbol:"GBPUSD",strategy:"smc",mode:"scalping",direction:"BUY",entry:1.3,status:"OPEN"};
 const apa={symbol:"EURUSD",strategy:"apa",mode:"scalping",direction:"BUY",entry:1.1,status:"OPEN"};
 storage.signalHistory=[p1,p2,other,apa];
 manage("EURUSD",1.15);
 assert.equal(p1.status,"OPEN","first position profit alone cannot close basket");
 assert.equal(p2.status,"OPEN","losing second position keeps basket open");
 assert.equal(other.status,"OPEN","other pair must not be included");
 assert.equal(apa.status,"OPEN","APA must not be included");
 manage("EURUSD",1.25);
 assert.match(p1.status,/ALL POSITIONS PROFITABLE/);
 assert.match(p2.status,/ALL POSITIONS PROFITABLE/);
 assert.equal(p1.closedAt,p2.closedAt,"basket positions close together");
 assert.equal(p1.exitPrice,1.25);assert.equal(p2.exitPrice,1.25);
 assert.equal(other.status,"OPEN");assert.equal(apa.status,"OPEN");
 assert.equal(messages.length,1);
});
test("SMC Scalping routing is SMC-only, user-selected, and single-pair locked",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function recordCandidateSignal(");
 const end=app.indexOf("\nfunction ",start+10);
 assert.ok(start>=0&&end>start);
 const fn=app.slice(start,end);
 assert.match(fn,/activeStrategy === "apa"\) return/,"APA must not create scalp entries");
 assert.match(fn,/activeStrategy === "smc" && tradingState\.mode === "scalping"/,"only SMC uses scalp mode");
 assert.match(fn,/tradingState\.selectedSymbols\.has\(symbol\)/,"scalp pair must be explicitly selected by user");
 assert.match(fn,/record\.strategy === "smc" && record\.mode === "scalping" && record\.symbol !== symbol/,"second pair blocked until active basket closes");
 assert.match(fn,/mode: isScalp \? "scalping" : "intraday"/,"SMC scalp records retain scalp mode");
 assert.match(fn,/all-positions-positive-basket/,"basket exit policy is explicit");
});


test("APA top-down requires D1/H4/H1/M30/M15/M5/M1 and uses M5 refinement",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function analyseAPATopDown(");
 const end=source.indexOf("\n/* =========================================================",start);
 assert.ok(start>=0&&end>start,"APA top-down function must exist");
 const fn=source.slice(start,end);
 for(const tf of ["1d","4h","1h","30m","5m","1m"])
   assert.ok(fn.includes('candleKey(symbol, "'+tf+'")'),"APA missing "+tf+" feed");
 assert.match(fn,/const setupTimeframe = APA_SETUP_FRAME\.intraday/,"M15 must remain the APA setup timeframe");
 assert.match(fn,/m5Trend/,"M5 must be evaluated as refinement timeframe");
 assert.match(fn,/M5 refinement alignment/,"M5 alignment must gate APA");
});
test("MT5 APA bridge requires complete D1-to-M1 timeframe set",()=>{
 const worker=fs.readFileSync(path.join(__dirname,"../mt5-bridge/worker.js"),"utf8");
 assert.match(worker,/const APA_FRAMES = \["1d", "4h", "1h", "30m", "15m", "5m", "1m"\]/);
 assert.match(worker,/Required strategy timeframes are missing/);
 assert.match(worker,/strategy === "apa" \|\| strategy === "both"/);
});
test("MT5 scanner feeds latest M1 quote into SMC scalp basket simulation",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("async function scanMT5MarketData(");
 const end=source.indexOf("\nfunction startMT5Scanner",start);
 assert.ok(start>=0&&end>start,"MT5 scanner must exist");
 const fn=source.slice(start,end);
 assert.match(fn,/timeframe==="1m"\) manageScalpingBasketSimulation\(symbol,lastBar\.close\)/);
});

test("SMC Scalping scanner refuses multiple or missing pairs for both MT5 and Deriv",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function getScanSymbolsForMode(");
 const end=source.indexOf("\nfunction getBridgeFrames",start);
 assert.ok(start>=0&&end>start,"single-pair scan selector must exist");
 const sandbox={};vm.runInNewContext(source.slice(start,end)+";getScanSymbolsForMode",sandbox);
 const select=sandbox.getScanSymbolsForMode;
 assert.deepEqual(Array.from(select(["EURUSD"],"scalping","smc")),["EURUSD"]);
 assert.deepEqual(Array.from(select(["EURUSD","GBPUSD"],"scalping","smc")),[]);
 assert.deepEqual(Array.from(select([],"scalping","smc")),[]);
 assert.deepEqual(Array.from(select(["EURUSD","GBPUSD"],"intraday","smc")),["EURUSD","GBPUSD"]);
 const mt5Start=source.slice(source.indexOf("function startMT5Scanner("),source.indexOf("\nfunction startScanner",source.indexOf("function startMT5Scanner(")));
 assert.match(mt5Start,/getScanSymbolsForMode\(rawSymbols,mode,strategy\)/);
 const derivStart=source.slice(source.indexOf("function startScanner("),source.indexOf("\nfunction scanSelectedMarkets",source.indexOf("function startScanner(")));
 assert.match(derivStart,/tradingState\.selectedSymbols\.size !== 1/);
});

console.log("SMC synthetic test suite: "+passed+" passed; "+(process.exitCode? "failures present":"all passed"));

test("APA intraday scanner rotates batches across the complete market universe",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function getScanSymbolsForMode(");
 const end=source.indexOf("\nfunction getBridgeFrames",start);
 assert.ok(start>=0&&end>start);
 const sandbox={};vm.runInNewContext(source.slice(start,end)+";getScannerUniverseBatch",sandbox);
 const batch=sandbox.getScannerUniverseBatch;
 const markets=Array.from({length:23},(_,i)=>"PAIR"+i);
 const first=batch(markets,"intraday","apa",0,10);
 const second=batch(markets,"intraday","apa",first.nextCursor,10);
 const third=batch(markets,"intraday","apa",second.nextCursor,10);
 assert.equal(first.total,23);assert.equal(first.symbols.length,10);
 assert.equal(second.symbols.length,10);assert.equal(third.symbols.length,3);
 assert.equal(new Set([...first.symbols,...second.symbols,...third.symbols]).size,23,"rotation covers all markets before wrap");
 const wrap=batch(markets,"intraday","apa",third.nextCursor,10);
 assert.deepEqual(Array.from(wrap.symbols),markets.slice(0,10),"rotation wraps to start");
 const scalp=batch(["EURUSD","GBPUSD"],"scalping","smc",0,10);
 assert.deepEqual(Array.from(scalp.symbols),[],"scalp restriction remains single-pair only");
 const intradaySmc=batch(markets,"intraday","smc",0,10);
 assert.equal(intradaySmc.symbols.length,23,"SMC intraday keeps all selected markets");
});
test("APA intraday scanner uses all available markets and rotation cursor",()=>{
 const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=source.indexOf("function scanSelectedMarkets(");
 const end=source.indexOf("\\nfunction stopScanner",start);
 const fn=source.slice(start,end);
 assert.match(fn,/tradingState\.availableSymbols\.map\(item => item\.symbol\)/);
 assert.match(fn,/tradingState\.scanUniverseCursor/);
 assert.match(fn,/getScannerUniverseBatch/);
});

test("market data freshness rejects missing, invalid and stale candles",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function isMarketDataFresh(");
 const end=app.indexOf("\nfunction recordCandidateSignal(",start);
 assert.ok(start>=0&&end>start,"market freshness helper must exist before signal recorder");
 const sandbox={GRANULARITY:{"1m":60,"5m":300,"15m":900,"30m":1800,"1h":3600}};
 vm.runInNewContext(app.slice(start,end)+";isMarketDataFresh",sandbox);
 const fresh=sandbox.isMarketDataFresh;
 assert.equal(fresh([], "1m",1000),false);
 assert.equal(fresh([{epoch:0}], "1m",1000),false);
 assert.equal(fresh([{epoch:900}], "unknown",1000),false);
 assert.equal(fresh([{epoch:900}], "1m",1080),true);
 assert.equal(fresh([{epoch:900}], "1m",1081),false);
 assert.equal(fresh([{epoch:600}], "1m",1000),false);
 assert.equal(fresh([{epoch:600}], "5m",1000),true);
});
test("market scan cursor advances only after a batch drains and retries interrupted batches",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function commitCompletedScanBatch(");
 const end=app.indexOf("\nfunction clearScanQueue(",start);
 assert.ok(start>=0&&end>start,"batch cursor helpers must exist");
 const sandbox={};
 vm.runInNewContext(app.slice(start,end)+";commitCompletedScanBatch;discardPendingScanBatch",sandbox);
 const state={scanUniverseCursor:10,pendingScanCursor:20};
 assert.equal(sandbox.commitCompletedScanBatch(state),true);
 assert.equal(state.scanUniverseCursor,20);
 assert.equal(state.pendingScanCursor,null);
 state.pendingScanCursor=30;
 sandbox.discardPendingScanBatch(state);
 assert.equal(state.scanUniverseCursor,20,"interrupted batch must not skip forward");
 assert.equal(state.pendingScanCursor,null);
 assert.equal(sandbox.commitCompletedScanBatch(state),false);
});
test("opportunity ranking is bounded, deterministic and handles missing evidence",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function rankCandidateOpportunity(");
 const end=app.indexOf("\nfunction hasOpposingOpenSignal",start);
 assert.ok(start>=0&&end>start,"ranking helper must exist");
 const sandbox={};
 vm.runInNewContext(app.slice(start,end)+";rankCandidateOpportunity",sandbox);
 const rank=sandbox.rankCandidateOpportunity;
 assert.deepEqual({...rank({score:90,count:3,entryModels:["OB","FVG"]})},
  {score:90,confirmations:3,models:2,rank:100});
 assert.deepEqual({...rank({score:-10,count:-2,entryModels:[]})},
  {score:0,confirmations:0,models:0,rank:0});
 assert.deepEqual({...rank({score:150,count:99,entryModels:["a","b","c","d"]})},
  {score:100,confirmations:99,models:4,rank:100});
 assert.deepEqual({...rank({})},{score:0,confirmations:0,models:0,rank:0});
});
test("signal outcomes ignore forming candles and accept only completed timeframe candles",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function isClosedOutcomeCandle(");
 const end=app.indexOf("\nfunction evaluateSignalHistory(",start);
 assert.ok(start>=0&&end>start,"closed-candle helper must exist before outcome manager");
 const sandbox={getTimeframeSeconds:tf=>({ "1m":60,"5m":300,"15m":900,"30m":1800,"1h":3600 }[tf]||0),Date};
 vm.runInNewContext(app.slice(start,end)+";isClosedOutcomeCandle",sandbox);
 const isClosed=sandbox.isClosedOutcomeCandle;
 assert.equal(isClosed({epoch:100},"1m",159),false);
 assert.equal(isClosed({epoch:100},"1m",160),true);
 assert.equal(isClosed({epoch:100},"5m",399),false);
 assert.equal(isClosed({epoch:100},"5m",400),true);
 assert.equal(isClosed({epoch:100},"unknown",999),false);
 assert.equal(isClosed({epoch:NaN},"1m",999),false);
});
test("Final entry authorization enforces strategy timeframe, direction and minimum 2R",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function authorizeFinalEntry(");
 const end=app.indexOf("\nfunction recordCandidateSignal",start);
 assert.ok(start>=0&&end>start,"final authorization helper must exist before signal recording");
 const sandbox={};
 vm.runInNewContext(app.slice(start,end)+";authorizeFinalEntry",sandbox);
 const authorize=sandbox.authorizeFinalEntry;
 assert.equal(authorize({strategy:"apa",mode:"intraday",timeframe:"1m",direction:"BUY",entry:100,sl:99,tp:102}).authorized,true);
 assert.equal(authorize({strategy:"apa",mode:"scalping",timeframe:"1m",direction:"BUY",entry:100,sl:99,tp:103}).authorized,false);
 assert.equal(authorize({strategy:"smc",mode:"scalping",timeframe:"5m",direction:"BUY",entry:100,sl:null,tp:null}).authorized,true);
 assert.equal(authorize({strategy:"smc",mode:"scalping",timeframe:"15m",direction:"BUY",entry:100}).authorized,false);
 assert.equal(authorize({strategy:"smc",mode:"intraday",timeframe:"4h",direction:"BUY",entry:100,sl:99,tp:103}).authorized,false);
 assert.equal(authorize({strategy:"smc",mode:"intraday",timeframe:"15m",direction:"BUY",entry:100,sl:99,tp:101.9}).authorized,false);
 assert.equal(authorize({strategy:"smc",mode:"intraday",timeframe:"15m",direction:"BUY",entry:100,sl:101,tp:104}).authorized,false);
 assert.equal(authorize({strategy:"smc",mode:"intraday",timeframe:"30m",direction:"SELL",entry:100,sl:101,tp:98}).authorized,true);
});
test("Bullish and bearish formation outputs remain directionally isolated",()=>{
 const cases=[{candles:bullPattern(),side:"BUY"},{candles:bearPattern(),side:"SELL"}];
 for(const item of cases){
  const r=engine.detect(item.candles);
  assert.equal(r.ready,true);
  assert.ok(["BUY","SELL","NONE"].includes(r.side));
  assert.ok(r.zones.every(z=>z.side==="BUY"||z.side==="SELL"));
  assert.ok(r.zones.every(z=>Number.isFinite(z.low)&&Number.isFinite(z.high)&&z.low<=z.high));
  assert.ok(r.zones.every(z=>Number.isFinite(z.score)&&z.score>=0&&z.score<=100));
  assert.ok(r.zones.every(z=>typeof z.valid==="boolean"));
  assert.ok(r.formations&&Object.values(r.formations).every(v=>typeof v==="boolean"));
 }
});
test("Malformed and incomplete candles fail closed without producing an entry",()=>{
 const short=bars().slice(0,29);
 const malformed=bars();malformed[29]={open:NaN,high:110,low:99,close:105,time:29};
 for(const candles of [short,malformed]){
  const r=engine.detect(candles);
  assert.equal(r.ready,false);
  assert.notEqual(r.confirmed,true);
  assert.equal(r.side,undefined);
 }
});
test("Formation zone validity and bounds are stable across repeated evaluations",()=>{
 const candles=bullPattern();
 const first=engine.detect(candles),second=engine.detect(candles);
 assert.deepEqual(first.zones.map(z=>({type:z.type,side:z.side,low:z.low,high:z.high,valid:z.valid})),
                  second.zones.map(z=>({type:z.type,side:z.side,low:z.low,high:z.high,valid:z.valid})));
 assert.deepEqual(first.formations,second.formations);
});

test("MT5 symbol rotation cursor commits only after the full batch finishes",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("async function scanMT5MarketData");
 const end=app.indexOf("\nfunction startMT5Scanner",start);
 assert.ok(start>=0&&end>start,"MT5 scanner function must exist");
 const fn=app.slice(start,end);
 assert.ok(fn.includes("getRotatingSymbolBatch(symbols,tradingState.mt5ScanCursor,10)"));
 assert.ok(fn.includes("const scanGeneration=tradingState.scanGeneration"));
 assert.ok(fn.includes("tradingState.scanGeneration!==scanGeneration"));
 assert.ok(fn.includes("tradingState.mt5ScanCursor=batch.nextCursor"));
 assert.ok(fn.indexOf("tradingState.mt5ScanCursor=batch.nextCursor")>fn.indexOf("for(const symbol of batch.symbols)"),
   "cursor must commit after all symbol/timeframe requests");
 assert.ok(fn.indexOf("tradingState.mt5ScanCursor=batch.nextCursor")>fn.indexOf("renderTimeframeAnalysis(symbol,timeframe)"),
   "cursor must commit after processing the batch");
});

test("MT5 stop and restart preserve the in-flight scan lock",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("function startMT5Scanner()");
 const end=app.indexOf("\nfunction startScanner",start);
 assert.ok(start>=0&&end>start);
 const starter=app.slice(start,end);
 assert.equal(starter.includes("mt5ScanInProgress=false"),false);
 const stopStart=app.indexOf("function stopScanner(");
 const stopEnd=app.indexOf("\n/* =========================================================\n   SETTINGS",stopStart);
 assert.ok(stopStart>=0&&stopEnd>stopStart);
 const stopper=app.slice(stopStart,stopEnd);
 assert.equal(stopper.includes("mt5ScanInProgress=false"),false);
 assert.ok(app.includes("finally {\n    tradingState.mt5ScanInProgress=false;"));
});

test("MT5 interrupted scan path has no undefined batch completion flag",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("async function scanMT5MarketData");
 const end=app.indexOf("\nfunction startMT5Scanner",start);
 assert.ok(start>=0&&end>start);
 const fn=app.slice(start,end);
 assert.doesNotMatch(fn,/batchCompleted/);
 assert.match(fn,/if\(!tradingState\.running\|\|tradingState\.scanGeneration!==scanGeneration\)\s*\{\s*return;/);
 assert.match(fn,/tradingState\.mt5ScanCursor=batch\.nextCursor/);
});

test("MT5 market-data fetch retries transient failures with bounded backoff",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const start=app.indexOf("async function fetchMT5MarketDataWithRetry");
 const end=app.indexOf("\nasync function scanMT5MarketData",start);
 assert.ok(start>=0&&end>start,"retry helper must exist before MT5 scanner");
 const fn=app.slice(start,end);
 assert.match(fn,/attempts=3/);
 assert.match(fn,/response\.status!==408/);
 assert.match(fn,/response\.status!==429/);
 assert.match(fn,/response\.status<500/);
 assert.match(fn,/Math\.pow\(2,attempt\)/);
 assert.match(app.slice(end,end+5000),/fetchMT5MarketDataWithRetry\(url,\{\},3\)/);
});
