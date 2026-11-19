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
 assert.equal(engine.frames.join(","),"1m,5m,15m,30m,1h");
 assert.equal(engine.state.latest.size,5);
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
  assert.equal(r.confirmed,tf==="1m"||tf==="5m",tf+" confirmation mismatch");
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

test("invalid candles are rejected",()=>{
 const c=bars();c[0].high=NaN;const r=engine.detect(c);assert.equal(r.ready,false);
});
console.log("SMC synthetic test suite: "+passed+" passed; "+(process.exitCode? "failures present":"all passed"));
