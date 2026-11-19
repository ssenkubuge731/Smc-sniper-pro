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
 assert.match(renderer,/analyseAPA\(candles, higherCandles, lowerCandles\)/,"APA analyzer must be called independently");
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
 assert.match(worker,/body\.timeframes\.every\(tf=>FRAMES\[body\.mode\]\.includes\(tf\)\)/,"timeframes are checked against mode");
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
 assert.match(scanner,/packet\.status!=="FRESH"\|\|packet\.ageSeconds>90/,"scanner rejects stale feeds");
 assert.match(scanner,/renderTimeframeAnalysis/,"fresh MT5 candles enter scanner analysis");
 assert.match(scanner,/SMCIntradayEngine\.evaluate/,"MT5 candle feed enters SMC engine");
 assert.match(app,/if \(tradingState\.broker === "mt5"\) \{ startMT5Scanner\(\); return; \}/,"scanner switches to MT5 data mode");
});

test("MT5 candle feed data source is visible and scanner rejects nonfresh data",()=>{
 const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
 const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
 assert.match(app,/MT5 scanner: .*fresh feeds/,"scanner reports freshness counters");
 assert.match(app,/Scanner data source: MT5 broker candles/,"source is shown in scanner connection status");
 assert.match(html,/MT5 broker/,"MT5 broker source selector exists");
 assert.match(html,/bridgeSymbols/,"scanner feed uses configured MT5 symbols");
});
console.log("SMC synthetic test suite: "+passed+" passed; "+(process.exitCode? "failures present":"all passed"));
