/* SMC INTRADAY ENGINE — independent from APA; signal-only */
(function () {
  "use strict";
  const FRAMES = ["1m","5m","15m","30m","1h","4h"];
  const state = { latest:new Map(), zones:new Map(), lastPublished:new Map() };
  const N = (x)=>Number(x);
  const valid = c=>c && Number.isFinite(N(c.open)) && Number.isFinite(N(c.high)) && Number.isFinite(N(c.low)) && Number.isFinite(N(c.close));
  const hi = xs=>Math.max(...xs.map(x=>N(x.high)));
  const lo = xs=>Math.min(...xs.map(x=>N(x.low)));
  function detect(candles) {
    if(!Array.isArray(candles)||candles.length<30||!candles.every(valid))return {ready:false,status:"Need 30 valid candles"};
    const cs=candles,c=cs.at(-1),p=cs.at(-2),prior=cs.slice(-22,-2),recent=cs.slice(-12,-2);
    const ph=hi(prior),pl=lo(prior),rh=hi(recent),rl=lo(recent);
    const range=Math.max(N(c.high)-N(c.low),1e-12),body=Math.abs(N(c.close)-N(c.open));
    const bull=N(c.close)>N(c.open),bear=N(c.close)<N(c.open),ratio=body/range;
    const bullSweep=N(c.low)<pl&&N(c.close)>pl,bearSweep=N(c.high)>ph&&N(c.close)<ph;
    const bullDisp=bull&&ratio>=.60&&N(c.close)>N(p.high),bearDisp=bear&&ratio>=.60&&N(c.close)<N(p.low);
    const bullBOS=N(c.close)>ph,bearBOS=N(c.close)<pl;
    const sh=hi(cs.slice(-8,-2)),sl=lo(cs.slice(-8,-2));
    const bullMSS=bull&&N(c.close)>sh&&N(p.close)<=sh,bearMSS=bear&&N(c.close)<sl&&N(p.close)>=sl;
    const bullFVG=N(cs.at(-2).low)>N(cs.at(-4).high),bearFVG=N(cs.at(-2).high)<N(cs.at(-4).low);
    const bullIFVG=bull&&N(c.close)>N(cs.at(-4).high)&&N(p.close)<=N(cs.at(-4).high);
    const bearIFVG=bear&&N(c.close)<N(cs.at(-4).low)&&N(p.close)>=N(cs.at(-4).low);
    const eqTol=Math.max(range*.08,(ph-pl)*.015);
    const eqh=Math.abs(N(cs.at(-3).high)-N(cs.at(-7).high))<=eqTol,eql=Math.abs(N(cs.at(-3).low)-N(cs.at(-7).low))<=eqTol;
    const findOpp=d=>{for(let i=cs.length-3;i>=Math.max(0,cs.length-12);i--){if(d==="bull"&&cs[i].close<cs[i].open)return {low:N(cs[i].low),high:N(cs[i].high),index:i};if(d==="bear"&&cs[i].close>cs[i].open)return {low:N(cs[i].low),high:N(cs[i].high),index:i};}return null;};
    const bullOB=bullDisp?findOpp("bull"):null,bearOB=bearDisp?findOpp("bear"):null;
    const bullBreaker=bull&&bearOB&&N(c.close)>bearOB.high,bearBreaker=bear&&bullOB&&N(c.close)<bullOB.low;
    // Build a rolling catalogue of independent POIs, not just the latest OB/FVG.
    const zones=[],zoneStart=Math.max(2,cs.length-45);
    const addZone=(type,z,side,origin,impulse=false)=>{if(!z||!Number.isFinite(N(z.low))||!Number.isFinite(N(z.high))||N(z.high)<=N(z.low))return;
      const loZ=Math.min(N(z.low),N(z.high)),hiZ=Math.max(N(z.low),N(z.high));
      const touches=cs.slice(origin+1).filter(x=>N(x.low)<=hiZ&&N(x.high)>=loZ);
      const touched=touches.length>0,invalid=side==="BUY"?N(c.close)<loZ:N(c.close)>hiZ;
      const inZone=N(c.low)<=hiZ&&N(c.high)>=loZ;
      const reaction=inZone&&(side==="BUY"?bull&&N(c.close)>hiZ:bear&&N(c.close)<loZ);
      const status=invalid?"invalidated":reaction?"reacting":inZone?"touching":touched?"tested":"fresh";
      const age=cs.length-1-origin,tests=touches.length;
      const width=hiZ-loZ,mid=(hiZ+loZ)/2,dist=Math.abs(N(c.close)-mid);
      const distancePenalty=Math.min(18,dist/Math.max(range,1e-12)*5);
      const freshBonus=status==="fresh"?18:status==="tested"?5:status==="reacting"?9:0;
      const score=Math.max(0,Math.min(100,35+(impulse?18:0)+freshBonus-Math.min(20,age*.35)-Math.min(24,tests*8)-distancePenalty));
      zones.push({id:type+"-"+String(cs[origin].time??cs[origin].timestamp??origin),type,side,low:loZ,high:hiZ,origin,status,valid:!invalid,tests,age,impulse,score,mid,distance:dist});
    };
    // Historical three-candle fair value gaps.
    for(let i=Math.max(2,zoneStart);i<cs.length;i++){
      if(N(cs[i-2].high)<N(cs[i].low))addZone("FVG",{low:N(cs[i-2].high),high:N(cs[i].low)},"BUY",i,Math.abs(N(cs[i-1].close)-N(cs[i-1].open))/Math.max(N(cs[i-1].high)-N(cs[i-1].low),1e-12)>=.6);
      if(N(cs[i-2].low)>N(cs[i].high))addZone("FVG",{low:N(cs[i].high),high:N(cs[i-2].low)},"SELL",i,Math.abs(N(cs[i-1].close)-N(cs[i-1].open))/Math.max(N(cs[i-1].high)-N(cs[i-1].low),1e-12)>=.6);
    }
    // Historical order blocks: last opposing candle before a strong directional candle.
    for(let i=Math.max(3,zoneStart);i<cs.length;i++){
      const bar=cs[i],br=Math.max(N(bar.high)-N(bar.low),1e-12),strong=Math.abs(N(bar.close)-N(bar.open))/br>=.6;
      if(!strong)continue;
      for(let j=i-1;j>=Math.max(0,i-4);j--){
        if(N(bar.close)>N(bar.open)&&N(cs[j].close)<N(cs[j].open)){addZone("Order Block",{low:N(cs[j].low),high:N(cs[j].high)},"BUY",j,true);break;}
        if(N(bar.close)<N(bar.open)&&N(cs[j].close)>N(cs[j].open)){addZone("Order Block",{low:N(cs[j].low),high:N(cs[j].high)},"SELL",j,true);break;}
      }
    }
    // Current sweep-reclaim and rolling range supply/demand candidates.
    if(bullSweep)addZone("Sweep reclaim",{low:pl,high:N(c.low)},"BUY",cs.length-1,true);
    if(bearSweep)addZone("Sweep reclaim",{low:N(c.high),high:ph},"SELL",cs.length-1,true);
    addZone("Demand",{low:rl,high:rl+range*.20},"BUY",cs.length-12,false);
    addZone("Supply",{low:rh-range*.20,high:rh},"SELL",cs.length-12,false);
    // Rank valid candidates by freshness, origin impulse, mitigation and distance.
    for(const z of zones){const overlaps=zones.filter(q=>q!==z&&q.side===z.side&&q.low<=z.high&&q.high>=z.low).length;z.confluence=overlaps;z.score=Math.min(100,z.score+Math.min(15,overlaps*5));}
    zones.sort((a,b)=>b.score-a.score);
    // Flexible SMC model matrix: a setup may qualify through several distinct
    // valid routes; no fixed "two entry patterns" restriction is imposed.
    const buy={sweep:bullSweep,structure:bullBOS||bullMSS,displacement:bullDisp,imbalance:bullFVG||bullIFVG,breaker:!!bullBreaker,choch:bullMSS,ob:!!bullOB};
    const sell={sweep:bearSweep,structure:bearBOS||bearMSS,displacement:bearDisp,imbalance:bearFVG||bearIFVG,breaker:!!bearBreaker,choch:bearMSS,ob:!!bearOB};
    const models=(x)=>[
      {name:"Sweep → MSS → displacement",ok:x.sweep&&x.choch&&x.displacement},
      {name:"BOS → displacement → imbalance",ok:x.structure&&x.displacement&&x.imbalance},
      {name:"Breaker → structure → displacement",ok:x.breaker&&x.structure&&x.displacement},
      {name:"POI reaction → structure → displacement",ok:x.ob&&x.structure&&x.displacement},
      {name:"MSS → displacement → FVG",ok:x.choch&&x.displacement&&x.imbalance},
      {name:"Liquidity reclaim → BOS → FVG",ok:x.sweep&&x.structure&&x.imbalance}
    ].filter(m=>m.ok).map(m=>m.name);
    const buyModels=models(buy),sellModels=models(sell);
    const bc=Object.values(buy).filter(Boolean).length,sc=Object.values(sell).filter(Boolean).length;
    const conflict=bc>0&&sc>0&&Math.abs(bc-sc)<2;
    const side=buyModels.length>sellModels.length?"BUY":sellModels.length>buyModels.length?"SELL":"NONE";
    const conf=side==="BUY"?buy:side==="SELL"?sell:{},count=Object.values(conf).filter(Boolean).length;
    const activeZones=zones.filter(z=>z.valid&&z.side===side&&["fresh","tested","reacting","touching"].includes(z.status));
    const zoneSupport=activeZones.length>0;
    const entryModels=side==="BUY"?buyModels:side==="SELL"?sellModels:[];
    const confirmed=side!=="NONE"&&!conflict&&entryModels.length>0&&zoneSupport;
    const score=Math.min(100,entryModels.length*18+count*7+(conf.sweep?8:0)+(conf.imbalance?8:0)+(conf.breaker?10:0)+(zoneSupport?8:0)-(conflict?30:0));
    return {ready:true,side,confirmations:conf,count,confirmed,conflict,score,entryModels,price:N(c.close),zones,
      formations:{BOS:bullBOS||bearBOS,MSS:bullMSS||bearMSS,CHoCH:bullMSS||bearMSS,liquiditySweep:bullSweep||bearSweep,EQH:eqh,EQL:eql,FVG:bullFVG||bearFVG,IFVG:bullIFVG||bearIFVG,orderBlock:!!(bullOB||bearOB),breakerBlock:!!(bullBreaker||bearBreaker),displacement:bullDisp||bearDisp,inducement:false},
      note:conflict?"Conflicting BUY/SELL evidence — blocked.":entryModels.length?"Qualified model(s): "+entryModels.join(" | "):"No complete SMC entry model yet; wait for confirmation."};
  }

  function makeEntryPlan(record, candles, rr=2) {
    if(!record||!record.confirmed||!Array.isArray(candles)||candles.length<15) return null;
    const side=record.side, price=Number(record.price);
    const candidates=(record.zones||[]).filter(z=>z.valid&&z.side===side&&["fresh","tested","reacting","touching"].includes(z.status));
    if(!candidates.length)return {blocked:true,reason:"No valid supporting zone"};
    // Strength-first selection: a fresh, high-quality zone can outrank a nearer weak zone.
    candidates.sort((a,b)=>(b.score||0)-(a.score||0)||a.distance-b.distance);
    const z=candidates[0], entry=(z.low+z.high)/2;
    const tr=candles.slice(-14); let sum=0;
    for(let i=1;i<tr.length;i++)sum+=Math.max(Number(tr[i].high)-Number(tr[i].low),Math.abs(Number(tr[i].high)-Number(tr[i-1].close)),Math.abs(Number(tr[i].low)-Number(tr[i-1].close)));
    const atr=sum/(tr.length-1),buffer=Math.max(atr*.12,(z.high-z.low)*.08);
    const sl=side==="BUY"?z.low-buffer:z.high+buffer;
    const risk=Math.abs(entry-sl);
    if(!Number.isFinite(risk)||risk<=0)return {blocked:true,reason:"Invalid risk distance"};
    const tp1=side==="BUY"?entry+risk*1.5:entry-risk*1.5;
    const tp2=side==="BUY"?entry+risk*rr:entry-risk*rr;
    const tp3=side==="BUY"?entry+risk*3:entry-risk*3;
    return {blocked:false,side,zone:z.type,zoneStatus:z.status,zoneLow:z.low,zoneHigh:z.high,entry,sl,risk,tp1,tp2,tp3,rr,method:"Zone midpoint entry preview; SL beyond zone + ATR buffer",warning:"Illustrative levels only; spread, tick size, contract rules and chart validation required."};
  }
  function backtest(candles,opts={}){
    const minBars=Math.max(30,opts.warmup||40),horizon=Math.max(5,opts.horizon||30),rr=Number(opts.rr||2);
    const trades=[];let wins=0,losses=0,ambiguous=0;
    if(!Array.isArray(candles)||candles.length<minBars+horizon)return {error:"Need at least "+(minBars+horizon)+" candles."};
    for(let i=minBars;i<candles.length-horizon;i++){
      const history=candles.slice(0,i+1),record=detect(history);
      if(!record.ready||!record.confirmed)continue;
      const plan=makeEntryPlan(record,history,rr);if(!plan||plan.blocked)continue;
      const entry=Number(record.price),sl=Number(plan.sl),tp=Number(plan.tp2);
      let outcome="OPEN",exitPrice=null,bars=0;
      for(let j=i+1;j<=Math.min(candles.length-1,i+horizon);j++){
        const bar=candles[j],hitSL=record.side==="BUY"?Number(bar.low)<=sl:Number(bar.high)>=sl;
        const hitTP=record.side==="BUY"?Number(bar.high)>=tp:Number(bar.low)<=tp;
        bars++;
        if(hitSL&&hitTP){outcome="AMBIGUOUS_SL_FIRST";exitPrice=sl;ambiguous++;break;}
        if(hitSL){outcome="SL";exitPrice=sl;break;}
        if(hitTP){outcome="TP2";exitPrice=tp;break;}
      }
      const r=record.side==="BUY"?(exitPrice-entry)/Math.abs(entry-sl):(entry-exitPrice)/Math.abs(entry-sl);
      if(outcome==="TP2")wins++;else if(outcome==="SL"||outcome==="AMBIGUOUS_SL_FIRST")losses++;
      trades.push({index:i,side:record.side,score:record.score,entry,sl,tp,outcome,bars,r:exitPrice===null?null:r});
      i+=Math.max(0,bars-1); // avoid overlapping entries while one setup is being resolved
    }
    const resolved=wins+losses,rs=trades.filter(t=>t.r!==null).map(t=>t.r);
    return {trades,total:trades.length,wins,losses,ambiguous,open:trades.filter(t=>t.outcome==="OPEN").length,
      winRate:resolved?100*wins/resolved:0,avgR:rs.length?rs.reduce((a,b)=>a+b,0)/rs.length:0,
      note:"Candle replay approximation. If one candle hits SL and TP, SL is counted first. No spread/slippage/commission; not proof of profitability."};
  }
  function evaluate(symbol,timeframe,candles){
    if(!FRAMES.includes(timeframe))return null;
    const result=detect(candles),key=symbol+"|"+timeframe,record=Object.assign({symbol,timeframe,time:Date.now()},result);
    state.latest.set(key,record);state.zones.set(key,result.zones||[]);
    if(record.confirmed){const sig=key+"|"+record.side+"|"+record.count;if(state.lastPublished.get(key)!==sig){state.lastPublished.set(key,sig);window.dispatchEvent(new CustomEvent("smc:signal",{detail:record}));}}
    return record;
  }
  function best(symbol){
    const list=FRAMES.map(tf=>state.latest.get(symbol+"|"+tf)).filter(x=>x&&x.confirmed);
    // Prefer higher evidence; on tie prefer context frames (15m/30m/1h) over noisy 1m.
    const rank={ "1m":1,"5m":2,"15m":4,"30m":5,"1h":4,"4h":3 };
    return list.sort((a,b)=>b.score-a.score||(rank[b.timeframe]||0)-(rank[a.timeframe]||0))[0]||null;
  }
  window.SMCIntradayEngine={frames:FRAMES.slice(),evaluate,best,makeEntryPlan,backtest,state};
})();