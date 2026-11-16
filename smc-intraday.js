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
    if(!Array.isArray(candles)||candles.length<30||!candles.every(valid)) return {ready:false,status:"Need 30 valid candles"};
    const cs=candles, c=cs.at(-1), p=cs.at(-2), prior=cs.slice(-22,-2), recent=cs.slice(-12,-2);
    const ph=hi(prior), pl=lo(prior), rh=hi(recent), rl=lo(recent);
    const range=Math.max(N(c.high)-N(c.low),1e-12), body=Math.abs(N(c.close)-N(c.open));
    const bull=c.close>c.open, bear=c.close<c.open, bodyRatio=body/range;
    const bullSweep=N(c.low)<pl && N(c.close)>pl, bearSweep=N(c.high)>ph && N(c.close)<ph;
    const bullDisplacement=bull&&bodyRatio>=.60&&N(c.close)>N(p.high);
    const bearDisplacement=bear&&bodyRatio>=.60&&N(c.close)<N(p.low);
    const bullBOS=N(c.close)>ph, bearBOS=N(c.close)<pl;
    // Local swing points and structure shifts (simple confirmed pivot approximation).
    const w=cs.slice(-8,-2), swingHigh=hi(w), swingLow=lo(w);
    const bullMSS=bull&&N(c.close)>swingHigh&&N(p.close)<=swingHigh;
    const bearMSS=bear&&N(c.close)<swingLow&&N(p.close)>=swingLow;
    const bullFVG=N(cs.at(-2).low)>N(cs.at(-4).high), bearFVG=N(cs.at(-2).high)<N(cs.at(-4).low);
    const bullIFVG=bull&&N(c.close)>N(cs.at(-4).high)&&N(p.close)<=N(cs.at(-4).high);
    const bearIFVG=bear&&N(c.close)<N(cs.at(-4).low)&&N(p.close)>=N(cs.at(-4).low);
    const eqTol=range*.08;
    const eqh=Math.abs(N(cs.at(-3).high)-N(cs.at(-7).high))<=eqTol;
    const eql=Math.abs(N(cs.at(-3).low)-N(cs.at(-7).low))<=eqTol;
    // Candidate OB: last opposite candle before a displacement; breaker if later decisively crossed.
    const findOpp=(direction)=>{for(let i=cs.length-3;i>=Math.max(0,cs.length-12);i--){if(direction==="bull"&&cs[i].close<cs[i].open)return {low:N(cs[i].low),high:N(cs[i].high),index:i};if(direction==="bear"&&cs[i].close>cs[i].open)return {low:N(cs[i].low),high:N(cs[i].high),index:i};}return null;};
    const bullOB=bullDisplacement?findOpp("bull"):null, bearOB=bearDisplacement?findOpp("bear"):null;
    const bullBreaker=bull&&N(c.close)>N(p.high)&&bearOB&&N(c.close)>bearOB.high;
    const bearBreaker=bear&&N(c.close)<N(p.low)&&bullOB&&N(c.close)<bullOB.low;
    // Track zones through touched/reaction/mitigation/invalidation lifecycle.
    const zones=[];
    const addZone=(type,z,side)=>{if(!z)return;const touched=N(c.low)<=z.high&&N(c.high)>=z.low;const invalid=side==="BUY"?N(c.close)<z.low:N(c.close)>z.high;const reaction=side==="BUY"?bull&&N(c.close)>z.high:bear&&N(c.close)<z.low;zones.push({type,side,low:z.low,high:z.high,status:invalid?"invalidated":reaction?"reacting":touched?"touched":"fresh"});};
    addZone("Bull OB",bullOB,"BUY");addZone("Bear OB",bearOB,"SELL");
    if(bullFVG)addZone("Bull FVG",{low:N(cs.at(-4).high),high:N(cs.at(-2).low)},"BUY");
    if(bearFVG)addZone("Bear FVG",{low:N(cs.at(-2).high),high:N(cs.at(-4).low)},"SELL");
    // Supply/demand approximations from recent range extremes; context, not standalone entry.
    addZone("Demand",{low:rl,high:rl+range*.20},"BUY");
    addZone("Supply",{low:rh-range*.20,high:rh},"SELL");
    const buy={sweep:bullSweep,structure:bullBOS||bullMSS,displacement:bullDisplacement,imbalance:bullFVG||bullIFVG,breaker:bullBreaker};
    const sell={sweep:bearSweep,structure:bearBOS||bearMSS,displacement:bearDisplacement,imbalance:bearFVG||bearIFVG,breaker:bearBreaker};
    const bc=Object.values(buy).filter(Boolean).length, sc=Object.values(sell).filter(Boolean).length;
    const side=bc>sc?"BUY":sc>bc?"SELL":"NONE", conf=side==="BUY"?buy:side==="SELL"?sell:{};
    const count=Object.values(conf).filter(Boolean).length;
    // Two aligned confirmations minimum; structure + displacement required for this initial gate.
    const confirmed=side!=="NONE"&&count>=2&&conf.structure&&conf.displacement;
    const score=Math.min(100,count*18+(conf.sweep?10:0)+(conf.imbalance?10:0)+(conf.breaker?8:0));
    return {ready:true,side,confirmations:conf,count,confirmed,score,price:N(c.close),zones,
      formations:{BOS:bullBOS||bearBOS,MSS:bullMSS||bearMSS,CHoCH:bullMSS||bearMSS,
      liquiditySweep:bullSweep||bearSweep,EQH:eqh,EQL:eql,FVG:bullFVG||bearFVG,IFVG:bullIFVG||bearIFVG,
      orderBlock:!!(bullOB||bearOB),breakerBlock:bullBreaker||bearBreaker,
      displacement:bullDisplacement||bearDisplacement,inducement:false},
      note:"EQH/EQL and zone boundaries are heuristic; verify on chart."};
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
  window.SMCIntradayEngine={frames:FRAMES.slice(),evaluate,best,state};
})();