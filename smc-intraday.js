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
    const zones=[];
    const addZone=(type,z,side,origin)=>{if(!z)return;const touched=cs.slice(origin+1).some(x=>N(x.low)<=z.high&&N(x.high)>=z.low);
      const invalid=side==="BUY"?N(c.close)<z.low:N(c.close)>z.high;
      const inZone=N(c.low)<=z.high&&N(c.high)>=z.low;
      const reaction=side==="BUY"?bull&&N(c.close)>z.high:bear&&N(c.close)<z.low;
      const stateName=invalid?"invalidated":reaction&&inZone?"reacting":touched?"tested":inZone?"touching":"fresh";
      zones.push({id:type+"-"+origin,type,side,low:z.low,high:z.high,origin,status:stateName,valid:!invalid,tests:cs.slice(origin+1).filter(x=>N(x.low)<=z.high&&N(x.high)>=z.low).length});};
    if(bullOB)addZone("Order Block",bullOB,"BUY",bullOB.index);
    if(bearOB)addZone("Order Block",bearOB,"SELL",bearOB.index);
    if(bullFVG)addZone("FVG",{low:N(cs.at(-4).high),high:N(cs.at(-2).low)},"BUY",cs.length-3);
    if(bearFVG)addZone("FVG",{low:N(cs.at(-2).high),high:N(cs.at(-4).low)},"SELL",cs.length-3);
    // Liquidity sweep/reclaim zones and recent range supply/demand are contextual candidates.
    if(bullSweep)addZone("Sweep reclaim",{low:pl,high:N(c.low)},"BUY",cs.length-1);
    if(bearSweep)addZone("Sweep reclaim",{low:N(c.high),high:ph},"SELL",cs.length-1);
    addZone("Demand",{low:rl,high:rl+range*.20},"BUY",cs.length-12);
    addZone("Supply",{low:rh-range*.20,high:rh},"SELL",cs.length-12);
    const buy={sweep:bullSweep,structure:bullBOS||bullMSS,displacement:bullDisp,imbalance:bullFVG||bullIFVG,breaker:!!bullBreaker};
    const sell={sweep:bearSweep,structure:bearBOS||bearMSS,displacement:bearDisp,imbalance:bearFVG||bearIFVG,breaker:!!bearBreaker};
    const bc=Object.values(buy).filter(Boolean).length,sc=Object.values(sell).filter(Boolean).length;
    const side=bc>sc?"BUY":sc>bc?"SELL":"NONE",conf=side==="BUY"?buy:side==="SELL"?sell:{},count=Object.values(conf).filter(Boolean).length;
    const conflict=bc>0&&sc>0&&Math.abs(bc-sc)<2;
    const activeZones=zones.filter(z=>z.valid&&z.side===side);
    const zoneSupport=activeZones.some(z=>z.status==="fresh"||z.status==="tested"||z.status==="reacting"||z.status==="touching");
    const confirmed=side!=="NONE"&&!conflict&&count>=2&&conf.structure&&conf.displacement&&zoneSupport;
    const score=Math.min(100,count*16+(conf.sweep?12:0)+(conf.imbalance?10:0)+(conf.breaker?8:0)+(zoneSupport?8:0)-(conflict?25:0));
    return {ready:true,side,confirmations:conf,count,confirmed,conflict,score,price:N(c.close),zones,
      formations:{BOS:bullBOS||bearBOS,MSS:bullMSS||bearMSS,CHoCH:bullMSS||bearMSS,liquiditySweep:bullSweep||bearSweep,EQH:eqh,EQL:eql,FVG:bullFVG||bearFVG,IFVG:bullIFVG||bearIFVG,orderBlock:!!(bullOB||bearOB),breakerBlock:!!(bullBreaker||bearBreaker),displacement:bullDisp||bearDisp,inducement:false},
      note:conflict?"Conflicting BUY/SELL evidence — blocked.":"Zone status is heuristic; replay/backtest required."};
  }

  function makeEntryPlan(record, candles, rr=2) {
    if(!record||!record.confirmed||!Array.isArray(candles)||candles.length<15) return null;
    const side=record.side, price=Number(record.price);
    const candidates=(record.zones||[]).filter(z=>z.valid&&z.side===side&&["fresh","tested","reacting","touching"].includes(z.status));
    if(!candidates.length)return {blocked:true,reason:"No valid supporting zone"};
    // Choose the closest zone to current price; prefer a reacting/tested zone on equal distance.
    candidates.sort((a,b)=>{
      const da=price<a.low?a.low-price:price>a.high?price-a.high:0;
      const db=price<b.low?b.low-price:price>b.high?price-b.high:0;
      const pa=(a.status==="reacting"?-0.15:a.status==="tested"?-0.08:0);
      const pb=(b.status==="reacting"?-0.15:b.status==="tested"?-0.08:0);
      return (da+pa)-(db+pb);
    });
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