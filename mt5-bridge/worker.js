/**
 * SMC Sniper Pro APA — authenticated MT5 read-only bridge.
 * Routes: public heartbeat/config status; authenticated heartbeat, status, config read/write.
 * No order/trading command routes are implemented.
 */
const MAX_BODY_BYTES = 32768;
const MARKET_DATA_TTL_SECONDS = 180;
const HEARTBEAT_TTL_SECONDS = 7 * 24 * 60 * 60;
const CONFIG_TTL_SECONDS = 30 * 24 * 60 * 60;
const SITE_ORIGIN = "https://ssenkubuge731.github.io";
const FRAMES = {
  scalping: ["1m", "5m"],
  intraday: ["1m", "5m", "15m", "30m", "1h"],
  swing: ["1h", "4h", "1d"]
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {status,headers:{
    "Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",
    "X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":SITE_ORIGIN,"Vary":"Origin"
  }});
}
function safeEqual(a,b) {
  if(typeof a!=="string"||typeof b!=="string")return false;
  let diff=a.length^b.length;const max=Math.max(a.length,b.length);
  for(let i=0;i<max;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);
  return diff===0;
}
function validText(v,max){return typeof v==="string"&&v.length>0&&v.length<=max&&!/[\u0000-\u001F\u007F]/.test(v);}
function bearerToken(request){const m=/^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(request.headers.get("Authorization")||"");return m?m[1]:"";}
async function terminalKey(company,server){
  const bytes=new TextEncoder().encode(company+"\n"+server);
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  const hex=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  return "terminal:"+hex;
}
function validateConfig(body){
  if(!body||body.version!==1||!FRAMES[body.mode]||
    !["apa","smc","both"].includes(body.strategy)||!Array.isArray(body.symbols)||
    body.symbols.length<1||body.symbols.length>50||
    !body.symbols.every(s=>validText(s,32)&&/^[A-Za-z0-9._/ -]+$/.test(s))||
    !Array.isArray(body.timeframes)||body.timeframes.length<1||
    !body.timeframes.every(tf=>FRAMES[body.mode].includes(tf))||
    !Number.isFinite(body.riskPercent)||body.riskPercent<0.01||body.riskPercent>5||
    !Number.isInteger(body.maxOpenTrades)||body.maxOpenTrades<1||body.maxOpenTrades>10||
    !Number.isFinite(body.dailyLossLimitPercent)||body.dailyLossLimitPercent<0.1||body.dailyLossLimitPercent>10||
    !Number.isInteger(body.maxConsecutiveLosses)||body.maxConsecutiveLosses<1||body.maxConsecutiveLosses>10||
    body.demoOnly!==true||body.liveLocked!==true){
    return {ok:false,error:"Invalid or unsafe configuration. Demo-only/live-lock and valid style settings are required."};
  }
  const expected=FRAMES[body.mode];
  if(body.timeframes.some(tf=>!expected.includes(tf)))return {ok:false,error:"Timeframe is not permitted for the selected style."};
  return {ok:true,value:{
    version:1,mode:body.mode,strategy:body.strategy,symbols:Array.from(new Set(body.symbols)),
    timeframes:Array.from(new Set(body.timeframes)),riskPercent:body.riskPercent,
    maxOpenTrades:body.maxOpenTrades,dailyLossLimitPercent:body.dailyLossLimitPercent,
    maxConsecutiveLosses:body.maxConsecutiveLosses,demoOnly:true,liveLocked:true,
    updatedAt:new Date().toISOString()
  }};
}
export default {
 async fetch(request,env){
  const url=new URL(request.url);
  if(request.method==="OPTIONS")return new Response(null,{status:204,headers:{
    "Access-Control-Allow-Origin":SITE_ORIGIN,"Access-Control-Allow-Methods":"GET, POST, OPTIONS",
    "Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Max-Age":"86400","Vary":"Origin"
  }});
  if(url.pathname==="/mt5/public-status"&&request.method==="GET"){
    if(!env.MT5_HEARTBEATS)return json({error:"Bridge storage is not configured"},503);
    const latest=await env.MT5_HEARTBEATS.get("latest","json");
    if(!latest)return json({status:"NO_HEARTBEAT_RECEIVED"});
    const ageSeconds=Math.max(0,Math.floor((Date.now()-Date.parse(latest.receivedAt))/1000));
    return json({status:ageSeconds<=90&&latest.terminalConnected?"ONLINE":"OFFLINE",receivedAt:latest.receivedAt,ageSeconds});
  }
  if(url.pathname==="/mt5/public-config"&&request.method==="GET"){
    if(!env.MT5_HEARTBEATS)return json({error:"Bridge storage is not configured"},503);
    const config=await env.MT5_HEARTBEATS.get("configuration","json");
    return json({status:config?"CONFIGURED":"NO_CONFIGURATION",updatedAt:config?.updatedAt||null,mode:config?.mode||null,strategy:config?.strategy||null});
  }
  if(url.pathname==="/mt5/market-data"&&request.method==="GET"){
    if(!env.MT5_HEARTBEATS)return json({error:"Bridge storage is not configured"},503);
    const symbol=url.searchParams.get("symbol")||"",timeframe=url.searchParams.get("timeframe")||"";
    if(!validText(symbol,32)||!/^[A-Za-z0-9._/ -]+$/.test(symbol)||!Object.values(FRAMES).flat().includes(timeframe))
      return json({error:"Invalid symbol or timeframe"},400);
    const key="market:"+encodeURIComponent(symbol)+"|"+timeframe;
    const packet=await env.MT5_HEARTBEATS.get(key,"json");
    if(!packet)return json({status:"NO_DATA",symbol,timeframe},404);
    const ageSeconds=Math.max(0,Math.floor((Date.now()-Date.parse(packet.receivedAt))/1000));
    return json({status:ageSeconds<=90?"FRESH":"STALE",ageSeconds,...packet});
  }
  const protectedPaths=["/mt5/heartbeat","/mt5/status","/mt5/config","/mt5/market-data"];
  if(!protectedPaths.includes(url.pathname))return json({error:"Not found"},404);
  if(request.method!=="POST"&&request.method!=="GET")return json({error:"Method not allowed"},405);
  if(!env.MT5_BRIDGE_TOKEN||env.MT5_BRIDGE_TOKEN.length<24||!env.MT5_HEARTBEATS)return json({error:"Bridge server is not configured"},503);
  if(!safeEqual(bearerToken(request),env.MT5_BRIDGE_TOKEN))return json({error:"Unauthorized"},401);
  if(url.pathname==="/mt5/status"||url.pathname==="/mt5/config"){
    if(request.method!=="GET")return json({error:"Method not allowed"},405);
    if(url.pathname==="/mt5/status"){
      const latest=await env.MT5_HEARTBEATS.get("latest","json");
      return latest?json({status:"OK",heartbeat:latest}):json({status:"NO_HEARTBEAT_RECEIVED"},404);
    }
    const config=await env.MT5_HEARTBEATS.get("configuration","json");
    return json({status:config?"CONFIGURED":"NO_CONFIGURATION",configuration:config});
  }
  const declaredLength=Number(request.headers.get("Content-Length")||0);
  if(declaredLength>MAX_BODY_BYTES)return json({error:"Payload too large"},413);
  let raw;try{raw=await request.text();}catch{return json({error:"Could not read request body"},400);}
  if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)return json({error:"Payload too large"},413);
  let body;try{body=JSON.parse(raw);}catch{return json({error:"Invalid JSON"},400);}
  if(url.pathname==="/mt5/market-data"){
    const symbol=body?.symbol,timeframe=body?.timeframe,bars=body?.candles;
    if(!validText(symbol,32)||!/^[A-Za-z0-9._/ -]+$/.test(symbol)||
      !Object.values(FRAMES).flat().includes(timeframe)||!Array.isArray(bars)||bars.length<30||bars.length>150||
      !bars.every((c,i)=>c&&Number.isInteger(c.epoch)&&c.epoch>0&&
        Number.isFinite(c.open)&&Number.isFinite(c.high)&&Number.isFinite(c.low)&&Number.isFinite(c.close)&&
        c.high>=Math.max(c.open,c.close,c.low)&&c.low<=Math.min(c.open,c.close,c.high)&&
        (i===0||c.epoch>bars[i-1].epoch))){
      return json({error:"Invalid market-data packet. Need 30–150 ordered valid OHLC candles."},400);
    }
    const packet={symbol,timeframe,candles:bars.slice(-150),receivedAt:new Date().toISOString(),source:"MT5"};
    await env.MT5_HEARTBEATS.put("market:"+encodeURIComponent(symbol)+"|"+timeframe,JSON.stringify(packet),{expirationTtl:MARKET_DATA_TTL_SECONDS});
    return json({accepted:true,status:"MARKET_DATA_SAVED",symbol,timeframe,candleCount:packet.candles.length,receivedAt:packet.receivedAt});
  }
  if(url.pathname==="/mt5/config"){
    const validated=validateConfig(body);
    if(!validated.ok)return json({error:validated.error},400);
    await env.MT5_HEARTBEATS.put("configuration",JSON.stringify(validated.value),{expirationTtl:CONFIG_TTL_SECONDS});
    return json({accepted:true,status:"CONFIG_SAVED",configuration:validated.value});
  }
  if(!body||body.service!=="SMC Sniper Pro APA"||!validText(body.agentVersion,20)||
    typeof body.terminalConnected!=="boolean"||typeof body.tradeAllowed!=="boolean"||
    !validText(body.brokerCompany,120)||!validText(body.server,120)||
    !Number.isInteger(body.terminalBuild)||body.terminalBuild<1||body.terminalBuild>1000000)
    return json({error:"Invalid heartbeat fields"},400);
  const receivedAt=new Date().toISOString();
  const heartbeat={service:"SMC Sniper Pro APA",agentVersion:body.agentVersion,
    terminalConnected:body.terminalConnected,tradeAllowed:body.tradeAllowed,
    brokerCompany:body.brokerCompany,server:body.server,terminalBuild:body.terminalBuild,receivedAt};
  const key=await terminalKey(body.brokerCompany,body.server);
  await Promise.all([env.MT5_HEARTBEATS.put(key,JSON.stringify(heartbeat),{expirationTtl:HEARTBEAT_TTL_SECONDS}),
    env.MT5_HEARTBEATS.put("latest",JSON.stringify(heartbeat),{expirationTtl:HEARTBEAT_TTL_SECONDS})]);
  return json({accepted:true,status:body.terminalConnected?"CONNECTED":"TERMINAL_DISCONNECTED",
    brokerCompany:heartbeat.brokerCompany,server:heartbeat.server,receivedAt});
 }
};