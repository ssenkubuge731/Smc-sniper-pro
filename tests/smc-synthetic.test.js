// Synthetic tests for the actual SMC Intraday Engine (signal-only).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("smc-intraday.js", "utf8");
const fakeWindow = { dispatchEvent(){} };
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
 const c=bars(101); for(let i=0;i<c.length;i++)c[i]={open:100.5,high:102,low:99.5,close:100.2,time:i};
 c[25]={open:100.4,high:102,low:99.5,close:100.1,time:25};
 c[26]={open:100.8,high:101,low:98.5,close:100.1,time:26};
 c[27]={open:100.2,high:101.5,low:99.5,close:100.8,time:27};
 c[28]={open:103.8,high:104.5,low:103.5,close:104.2,time:28};
 c[29]={open:100,high:108.5,low:98,close:108,time:29};return c;
}
function bearPattern(){
 const c=bars(100);for(let i=0;i<c.length;i++)c[i]={open:100.5,high:102,low:99.5,close:100.2,time:i};
 c[25]={open:100.5,high:102,low:99.5,close:100.1,time:25};
 c[26]={open:102,high:103,low:100.5,close:101,time:26};
 c[27]={open:100.5,high:101.5,low:99.5,close:100,time:27};
 c[28]={open:99,high:99.5,low:98.5,close:98.8,time:28};
 c[29]={open:101,high:104,low:92,close:92.5,time:29};return c;
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
test("invalid candles are rejected",()=>{
 const c=bars();c[0].high=NaN;const r=engine.detect(c);assert.equal(r.ready,false);
});
console.log("SMC synthetic test suite: "+passed+" passed; "+(process.exitCode? "failures present":"all passed"));
