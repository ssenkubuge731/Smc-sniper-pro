
"use strict";

/* =========================================================
   SMC SNIPER PRO APA
   COMPLETE APP.JS
   DEMO MARKET MONITORING ONLY
   NO ORDER EXECUTION
   LIVE TRADING LOCKED
========================================================= */

const DERIV_PUBLIC_WS =
  "wss://api.derivws.com/trading/v1/options/ws/public";

const STORAGE_KEY = "smcSniperProSettingsV2";
const SIGNAL_HISTORY_KEY = "smcSniperProSignalHistoryV1";
const DEMO_RISK_LOCK_KEY = "smcSniperProDemoRiskLockV1";

const TIMEFRAMES = {
  scalping: ["1m", "5m"],
  intraday: ["1m", "5m", "15m", "30m", "1h"]
};

// APA is intraday-only. D1/H4 are context frames, not Swing trading sessions.
const APA_REQUIRED_FRAMES = ["1d", "4h", "1h", "30m", "15m", "5m", "1m"];
const APA_SETUP_FRAME = { intraday: "15m" };

const GRANULARITY = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "30m": 1800,
  "1h": 3600,
  "4h": 14400,
  "1d": 86400
};

const tradingState = {
  mode: "scalping",
  strategy: "apa",
  broker: "deriv",
  demo: true,
  liveLocked: true,
  running: false,

  derivConnected: false,
  derivSocket: null,

  availableSymbols: [],
  selectedSymbols: new Set(),

  lastPrices: {},
  candles: {},
  requestContexts: new Map(),
  candleSubscriptions: new Map(),
  tickSubscriptions: new Map(),

  requestId: 1,
  scanTimer: null,
  mt5ScannerTimer: null,
  mt5ScanCursor: 0,
  mt5ScanInProgress: false,
  mt5FeedHealth: {},
  mt5LastScanAt: 0,
  scanGeneration: 0,
  scanUniverseCursor: 0,
  scanQueue: [],
  scanQueueTimer: null,
  scanInProgress: false,
  scannerDesired: false,
  pingTimer: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  manualDisconnect: false,
  lastSignals: {},
  signalHistory: [],
  scalpObservations: [],
  settings: {},
  newsEvents: [],
  newsLoadedAt: 0,
  newsError: "",
  newsTimer: null,
  newsLoading: false,
  lastAnalysedSymbol: ""
};

const $ = id => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = String(value);
}

function valueOf(id) {
  return $(id)?.value ?? "";
}

function checked(id) {
  return Boolean($(id)?.checked);
}

function formatPrice(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toFixed(5).replace(/0+$/, "").replace(/\.$/, "");
}

function isSocketOpen() {
  return Boolean(
    tradingState.derivSocket &&
    tradingState.derivSocket.readyState === WebSocket.OPEN
  );
}

function candleKey(symbol, timeframe) {
  return `${symbol}|${timeframe}`;
}

/* =========================================================
   STATUS
========================================================= */

function setConnectionStatus(message) {
  setText("derivConnectionStatus", message);
  setText(
    "brokerStatus",
    tradingState.derivConnected
      ? "Broker: Deriv market data connected"
      : "Broker: Not connected"
  );
  setText(
    "systemStatus",
    tradingState.derivConnected ? "Connected" : "Not connected"
  );
}

function addResult(message, targetId = "scannerResults") {
  const target = $(targetId);
  if (!target) return;

  if (
    target.textContent === "Scanner has not started." ||
    target.textContent === "No timeframe analysis available."
  ) {
    target.textContent = "";
  }

  const item = document.createElement("div");
  item.className = "result-item";
  item.textContent = message;
  target.prepend(item);

  while (target.children.length > 30) {
    target.removeChild(target.lastChild);
  }
}

/* =========================================================
   NAVIGATION
========================================================= */

function showSection(pageId) {
  const page = $(pageId);
  if (!page || !page.classList.contains("page")) return;

  document.querySelectorAll(".page").forEach(section => {
    section.classList.toggle("active", section.id === pageId);
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });
}

/* =========================================================
   TIMEFRAMES
========================================================= */

function updateMode() {
  const modeSelect = $("tradingStyle");
  const timeframeSelect = $("timeframe");
  if (!modeSelect || !timeframeSelect) return;

  const mode = TIMEFRAMES[modeSelect.value]
    ? modeSelect.value
    : "scalping";

  tradingState.mode = mode;

  const frames = TIMEFRAMES[mode];
  const previous = timeframeSelect.value;

  timeframeSelect.replaceChildren();

  const entryFrames = frames.includes("1m") ? frames : ["1m", ...frames];
  entryFrames.forEach(frame => {
    const option = document.createElement("option");
    option.value = frame;
    option.textContent = frame.toUpperCase();
    timeframeSelect.appendChild(option);
  });

  timeframeSelect.value = entryFrames.includes(previous) ? previous : "1m";

  const modeInfo = mode === "intraday"
    ? "APA + SMC Intraday: D1 → H4 → H1 → M30 → M15 → M5 → M1 entry"
    : "SMC Scalping: M5 setup analysis + M1 entry confirmation";
  setText("timeframeInfo", `${mode.toUpperCase()} — ${modeInfo}`);

  updateActiveTimeframes();
}

function updateActiveTimeframes() {
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const selected = valueOf("timeframe") || frames[0];

  setText(
    "activeTimeframes",
    `Available: ${frames.join(", ").toUpperCase()}. Main display: ${selected.toUpperCase()}`
  );
}

/* =========================================================
   STRATEGY
========================================================= */

function syncStrategy(value) {
  if (!["apa", "smc", "both", "news"].includes(value)) value = "apa";
  tradingState.strategy = value;
  ["strategySelect", "scannerStrategy", "strategySettings"].forEach(id => {
    if ($(id)) $(id).value = value;
  });
  $("apaSettings")?.classList.toggle("hidden", !["apa", "both"].includes(value));
  $("smcSettings")?.classList.toggle("hidden", !["smc", "both"].includes(value));
  setText("strategyInfo",
    value === "apa"
      ? "APA Advanced Price Action selected — original APA sequence."
      : value === "smc"
        ? "SMC selected — independent Smart Money Concepts confirmation engine."
        : value === "both"
          ? "BOTH selected — APA and SMC analyse independently; signals and outcomes stay separately labelled."
          : "News Trading selected — independent Forex economic-news and price-reaction engine.");

  if (value === "news") {
    loadNewsCalendar(true);
    if (tradingState.newsTimer) clearInterval(tradingState.newsTimer);
    tradingState.newsTimer = setInterval(() => loadNewsCalendar(true), 15 * 60 * 1000);
  } else if (tradingState.newsTimer) {
    clearInterval(tradingState.newsTimer);
    tradingState.newsTimer = null;
  }

  if (tradingState.lastAnalysedSymbol) {
    analyseMainSelection(tradingState.lastAnalysedSymbol);
  }
}

/* =========================================================
   BROKER PANELS
========================================================= */

function updateBrokerPanels(sourceId = "brokerType") {
  const source = sourceId === "scannerBroker" ? "scannerBroker" : "brokerType";
  const broker = valueOf(source) || "deriv";

  tradingState.broker = broker;

  $("derivPanel")?.classList.toggle("hidden", broker !== "deriv");
  $("mt5Panel")?.classList.toggle("hidden", broker !== "mt5");

  if ($("brokerType")) $("brokerType").value = broker;
  if ($("scannerBroker")) $("scannerBroker").value = broker;

  if (broker === "mt5") {
    setText("mt5ConnectionStatus",
      "MT5 selected. Setup details can be saved now; actual connection waits for the VPS bridge.");
  } else {
    setText("brokerStatus", tradingState.derivConnected
      ? "Broker: Deriv market data connected"
      : "Broker: Deriv selected — not connected");
  }
}

const MT5_PUBLIC_STATUS_URL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/public-status";
const MT5_CONFIG_URL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/config";
const MT5_MARKET_DATA_URL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/market-data";
const BRIDGE_ALLOWED_FRAMES = {
  scalping: ["1m","5m"],
  intraday: ["1m","5m","15m","30m","1h"]
};
function getScanSymbolsForMode(symbols, mode, strategy) {
  const clean = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map(symbol => String(symbol || "").trim()).filter(Boolean))];
  // SMC Scalping is strictly one user-selected pair; never silently pick one.
  if (mode === "scalping" && (strategy === "smc" || strategy === "both")) {
    return clean.length === 1 ? clean : [];
  }
  return clean;
}
function getRotatingSymbolBatch(symbols, cursor = 0, batchSize = 10) {
  const clean = [...new Set((Array.isArray(symbols) ? symbols : [])
    .map(symbol => String(symbol || "").trim()).filter(Boolean))];
  if (!clean.length) return { symbols: [], nextCursor: 0, total: 0, start: 0 };
  const size = Math.max(1, Math.min(10, Number(batchSize) || 10));
  const start = ((Math.floor(Number(cursor) || 0) % clean.length) + clean.length) % clean.length;
  const count = Math.min(size, clean.length);
  const batch = Array.from({ length: count }, (_, i) => clean[(start + i) % clean.length]);
  return { symbols: batch, nextCursor: (start + count) % clean.length, total: clean.length, start };
}
function getScannerUniverseBatch(symbols, mode, strategy, cursor = 0, batchSize = 10) {
  const clean = getScanSymbolsForMode(symbols, mode, strategy);
  if (mode !== "intraday" || (strategy !== "apa" && strategy !== "both")) {
    return { symbols: clean, nextCursor: 0, total: clean.length };
  }
  if (!clean.length) return { symbols: [], nextCursor: 0, total: 0 };
  const size = Math.max(1, Math.min(10, Number(batchSize) || 10));
  const start = ((Math.floor(Number(cursor) || 0) % clean.length) + clean.length) % clean.length;
  // Do not wrap within a batch: finish the tail of the universe, then wrap next cycle.
  const count = Math.min(size, clean.length - start);
  const batch = clean.slice(start, start + count);
  return { symbols: batch, nextCursor: (start + batch.length) % clean.length, total: clean.length };
}
function getBridgeFrames(mode,strategy){
  if(mode==="scalping") return [...BRIDGE_ALLOWED_FRAMES.scalping];
  if(strategy==="apa"||strategy==="both") return [...APA_REQUIRED_FRAMES];
  return [...BRIDGE_ALLOWED_FRAMES.intraday];
}
function renderBridgeTimeframes(){
  const mode=valueOf("bridgeMode")||"scalping",box=$("bridgeTimeframes");
  if(!box)return;
  box.replaceChildren();
  (getBridgeFrames(mode,valueOf("bridgeStrategy"))).forEach(tf=>{
    const label=document.createElement("label");label.className="check";
    const input=document.createElement("input");input.type="checkbox";input.value=tf;input.checked=true;input.dataset.bridgeTf="1";
    label.appendChild(input);label.appendChild(document.createTextNode(tf.toUpperCase()));
    box.appendChild(label);
  });
}
async function syncMT5BridgeConfig(){
  const token=valueOf("bridgeToken").trim(),mode=valueOf("bridgeMode"),strategy=valueOf("bridgeStrategy");
  const symbols=valueOf("bridgeSymbols").split(",").map(s=>s.trim()).filter(Boolean);
  const timeframes=Array.from(document.querySelectorAll('[data-bridge-tf="1"]:checked')).map(x=>x.value);
  if(token.length<24){setText("bridgeConfigStatus","Enter the private bridge token (minimum 24 characters) locally.");return;}
  if(!symbols.length){setText("bridgeConfigStatus","Enter at least one MT5 symbol name.");return;}
  if(!timeframes.length){setText("bridgeConfigStatus","Select at least one allowed timeframe.");return;}
  const payload={version:1,mode,strategy,symbols,timeframes,
    riskPercent:Number(valueOf("bridgeRisk")),maxOpenTrades:Number(valueOf("bridgeMaxTrades")),
    dailyLossLimitPercent:Number(valueOf("bridgeDailyLoss")),maxConsecutiveLosses:Number(valueOf("bridgeLossStreak")),
    demoOnly:true,liveLocked:true};
  setText("bridgeConfigStatus","Sending configuration to the protected cloud bridge…");
  try{
    const response=await fetch(MT5_CONFIG_URL,{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},body:JSON.stringify(payload),cache:"no-store"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){setText("bridgeConfigStatus","Config rejected (HTTP "+response.status+"): "+(data.error||"unknown error"));return;}
    setText("bridgeConfigStatus","Synchronized at "+(data.configuration?.updatedAt||"time unavailable")+". Demo-only; live locked. No trade commands were sent.");
  }catch(error){setText("bridgeConfigStatus","Sync failed: "+(error?.message||"network error")+" — check Worker deployment/CORS.");}
}
async function refreshMT5BridgeConfig(){
  const token=valueOf("bridgeToken").trim();
  if(token.length<24){setText("bridgeConfigStatus","Enter the private token locally to check protected configuration.");return;}
  setText("bridgeConfigStatus","Checking cloud configuration…");
  try{
    const response=await fetch(MT5_CONFIG_URL,{method:"GET",headers:{"Authorization":"Bearer "+token},cache:"no-store"});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){setText("bridgeConfigStatus","Config status check failed (HTTP "+response.status+").");return;}
    if(!data.configuration){setText("bridgeConfigStatus","Cloud bridge is reachable; no configuration has been saved.");return;}
    const c=data.configuration;
    setText("bridgeConfigStatus","Saved "+(c.updatedAt||"")+" | "+c.mode+" | "+c.strategy.toUpperCase()+" | "+c.symbols.join(", ")+" | "+c.timeframes.map(x=>x.toUpperCase()).join(", ")+" | demo-only / live-locked.");
  }catch(error){setText("bridgeConfigStatus","Config check failed: "+(error?.message||"network error"));}
}
"https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/public-status";

async function refreshMT5BridgeStatus() {
  setText("mt5BridgeStatus", "Checking cloud bridge…");
  setText("mt5LastHeartbeat", "Checking for the latest MT5 heartbeat.");
  try {
    const response = await fetch(MT5_PUBLIC_STATUS_URL, { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const data = await response.json();
    if (data.status === "ONLINE") {
      setText("mt5BridgeStatus", "Cloud bridge: ONLINE — a recent MT5 heartbeat was received.");
      const received = data.receivedAt ? new Date(data.receivedAt).toLocaleString() : "time unavailable";
      setText("mt5LastHeartbeat", "Last heartbeat: " + received + ". This confirms the terminal heartbeat, not trading permission.");
    } else if (data.status === "OFFLINE") {
      setText("mt5BridgeStatus", "Cloud bridge: OFFLINE — no recent connected-terminal heartbeat.");
      setText("mt5LastHeartbeat", data.receivedAt ? "Last heartbeat: " + new Date(data.receivedAt).toLocaleString() : "No recent heartbeat.");
    } else {
      setText("mt5BridgeStatus", "Cloud bridge reachable; waiting for the first MT5 heartbeat.");
      setText("mt5LastHeartbeat", "No heartbeat received yet. The Windows VPS/PC and MT5 bridge EA must be running.");
    }
  } catch (error) {
    setText("mt5BridgeStatus", "Cloud bridge status could not be reached. Check the Worker deployment.");
    setText("mt5LastHeartbeat", "Status check failed: " + (error && error.message ? error.message : "network error"));
  }
}

function prepareMT5Connection() {
  const broker = valueOf("mt5Broker");
  const server = valueOf("mt5Server").trim();

  if (!broker) {
    setText("mt5ConnectionStatus", "Select your MT5 broker first.");
    return;
  }

  const brokerName = {
    deriv: "Deriv MT5",
    exness: "Exness MT5",
    fbs: "FBS MT5",
    icmarkets: "IC Markets",
    pepperstone: "Pepperstone",
    xm: "XM",
    other: "Other MT5 broker"
  }[broker] || "Selected MT5 broker";

  // Only non-secret setup details are saved. Never collect or store
  // account passwords, investor passwords, or trading tokens here.
  const setup = { mt5Broker: broker, mt5Server: server };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...saved, ...setup }));
  } catch {
    setText("mt5ConnectionStatus", "Could not save MT5 setup on this device.");
    return;
  }

  const serverText = server
    ? " Server: " + server + "."
    : " Server name is still missing; copy it exactly from your broker's MT5 login screen.";
  setText("mt5ConnectionStatus",
    brokerName + " selection saved on this device." + serverText +
    " Status: NOT CONNECTED. This only saves setup details; the website-to-EA command channel is not implemented yet.");
}

/* =========================================================
   DERIV CONNECTION
========================================================= */

function connectDeriv() {
  if (
    tradingState.derivSocket &&
    (
      tradingState.derivSocket.readyState === WebSocket.OPEN ||
      tradingState.derivSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    setConnectionStatus("Deriv connection already active.");
    return;
  }

  if (!window.WebSocket) {
    setConnectionStatus("WebSocket not supported by browser.");
    return;
  }

  setConnectionStatus("Connecting to Deriv public market data...");

  let socket;

  try {
    socket = new WebSocket(DERIV_PUBLIC_WS);
  } catch (error) {
    setConnectionStatus("Connection error: " + error.message);
    return;
  }

  tradingState.derivSocket = socket;
  tradingState.manualDisconnect = false;

  socket.onopen = () => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = true;
    tradingState.reconnectAttempts = 0;
    if (tradingState.reconnectTimer) {
      clearTimeout(tradingState.reconnectTimer);
      tradingState.reconnectTimer = null;
    }
    setConnectionStatus("Connected. Loading markets...");

    if (tradingState.pingTimer) clearInterval(tradingState.pingTimer);
    tradingState.pingTimer = setInterval(() => {
      if (tradingState.derivSocket === socket && socket.readyState === WebSocket.OPEN) {
        try {
          socket.send(JSON.stringify({ ping: 1, req_id: tradingState.requestId++ }));
        } catch (error) {
          addResult("Connection keepalive failed: " + error.message);
        }
      }
    }, 30000);

    // The current Deriv public API no longer accepts product_type.
    sendRequest({
      active_symbols: "brief"
    });
  };

  socket.onmessage = event => {
    if (tradingState.derivSocket !== socket) return;

    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      addResult("Invalid Deriv response.");
      return;
    }

    handleDerivMessage(data);
  };

  socket.onerror = () => {
    if (tradingState.derivSocket === socket) {
      setConnectionStatus(
        "Connection error. Check internet or Deriv availability."
      );
    }
  };

  socket.onclose = event => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = false;
    tradingState.derivSocket = null;
    tradingState.requestContexts.clear();
    tradingState.candleSubscriptions.clear();
    tradingState.tickSubscriptions.clear();

    if (tradingState.pingTimer) {
      clearInterval(tradingState.pingTimer);
      tradingState.pingTimer = null;
    }

    // Preserve the user's scanner choice and resume after reconnection.
    tradingState.scannerDesired = tradingState.scannerDesired || tradingState.running;
    tradingState.running = false;
    clearScanQueue();

    setConnectionStatus("Disconnected. Code " + event.code);

    if (!tradingState.manualDisconnect) {
      scheduleDerivReconnect();
    }
  };
}

function disconnectDeriv() {
  tradingState.manualDisconnect = true;
  tradingState.scannerDesired = false;
  stopScanner(false);

  if (tradingState.reconnectTimer) {
    clearTimeout(tradingState.reconnectTimer);
    tradingState.reconnectTimer = null;
  }
  if (tradingState.pingTimer) {
    clearInterval(tradingState.pingTimer);
    tradingState.pingTimer = null;
  }

  const socket = tradingState.derivSocket;

  tradingState.derivConnected = false;
  tradingState.derivSocket = null;
  tradingState.requestContexts.clear();
  tradingState.tickSubscriptions.clear();

  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }

  setConnectionStatus("Disconnected from Deriv.");
}

function scheduleDerivReconnect() {
  if (tradingState.manualDisconnect || tradingState.reconnectTimer) return;

  tradingState.reconnectAttempts += 1;
  const delay = Math.min(30000, 1000 * Math.pow(2, tradingState.reconnectAttempts - 1));
  setConnectionStatus(`Connection lost. Reconnecting in ${Math.round(delay / 1000)}s...`);

  tradingState.reconnectTimer = setTimeout(() => {
    tradingState.reconnectTimer = null;
    if (!tradingState.manualDisconnect && !isSocketOpen()) connectDeriv();
  }, delay);
}

/* =========================================================
   DERIV REQUESTS
========================================================= */

function syncDerivTickSubscriptions() {
  if (!isSocketOpen()) return;
  const wanted = tradingState.selectedSymbols;
  for (const [symbol, subscriptionId] of tradingState.tickSubscriptions) {
    if (!wanted.has(symbol)) {
      if (subscriptionId) sendRequest({ forget: subscriptionId });
      tradingState.tickSubscriptions.delete(symbol);
    }
  }
  for (const symbol of wanted) {
    if (!tradingState.tickSubscriptions.has(symbol)) {
      tradingState.tickSubscriptions.set(symbol, null);
      if (!sendRequest({ ticks: symbol, subscribe: 1 }, { type: "tick", symbol })) {
        tradingState.tickSubscriptions.delete(symbol);
      }
    }
  }
}

function sendRequest(payload, context = null) {
  if (!isSocketOpen()) return false;

  const reqId = tradingState.requestId++;

  if (context) {
    tradingState.requestContexts.set(reqId, context);
  }

  try {
    tradingState.derivSocket.send(JSON.stringify({
      ...payload,
      req_id: reqId
    }));
    return true;
  } catch (error) {
    tradingState.requestContexts.delete(reqId);
    addResult("Request failed: " + error.message);
    return false;
  }
}

function handleDerivMessage(data) {
  if (!data || typeof data !== "object") return;

  if (data.error) {
    const message = data.error.message || "Unknown API error";
    const failedContext = data.req_id ? tradingState.requestContexts.get(data.req_id) : null;
    if (data.req_id) tradingState.requestContexts.delete(data.req_id);
    const contextLabel = failedContext
      ? " " + failedContext.symbol + " " + failedContext.timeframe.toUpperCase()
      : "";
    setConnectionStatus("Deriv API: " + message);
    addResult("Market-data request failed" + contextLabel + ": " + message);
    return;
  }

  const markets =
    data.active_symbols ||
    data.data?.active_symbols ||
    data.underlying_symbols;

  if (Array.isArray(markets)) {
    loadMarkets(markets);
    if (tradingState.scannerDesired && !tradingState.running) {
      startScanner(true);
    }
    return;
  }

  const context = (data.req_id ? tradingState.requestContexts.get(data.req_id) : null) ||
    (data.subscription?.id ? tradingState.candleSubscriptions.get(data.subscription.id) : null);

  if (data.req_id && !data.subscription?.id) {
    tradingState.requestContexts.delete(data.req_id);
  }
  if (data.subscription?.id && context && (data.msg_type === "candles" || data.msg_type === "ohlc")) {
    tradingState.candleSubscriptions.set(data.subscription.id, context);
  }

  if (data.msg_type === "candles" && Array.isArray(data.candles)) {
    if (!context) return;

    const key = candleKey(context.symbol, context.timeframe);

    tradingState.candles[key] = data.candles
      .map(normalizeCandle)
      .filter(isValidCandle)
      .slice(-150);

    renderTimeframeAnalysis(context.symbol, context.timeframe);
    if ((tradingState.strategy === "smc" || tradingState.strategy === "both") && window.SMCIntradayEngine) {
      const smcRecord = window.SMCIntradayEngine.evaluate(
        context.symbol, context.timeframe, tradingState.candles[key], tradingState.mode
      );
      publishSMCSignal(context.symbol, context.timeframe, smcRecord, tradingState.candles[key]);
      renderSMCMultiFrame(context.symbol);
    }
    analyseMainSelection(context.symbol);
  }

  if (data.msg_type === "ohlc" && data.ohlc && context) {
    const key = candleKey(context.symbol, context.timeframe);
    const list = tradingState.candles[key] || [];
    const candle = normalizeCandle(data.ohlc);

    if (isValidCandle(candle)) {
      const existing = list.findIndex(item => item.epoch === candle.epoch);
      if (existing >= 0) list[existing] = candle;
      else list.push(candle);
      tradingState.candles[key] = list.slice(-150);
      if ((tradingState.strategy === "smc" || tradingState.strategy === "both") && window.SMCIntradayEngine) {
        const smcRecord = window.SMCIntradayEngine.evaluate(
          context.symbol, context.timeframe, tradingState.candles[key], tradingState.mode
        );
        publishSMCSignal(context.symbol, context.timeframe, smcRecord, tradingState.candles[key]);
        renderSMCMultiFrame(context.symbol);
      }
      analyseMainSelection(context.symbol);
    }
  }

  if (data.msg_type === "tick" && data.tick) {
    const symbol = data.tick.symbol;
    const quote = Number(data.tick.quote);
    const subscriptionId = data.subscription?.id;
    if (symbol && subscriptionId && tradingState.tickSubscriptions.has(symbol)) {
      tradingState.tickSubscriptions.set(symbol, subscriptionId);
    }

    if (symbol && Number.isFinite(quote)) {
      tradingState.lastPrices[symbol] = quote;
      updateMarketPrice(symbol, quote);
    }
  }
}

function renderSMCFormationMonitor(record) {
  if (!record || !record.ready) {
    setText("smcFormationStatus", record?.status || "Waiting for SMC candles.");
    setText("smcZoneStatus", "Zone lifecycle: waiting for valid candles.");
    return;
  }
  const f=record.formations||{};
  const labels=[["BOS","BOS"],["MSS","MSS"],["CHoCH","CHoCH"],["liquiditySweep","Liquidity sweep"],["EQH","Equal highs"],["EQL","Equal lows"],["FVG","FVG"],["IFVG","IFVG"],["supply","Supply"],["demand","Demand"],["orderBlock","Order Block"],["breakerBlock","Breaker Block"],["displacement","Displacement"]];
  const found=labels.filter(([k])=>f[k]).map(([,v])=>v);
  const confirmations=record.count??Object.values(record.confirmations||{}).filter(Boolean).length;
  const models=Array.isArray(record.entryModels)?record.entryModels:[];
  setText("smcFormationStatus","SMC formations ("+record.timeframe+"): "+(found.length?found.join(" • "):"none detected")+" | Independent confirmations: "+confirmations+" | Models: "+(models.length?models.join(" / "):"none"));
  const zones=(record.zones||[]).map(z=>z.type+" "+z.side+" ["+z.low+"–"+z.high+"] "+z.status);
  setText("smcZoneStatus","Zones: "+(zones.length?zones.join(" | "):"none detected")+"\n"+(record.note||""));
}

function renderSMCEntryPlan(symbol) {
  const output = $("smcEntryPlanStatus");
  if (!window.SMCIntradayEngine || !output) return;
  const lot = Number(valueOf("lotSize")) || 0.01;
  const frames = window.SMCIntradayEngine.framesForMode
    ? window.SMCIntradayEngine.framesForMode(tradingState.mode)
    : window.SMCIntradayEngine.frames;
  const fmt = value => Number(value).toPrecision(7);
  const lines = frames.map(timeframe => {
    const record = window.SMCIntradayEngine.state.latest.get(symbol + "|" + timeframe);
    if (!record) return timeframe.toUpperCase() + " — waiting for candle analysis";
    if (!record.ready) return timeframe.toUpperCase() + " — " + (record.status || "waiting for enough candles");
    if (!record.confirmed) return timeframe.toUpperCase() + " — scanning; no confirmed entry yet";
    const plan = record.tradePlan;
    if (!plan) return timeframe.toUpperCase() + " " + record.side + " — trade plan unavailable; WAIT";
    if (plan.blocked || !record.tradeReady) return timeframe.toUpperCase() + " " + record.side + " — NOT TRADE-READY; WAIT: " + (plan.reason || "plan validation failed");
    return [
      timeframe.toUpperCase() + " " + plan.side,
      "Entry " + fmt(plan.entry),
      "SL " + fmt(plan.sl),
      "TP (structure) " + fmt(plan.tp),
      "R:R " + plan.rr.toFixed(2) + "R",
      "Target " + plan.targetSource,
      "Lot " + lot,
      "POI " + plan.zone + " (" + plan.zoneStatus + ")"
    ].join(" | ");
  });
  output.style.whiteSpace = "pre-line";
  setText("smcEntryPlanStatus",
    "SMC " + tradingState.mode.toUpperCase() + " — " + symbol + " — each timeframe is calculated independently.\n" +
    "DEMO PREVIEW — fixed lot " + lot + " per qualifying entry.\n" +
    lines.join("\n") +
    "\nEach timeframe uses its own POI/structure invalidation for SL and nearest opposing structure/liquidity for TP. Minimum reward-to-risk: 2R. " +
    "A timeframe only receives levels after its own setup is confirmed and a valid reacting/touching POI is available.");
}

function renderSMCMultiFrame(symbol) {
  if (!window.SMCIntradayEngine) return;
  const frames=window.SMCIntradayEngine.framesForMode
    ? window.SMCIntradayEngine.framesForMode(tradingState.mode)
    : window.SMCIntradayEngine.frames;
  const rows=frames.map(tf=>{
    const r=window.SMCIntradayEngine.state.latest.get(symbol+"|"+tf);
    return tf+": "+(r?(r.confirmed?r.side+" CONFIRMED ("+r.score+"/100)":r.ready?"no setup":"waiting for candles"):"waiting for candles");
  });
  const best=window.SMCIntradayEngine.best(symbol,frames);
  setText("smcEngineStatus",(best?"Best SMC: "+best.side+" "+best.timeframe.toUpperCase()+" • "+best.score+"/100":"No confirmed SMC setup across scanned timeframes")+" | "+rows.join(" | "));
  const all=frames.map(tf=>window.SMCIntradayEngine.state.latest.get(symbol+"|"+tf)).filter(Boolean);
  const formationRecord=best||all.slice().reverse().find(record=>record&&record.ready)||null;
  renderSMCFormationMonitor(formationRecord);
  const zones=all.flatMap(r=>(r.zones||[]).map(z=>({...z,timeframe:r.timeframe}))).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,12);
  setText("smcZoneStatus",zones.length?"Top ranked POIs: "+zones.map(z=>tfZone(z.timeframe,z)).join(" | "):"Zones: none currently detected");
  renderSMCEntryPlan(symbol);
}
function tfZone(tf,z){return tf+" "+z.type+" "+z.side+" "+z.status+" ["+z.low+"–"+z.high+"] rank "+Math.round(z.score||0)+"/100 ("+(z.tests||0)+" tests)";}

// Each SMC timeframe can publish its own demo signal independently.
// This records a signal preview only; it never sends a broker order.
function publishSMCSignal(symbol, timeframe, record, candles) {
  if (!window.SMCIntradayEngine) return;
  const allowedFrames = window.SMCIntradayEngine.framesForMode
    ? window.SMCIntradayEngine.framesForMode(tradingState.mode)
    : window.SMCIntradayEngine.frames;
  // APA may request H4/D1 context candles, but those are never SMC entries.
  if (!allowedFrames.includes(timeframe)) return;
  if (!record || !record.confirmed || !record.tradeReady || !record.tradePlan) return;
  const plan = record.tradePlan;
  recordCandidateSignal(symbol, timeframe, {
    strategy: "smc",
    signal: plan.side + " — SMC " + timeframe.toUpperCase() + " confirmed",
    entry: plan.entry,
    sl: plan.sl,
    tp: plan.tp,
    trend: plan.side,
    reasoning: record.entryModels.join(" | ")
  }, candles);
}

/* =========================================================
   MARKET LOADING — FIXED
========================================================= */

function loadMarkets(markets) {
  tradingState.availableSymbols = (Array.isArray(markets) ? markets : [])
    .map(item => {
      if (!item || typeof item !== "object") return null;

      const symbol = item.symbol || item.underlying_symbol;
      if (!symbol) return null;

      return {
        symbol: String(symbol),
        name: item.underlying_symbol_name || item.display_name || item.name || String(symbol),
        market: item.market_display_name || item.market || "",
        submarket: item.submarket_display_name || item.submarket || item.subgroup || ""
      };
    })
    .filter(Boolean);

  // Remove selections that are no longer available
  const valid = new Set(
    tradingState.availableSymbols.map(item => item.symbol)
  );

  tradingState.selectedSymbols = new Set(
    [...tradingState.selectedSymbols].filter(symbol => valid.has(symbol))
  );

  renderMarketList();
  updatePairCount();
  syncDerivTickSubscriptions();

  if (!tradingState.availableSymbols.length) {
    setConnectionStatus("Connected, but no markets were returned.");
    addResult("Deriv returned an empty market list.");
    return;
  }

  setConnectionStatus(
    `Connected. ${tradingState.availableSymbols.length} markets loaded.`
  );

  addResult(
    `${tradingState.availableSymbols.length} Deriv markets loaded.`
  );
}

function marketCategory(item) {
  const text = `${item.market} ${item.submarket} ${item.name}`.toLowerCase();

  if (text.includes("forex") || text.includes("major pairs") ||
      text.includes("minor pairs")) return "Forex";

  if (text.includes("metal") || text.includes("gold") ||
      text.includes("silver")) return "Gold & Metals";

  if (text.includes("derived") || text.includes("synthetic") ||
      text.includes("indices") || text.includes("index")) {
    return "Deriv Indices";
  }

  return "Other";
}

function renderMarketList() {
  const container = $("pairList");
  if (!container) return;

  container.replaceChildren();

  if (!tradingState.availableSymbols.length) {
    container.textContent = "No markets loaded yet.";
    return;
  }

  const categories = ["Deriv Indices", "Forex", "Gold & Metals", "Other"];

  categories.forEach(category => {
    const markets = tradingState.availableSymbols.filter(
      item => marketCategory(item) === category
    );

    if (!markets.length) return;

    const heading = document.createElement("h4");
    heading.textContent = category;
    heading.style.gridColumn = "1 / -1";
    container.appendChild(heading);

    markets.forEach(item => {
      const label = document.createElement("label");
      label.className = "market-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = tradingState.selectedSymbols.has(item.symbol);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          tradingState.selectedSymbols.add(item.symbol);
        } else {
          tradingState.selectedSymbols.delete(item.symbol);
        }
        updatePairCount();
        syncDerivTickSubscriptions();
      });

      const text = document.createElement("span");
      text.textContent = `${item.name} (${item.symbol})`;

      label.append(checkbox, text);
      container.appendChild(label);
    });
  });
}

function selectAllPairs() {
  tradingState.availableSymbols.forEach(item => {
    tradingState.selectedSymbols.add(item.symbol);
  });
  renderMarketList();
  updatePairCount();
  syncDerivTickSubscriptions();
}

function clearPairs() {
  tradingState.selectedSymbols.clear();
  renderMarketList();
  updatePairCount();
  syncDerivTickSubscriptions();
}

function updatePairCount() {
  const count = tradingState.selectedSymbols.size;
  setText("selectedPairCount", `${count} pairs selected`);
  setText("pairCount", count);
}

/* =========================================================
   CANDLE DATA
========================================================= */

function normalizeCandle(item) {
  return {
    epoch: Number(item.epoch || item.open_time || item.time),
    open: Number(item.open),
    high: Number(item.high),
    low: Number(item.low),
    close: Number(item.close)
  };
}

function isValidCandle(candle) {
  return candle &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close);
}

function requestCandles(symbol, timeframe) {
  const granularity = GRANULARITY[timeframe];
  if (!granularity) return;
  const subscribed = [...tradingState.candleSubscriptions.values()].some(
    context => context.symbol === symbol && context.timeframe === timeframe
  );
  const queued = tradingState.scanQueue.some(job => job.symbol === symbol && job.timeframe === timeframe);
  if (subscribed || queued) return;

  tradingState.scanQueue.push({ symbol, timeframe, granularity });
  processScanQueue();
}

function clearScanQueue() {
  tradingState.scanQueue.length = 0;
  if (tradingState.scanQueueTimer) {
    clearInterval(tradingState.scanQueueTimer);
    tradingState.scanQueueTimer = null;
  }
  tradingState.scanInProgress = false;
}

function processScanQueue() {
  if (tradingState.scanQueueTimer || !tradingState.running) return;

  tradingState.scanQueueTimer = setInterval(() => {
    if (!tradingState.running || !isSocketOpen()) {
      clearScanQueue();
      return;
    }

    const job = tradingState.scanQueue.shift();
    if (!job) {
      clearInterval(tradingState.scanQueueTimer);
      tradingState.scanQueueTimer = null;
      tradingState.scanInProgress = false;
      return;
    }

    sendRequest({
      ticks_history: job.symbol,
      adjust_start_time: 1,
      count: 100,
      end: "latest",
      style: "candles",
      granularity: job.granularity,
      subscribe: 1
    }, { symbol: job.symbol, timeframe: job.timeframe });
  }, 500);
}

/* =========================================================
   MARKET STRUCTURE / APA ANALYSIS
========================================================= */

function findStructureZones(candles) {
  const data = candles.slice(-80);
  const pivots = { high: null, low: null };

  for (let i = 2; i < data.length - 2; i++) {
    const c = data[i];
    const isHigh = c.high > data[i - 1].high &&
      c.high > data[i - 2].high &&
      c.high >= data[i + 1].high &&
      c.high >= data[i + 2].high;
    const isLow = c.low < data[i - 1].low &&
      c.low < data[i - 2].low &&
      c.low <= data[i + 1].low &&
      c.low <= data[i + 2].low;

    if (isHigh) pivots.high = { candle: c, index: i };
    if (isLow) pivots.low = { candle: c, index: i };
  }

  const supply = pivots.high ? {
    low: Math.min(pivots.high.candle.open, pivots.high.candle.close),
    high: pivots.high.candle.high
  } : null;
  const demand = pivots.low ? {
    low: pivots.low.candle.low,
    high: Math.max(pivots.low.candle.open, pivots.low.candle.close)
  } : null;

  return { supply, demand };
}

function findOrderBlock(candles, direction) {
  const end = candles.length - 1;
  const start = Math.max(0, end - 12);

  for (let i = end - 1; i >= start; i--) {
    const c = candles[i];
    if (direction === "bullish" && c.close < c.open) {
      return { low: c.low, high: c.open, direction: "bullish" };
    }
    if (direction === "bearish" && c.close > c.open) {
      return { low: c.open, high: c.high, direction: "bearish" };
    }
  }
  return null;
}

function formatZone(zone) {
  return zone ? `${formatPrice(zone.low)} – ${formatPrice(zone.high)}` : "Not identified";
}

function getTrend(candles) {
  if (!Array.isArray(candles) || candles.length < 12) return "Unknown";
  const sample = candles.slice(-20);
  const first = sample[0].close, last = sample[sample.length - 1].close;
  const highs = sample.slice(-6).map(c => c.high);
  const lows = sample.slice(-6).map(c => c.low);
  const rising = highs[highs.length - 1] > highs[0] && lows[lows.length - 1] > lows[0];
  const falling = highs[highs.length - 1] < highs[0] && lows[lows.length - 1] < lows[0];
  if (last > first && rising) return "Bullish";
  if (last < first && falling) return "Bearish";
  if (last > first * 1.001) return "Bullish";
  if (last < first * 0.999) return "Bearish";
  return "Sideways";
}

function getStructure(candles) {
  const empty = {
    label: "Waiting", bosUp: false, bosDown: false,
    mssUp: false, mssDown: false,
    chochUp: false, chochDown: false,
    brokenHigh: null, brokenLow: null
  };
  if (!Array.isArray(candles) || candles.length < 20) return empty;

  // Use confirmed swing points only. The final two candles are excluded
  // from pivot selection so an unfinished swing cannot become a level.
  const sample = candles.slice(-80);
  let swingHigh = null, swingLow = null;
  for (let i = 2; i < sample.length - 2; i++) {
    const c = sample[i];
    const isHigh = c.high > sample[i - 1].high &&
      c.high > sample[i - 2].high &&
      c.high >= sample[i + 1].high &&
      c.high >= sample[i + 2].high;
    const isLow = c.low < sample[i - 1].low &&
      c.low < sample[i - 2].low &&
      c.low <= sample[i + 1].low &&
      c.low <= sample[i + 2].low;
    if (isHigh) swingHigh = { price: c.high, index: i };
    if (isLow) swingLow = { price: c.low, index: i };
  }
  if (!swingHigh || !swingLow) return empty;

  const last = sample[sample.length - 1];
  const previous = sample[sample.length - 2];
  const oldTrend = getTrend(sample.slice(0, -1));
  const breakUp = last.close > swingHigh.price && previous.close <= swingHigh.price;
  const breakDown = last.close < swingLow.price && previous.close >= swingLow.price;

  // A continuation break is BOS; a break against the established trend
  // is CHoCH. MSS requires that reversal break plus a recent liquidity
  // sweep and displacement in the direction of the break.
  const chochUp = breakUp && oldTrend === "Bearish";
  const chochDown = breakDown && oldTrend === "Bullish";
  const bosUp = breakUp && !chochUp;
  const bosDown = breakDown && !chochDown;

  const recent = sample.slice(-9);
  const sweep = getLiquidity(recent);
  const displaced = getDisplacement(sample);
  const mssUp = chochUp && sweep.sweepLow && last.close > last.open && displaced;
  const mssDown = chochDown && sweep.sweepHigh && last.close < last.open && displaced;

  const label = mssUp ? "Bullish MSS" : mssDown ? "Bearish MSS" :
    chochUp ? "Bullish CHoCH" : chochDown ? "Bearish CHoCH" :
    bosUp ? "Bullish BOS" : bosDown ? "Bearish BOS" : "No new confirmed break";

  return {
    label, bosUp, bosDown, mssUp, mssDown, chochUp, chochDown,
    brokenHigh: breakUp ? swingHigh.price : null,
    brokenLow: breakDown ? swingLow.price : null,
    priorTrend: oldTrend
  };
}
function getLiquidity(candles) {
  if (!Array.isArray(candles) || candles.length < 8)
    return { label: "Waiting", sweepLow: false, sweepHigh: false };
  const last = candles[candles.length - 1], pool = candles.slice(-8, -1);
  const poolHigh = Math.max(...pool.map(c => c.high));
  const poolLow = Math.min(...pool.map(c => c.low));
  const sweepLow = last.low < poolLow && last.close > poolLow;
  const sweepHigh = last.high > poolHigh && last.close < poolHigh;
  return { label: sweepLow ? "Sell-side liquidity swept" :
    sweepHigh ? "Buy-side liquidity swept" : "No sweep", sweepLow, sweepHigh };
}

function getFVGState(candles) {
  if (!Array.isArray(candles) || candles.length < 3)
    return { bullishFVG: false, bearishFVG: false, bullishIFVG: false, bearishIFVG: false };
  const a = candles[candles.length - 3], c = candles[candles.length - 1];
  const bullishFVG = c.low > a.high, bearishFVG = c.high < a.low;
  const prior = candles.slice(-12, -2);
  let bullishIFVG = false, bearishIFVG = false;
  for (let i = 2; i < prior.length; i++) {
    const left = prior[i - 2], right = prior[i];
    if (right.low > left.high && c.close < left.high) bearishIFVG = true;
    if (right.high < left.low && c.close > left.low) bullishIFVG = true;
  }
  return { bullishFVG, bearishFVG, bullishIFVG, bearishIFVG };
}

function getDisplacement(candles) {
  if (!Array.isArray(candles) || !candles.length) return false;
  const c = candles[candles.length - 1];
  return Math.abs(c.close - c.open) / Math.max(c.high - c.low, 1e-10) >= 0.65;
}

function calculateSMCStructureLevels(candles, direction, zones, bullishOB, bearishOB) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return { entry: null, sl: null, tp: null, riskReward: null,
      slReason: "Waiting for enough candles", tpReason: "Waiting for structure" };
  }

  const sample = candles.slice(-80);
  const last = sample[sample.length - 1];
  const entry = last.close;
  const poi = direction === "buy"
    ? (bullishOB || zones.demand)
    : (bearishOB || zones.supply);

  if (!poi) {
    return { entry, sl: null, tp: null, riskReward: null,
      slReason: "No valid directional Order Block or POI identified",
      tpReason: "No trade levels: directional POI is missing" };
  }

  // Place invalidation beyond the POI and the recent local extreme,
  // with a small volatility buffer to reduce ordinary wick stop-outs.
  const recent = sample.slice(-8, -1);
  const ranges = sample.slice(-14, -1).map(c => Math.max(0, c.high - c.low));
  const averageRange = ranges.length
    ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length
    : 0;
  const buffer = averageRange * 0.10;
  const localLow = Math.min(...recent.map(c => c.low), last.low);
  const localHigh = Math.max(...recent.map(c => c.high), last.high);
  const sl = direction === "buy"
    ? Math.min(poi.low, localLow) - buffer
    : Math.max(poi.high, localHigh) + buffer;
  const risk = direction === "buy" ? entry - sl : sl - entry;

  if (!Number.isFinite(risk) || risk <= 0) {
    return { entry, sl: null, tp: null, riskReward: null,
      slReason: "POI invalidation is on the wrong side of entry",
      tpReason: "No valid risk distance; wait for a better entry" };
  }

  // Find the nearest confirmed opposing swing/liquidity pool beyond entry.
  let target = null;
  for (let i = 2; i < sample.length - 2; i++) {
    const c = sample[i];
    const isSwingHigh = c.high > sample[i - 1].high &&
      c.high > sample[i - 2].high &&
      c.high >= sample[i + 1].high &&
      c.high >= sample[i + 2].high;
    const isSwingLow = c.low < sample[i - 1].low &&
      c.low < sample[i - 2].low &&
      c.low <= sample[i + 1].low &&
      c.low <= sample[i + 2].low;
    if (direction === "buy" && isSwingHigh && c.high > entry &&
        (target === null || c.high < target)) target = c.high;
    if (direction === "sell" && isSwingLow && c.low < entry &&
        (target === null || c.low > target)) target = c.low;
  }

  // Use the opposing supply/demand boundary as a structural target only
  // when it is beyond entry and no confirmed swing target was found.
  if (target === null) {
    if (direction === "buy" && zones.supply && zones.supply.low > entry) target = zones.supply.low;
    if (direction === "sell" && zones.demand && zones.demand.high < entry) target = zones.demand.high;
  }

  if (target === null) {
    return { entry, sl, tp: null, riskReward: null,
      slReason: "SL beyond " + (direction === "buy" ? "bullish" : "bearish") + " POI and recent swing extreme",
      tpReason: "No confirmed opposing liquidity/swing target beyond entry — WAIT" };
  }

  const reward = direction === "buy" ? target - entry : entry - target;
  const riskReward = reward / risk;
  if (!Number.isFinite(reward) || reward <= 0 || riskReward < 1.5) {
    return { entry, sl, tp: null, riskReward,
      slReason: "SL beyond " + (direction === "buy" ? "bullish" : "bearish") + " POI and recent swing extreme",
      tpReason: "Nearest liquidity target offers less than 1:1.5 reward-to-risk — WAIT" };
  }

  return {
    entry, sl, tp: target, riskReward,
    slReason: "Beyond " + (direction === "buy" ? "bullish" : "bearish") + " POI and recent swing extreme",
    tpReason: "Nearest confirmed opposing swing/liquidity target"
  };
}

function analyseSMC(candles) {
  if (!Array.isArray(candles) || candles.length < 20) {
    return {
      ready: false, trend: "Insufficient candles", structure: "Waiting",
      liquidity: "Waiting", supply: null, demand: null,
      breaker: "Waiting", checks: [], signal: "Waiting for candles"
    };
  }

  const last = candles[candles.length - 1];
  const trend = getTrend(candles);
  const structure = getStructure(candles);
  const liquidity = getLiquidity(candles);
  const fvg = getFVGState(candles);
  const displacement = getDisplacement(candles);
  const zones = findStructureZones(candles);
  const bullishOB = findOrderBlock(candles, "bullish");
  const bearishOB = findOrderBlock(candles, "bearish");

  // Read every SMC dashboard filter. Missing controls retain the safe
  // default (enabled) for compatibility with older/non-browser builds.
  const smcEnabled = id => {
    const control = typeof document !== "undefined" ? document.getElementById(id) : null;
    return control ? Boolean(control.checked) : true;
  };
  const useTrend = smcEnabled("useTrend");
  const useLiquidity = smcEnabled("useLiquidity");
  const useBOS = smcEnabled("useBOS");
  const useMSS = smcEnabled("useMSS");
  const useCHoCH = smcEnabled("useCHoCH");
  const useDisplacement = smcEnabled("useDisplacement");
  const useOB = smcEnabled("useOB");
  const useFVG = smcEnabled("useFVG");
  const useIFVG = smcEnabled("useIFVG");
  const useBreaker = smcEnabled("useBreaker");
  const useSupplyDemand = smcEnabled("useSupplyDemand");

  const bullishOBTouch = Boolean(useOB && bullishOB &&
    last.low <= bullishOB.high && last.high >= bullishOB.low &&
    last.close > last.open && last.close >= bullishOB.low);
  const bearishOBTouch = Boolean(useOB && bearishOB &&
    last.high >= bearishOB.low && last.low <= bearishOB.high &&
    last.close < last.open && last.close <= bearishOB.high);

  // A breaker is confirmed only after the failed block is crossed and
  // retested/rejected. Disabling OB or Breaker disables this confirmation.
  let breaker = useBreaker && useOB ? "Not identified" : "Disabled in SMC settings";
  let bullishBreaker = false;
  let bearishBreaker = false;
  const previous = candles[candles.length - 2];
  if (useBreaker && useOB && bearishOB && previous.close > bearishOB.high &&
      last.low <= bearishOB.high && last.close > bearishOB.high &&
      last.close > last.open) {
    breaker = "Bullish breaker retest confirmed";
    bullishBreaker = true;
  } else if (useBreaker && useOB && bullishOB && previous.close < bullishOB.low &&
      last.high >= bullishOB.low && last.close < bullishOB.low &&
      last.close < last.open) {
    breaker = "Bearish breaker retest confirmed";
    bearishBreaker = true;
  } else if (useBreaker && useOB && (
      (bearishOB && last.close > bearishOB.high) ||
      (bullishOB && last.close < bullishOB.low)
  )) {
    breaker = "Break detected — waiting for retest and rejection";
  }

  const demandSupport = Boolean(
    useSupplyDemand && zones.demand && last.low <= zones.demand.high &&
    last.close >= zones.demand.low
  );
  const supplyResistance = Boolean(
    useSupplyDemand && zones.supply && last.high >= zones.supply.low &&
    last.close <= zones.supply.high
  );
  const bullishCandle = last.close > last.open;
  const bearishCandle = last.close < last.open;

  // Count independent confirmation groups. BOS/MSS/CHoCH are one
  // structure group; FVG/IFVG are one imbalance group; OB/breaker
  // are one block group so the same event is never double-counted.
  const bullConfirmations = [];
  const bearConfirmations = [];

  if (useTrend && trend === "Bullish") bullConfirmations.push("Bullish trend");
  if (useTrend && trend === "Bearish") bearConfirmations.push("Bearish trend");

  const bullStructure = (useBOS && structure.bosUp) || (useMSS && structure.mssUp) || (useCHoCH && structure.chochUp);
  const bearStructure = (useBOS && structure.bosDown) || (useMSS && structure.mssDown) || (useCHoCH && structure.chochDown);
  if (bullStructure) bullConfirmations.push(useMSS && structure.mssUp ? "Bullish MSS" : useCHoCH && structure.chochUp ? "Bullish CHoCH" : "Bullish BOS");
  if (bearStructure) bearConfirmations.push(useMSS && structure.mssDown ? "Bearish MSS" : useCHoCH && structure.chochDown ? "Bearish CHoCH" : "Bearish BOS");

  if (useLiquidity && liquidity.sweepLow) bullConfirmations.push("Low-side liquidity sweep");
  if (useLiquidity && liquidity.sweepHigh) bearConfirmations.push("High-side liquidity sweep");

  if (useDisplacement && displacement && bullishCandle) bullConfirmations.push("Bullish displacement");
  if (useDisplacement && displacement && bearishCandle) bearConfirmations.push("Bearish displacement");

  const bullFVGEnabled = (useFVG && fvg.bullishFVG) || (useIFVG && fvg.bullishIFVG);
  const bearFVGEnabled = (useFVG && fvg.bearishFVG) || (useIFVG && fvg.bearishIFVG);
  if (bullFVGEnabled) bullConfirmations.push(useIFVG && fvg.bullishIFVG ? "Bullish IFVG" : "Bullish FVG");
  if (bearFVGEnabled) bearConfirmations.push(useIFVG && fvg.bearishIFVG ? "Bearish IFVG" : "Bearish FVG");

  if (bullishOBTouch || bullishBreaker) {
    bullConfirmations.push(bullishBreaker ? "Bullish breaker block" : "Bullish Order Block reaction");
  }
  if (bearishOBTouch || bearishBreaker) {
    bearConfirmations.push(bearishBreaker ? "Bearish breaker block" : "Bearish Order Block reaction");
  }

  if (demandSupport) bullConfirmations.push("Demand zone reaction");
  if (supplyResistance) bearConfirmations.push("Supply zone reaction");

  const rawBuyReady = bullConfirmations.length >= 2 && bullishCandle;
  const rawSellReady = bearConfirmations.length >= 2 && bearishCandle;
  const bullishReversalConfirmed = Boolean(bullStructure && useLiquidity && liquidity.sweepLow);
  const bearishReversalConfirmed = Boolean(bearStructure && useLiquidity && liquidity.sweepHigh);

  let buyReady = rawBuyReady;
  let sellReady = rawSellReady;
  let blockedDirectionReason = "";

  if (useTrend && buyReady && trend === "Bearish" && !bullishReversalConfirmed) {
    buyReady = false;
    blockedDirectionReason = "Bullish candidate blocked: the higher market trend is bearish and there is no bullish structure break plus low-side liquidity sweep to confirm a reversal.";
  }
  if (useTrend && sellReady && trend === "Bullish" && !bearishReversalConfirmed) {
    sellReady = false;
    blockedDirectionReason = "Bearish candidate blocked: the higher market trend is bullish and there is no bearish structure break plus high-side liquidity sweep to confirm a reversal.";
  }
  if (sellReady && demandSupport && !bearishReversalConfirmed) {
    sellReady = false;
    blockedDirectionReason = "SELL blocked: price is reacting at demand and a bearish structural reversal is not confirmed.";
  }
  if (buyReady && supplyResistance && !bullishReversalConfirmed) {
    buyReady = false;
    blockedDirectionReason = "BUY blocked: price is reacting at supply and a bullish structural reversal is not confirmed.";
  }

  // Block a direction when both sides independently have the minimum
  // two confirmation groups, even though the final candle cannot be both
  // bullish and bearish. Candle colour must not hide opposing SMC evidence.
  const conflicting = bullConfirmations.length >= 2 && bearConfirmations.length >= 2;
  if (conflicting) {
    buyReady = false;
    sellReady = false;
    blockedDirectionReason = "Conflicting SMC evidence: both bullish and bearish sides have at least 2 independent confirmations. WAIT for the conflict to resolve.";
  }

  const signal = conflicting
    ? "Conflicting confirmations — no signal"
    : buyReady
      ? (bullConfirmations.length >= 3 ? "Stronger BUY candidate — " : "Potential BUY — ") +
        bullConfirmations.length + " confirmations"
      : sellReady
        ? (bearConfirmations.length >= 3 ? "Stronger SELL candidate — " : "Potential SELL — ") +
          bearConfirmations.length + " confirmations"
        : "Waiting — need 2 compatible confirmations";

  const activeSide = conflicting ? "conflicting" : buyReady ? "buy" : sellReady ? "sell" : "wait";
  const levels = activeSide === "buy" || activeSide === "sell"
    ? calculateSMCStructureLevels(candles, activeSide, zones, bullishOB, bearishOB)
    : { entry: last.close, sl: null, tp: null, riskReward: null,
        slReason: "No confirmed directional setup", tpReason: "No confirmed directional setup" };
  const entry = levels.entry;
  const sl = levels.sl;
  const tp = levels.tp;
  const activeConfirmations = activeSide === "buy" ? bullConfirmations : activeSide === "sell" ? bearConfirmations : [];
  const opposingConfirmations = activeSide === "buy" ? bearConfirmations : activeSide === "sell" ? bullConfirmations : [];
  const reasoning = conflicting
    ? "WAIT: bullish and bearish setups are both present. The evidence conflicts, so no direction is selected."
    : activeSide === "buy"
      ? `BUY candidate: ${activeConfirmations.length} compatible confirmations support the bullish direction: ${activeConfirmations.join(", ")}. The latest candle is bullish. This is a candidate, not an executed trade.`
      : activeSide === "sell"
        ? `SELL candidate: ${activeConfirmations.length} compatible confirmations support the bearish direction: ${activeConfirmations.join(", ")}. The latest candle is bearish. This is a candidate, not an executed trade.`
        : `WAIT: ${blockedDirectionReason || "neither side has the required 2 compatible confirmations plus a matching candle."} Bullish evidence: ${bullConfirmations.join(", ") || "none"}. Bearish evidence: ${bearConfirmations.join(", ") || "none"}.`;
  const checks = [
    ["Trend direction" + (useTrend ? "" : " (disabled)"), useTrend && trend !== "Sideways" && trend !== "Unknown"],
    ["Liquidity sweep" + (useLiquidity ? "" : " (disabled)"), useLiquidity && (liquidity.sweepLow || liquidity.sweepHigh)],
    ["BOS / MSS / CHoCH (one structure group)", bullStructure || bearStructure],
    ["Strong displacement" + (useDisplacement ? "" : " (disabled)"), useDisplacement && displacement],
    ["Order Block identified" + (useOB ? "" : " (disabled)"), useOB && Boolean(bullishOB || bearishOB)],
    ["Order Block reaction", bullishOBTouch || bearishOBTouch],
    ["Supply zone identified" + (useSupplyDemand ? "" : " (disabled)"), useSupplyDemand && Boolean(zones.supply)],
    ["Demand zone identified" + (useSupplyDemand ? "" : " (disabled)"), useSupplyDemand && Boolean(zones.demand)],
    ["Breaker Block retest confirmed" + (useBreaker ? "" : " (disabled)"), useBreaker && (bullishBreaker || bearishBreaker)],
    ["FVG / IFVG (one imbalance group)", bullFVGEnabled || bearFVGEnabled],
    ["Bullish confirmations", bullConfirmations.length + " — " + bullConfirmations.join(", ")],
    ["Bearish confirmations", bearConfirmations.length + " — " + bearConfirmations.join(", ")],
    ["Minimum 2 compatible confirmations", (buyReady || sellReady) && !conflicting]
  ];

  return {
    ready: true, strategy: "smc", trend, structure: structure.label,
    liquidity: liquidity.label, signal, entry,
    sl: conflicting ? null : sl, tp: conflicting ? null : tp,
    invalidation: conflicting ? null : sl,
    riskReward: conflicting ? null : levels.riskReward,
    slReason: levels.slReason, tpReason: levels.tpReason,
    checks,
    displacement, supply: useSupplyDemand ? zones.supply : null, demand: useSupplyDemand ? zones.demand : null, breaker,
    breakerFound: bullishBreaker || bearishBreaker,
    orderBlock: useOB ? (trend === "Bullish" ? (bullishOB || bearishOB) : (bearishOB || bullishOB)) : null,
    orderBlockTouched: bullishOBTouch || bearishOBTouch,
    demandSupport, supplyResistance,
    bullishConfirmations: bullConfirmations.length,
    bearishConfirmations: bearConfirmations.length,
    bullishConfirmationNames: bullConfirmations,
    bearishConfirmationNames: bearConfirmations,
    reasoning,
    structureDetails: structure, fvgDetails: fvg,
    fvg: fvg.bullishFVG || fvg.bearishFVG,
    ifvg: fvg.bullishIFVG || fvg.bearishIFVG
  };
}

function getAPASequence(candles, poi, direction) {
  const empty = { swept: false, confirmed: false, sweepIndex: -1, sweepExtreme: null,
    sweepLevel: null, structureLabel: "Waiting for sweep then structure break", displacement: false };
  if (!Array.isArray(candles) || candles.length < 12 || !poi) return empty;
  const lastIndex = candles.length - 1;
  const confirm = candles[lastIndex];
  const body = Math.abs(confirm.close - confirm.open);
  const range = Math.max(confirm.high - confirm.low, 1e-10);
  const displacement = body / range >= 0.60 &&
    (direction === "bullish"
      ? confirm.close > confirm.open && (confirm.high - confirm.close) / range <= 0.25
      : confirm.close < confirm.open && (confirm.close - confirm.low) / range <= 0.25);
  // First report a qualifying sweep independently; BOS/displacement may arrive later.
  for (let i = lastIndex - 1; i >= Math.max(7, lastIndex - 12); i--) {
    const pool = candles.slice(Math.max(0, i - 7), i);
    if (pool.length < 3) continue;
    const poolHigh = Math.max(...pool.map(c => c.high));
    const poolLow = Math.min(...pool.map(c => c.low));
    const sweep = candles[i];
    const touchedPOI = sweep.low <= poi.high && sweep.high >= poi.low;
    const swept = direction === "bullish"
      ? sweep.low < poolLow && sweep.close > poolLow
      : sweep.high > poolHigh && sweep.close < poolHigh;
    if (!swept || !touchedPOI) continue;
    const structureBars = candles.slice(i + 1, lastIndex);
    const brokenLevel = structureBars.length
      ? (direction === "bullish"
          ? Math.max(...structureBars.map(c => c.high))
          : Math.min(...structureBars.map(c => c.low)))
      : null;
    const structureBreak = brokenLevel !== null && (direction === "bullish"
      ? confirm.close > brokenLevel && confirm.close > confirm.open
      : confirm.close < brokenLevel && confirm.close < confirm.open);
    return { swept: true, confirmed: Boolean(structureBreak && displacement), sweepIndex: i,
      sweepExtreme: direction === "bullish" ? sweep.low : sweep.high,
      sweepLevel: direction === "bullish" ? poolLow : poolHigh,
      structureLabel: structureBreak
        ? (direction === "bullish" ? "Bullish BOS after sell-side sweep" : "Bearish BOS after buy-side sweep")
        : "Sweep detected — waiting for later BOS/MSS",
      displacement: Boolean(structureBreak && displacement) };
  }
  return empty;
}

function analyseAPA(entryCandles, higherCandles, lowerCandles) {
  if (!checked("useAPA")) {
    return { ready: true, strategy: "apa", trend: "APA disabled in settings",
      structure: "Not evaluated", liquidity: "Not evaluated",
      signal: "WAIT — APA analysis disabled",
      reasoning: "APA is disabled in Settings. No APA candidate is generated.",
      checks: [["APA enabled", false]], entry: null, sl: null, tp: null,
      invalidation: null, supply: null, demand: null, breaker: "APA disabled",
      structureDetails: {}, fvgDetails: {}, displacement: false };
  }
  // Deriv's final candle can still be forming. APA confirmations use closed candles only.
  const confirmedEntry = Array.isArray(entryCandles) ? entryCandles.slice(0, -1) : [];
  const confirmedHigher = Array.isArray(higherCandles) ? higherCandles.slice(0, -1) : [];
  const confirmedLower = Array.isArray(lowerCandles) ? lowerCandles.slice(0, -1) : [];
  if (confirmedEntry.length < 20 || confirmedHigher.length < 12)
    return { ready: false, trend: "Waiting for closed higher-timeframe candles",
      structure: "Waiting", liquidity: "Waiting", supply: null, demand: null,
      breaker: "APA POI scan waiting", checks: [], signal: "Waiting for APA timeframes" };
  const last = confirmedEntry[confirmedEntry.length - 1];
  const higherTrend = getTrend(confirmedHigher);
  const structure = getStructure(confirmedEntry);
  const zones = findStructureZones(confirmedHigher);
  const bullishOB = findOrderBlock(confirmedHigher, "bullish");
  const bearishOB = findOrderBlock(confirmedHigher, "bearish");
  const bullishPOI = bullishOB || zones.demand;
  const bearishPOI = bearishOB || zones.supply;
  const nearDemand = Boolean(bullishPOI && last.low <= bullishPOI.high && last.high >= bullishPOI.low);
  const nearSupply = Boolean(bearishPOI && last.high >= bearishPOI.low && last.low <= bearishPOI.high);
  const bullishSequence = getAPASequence(confirmedEntry, bullishPOI, "bullish");
  const bearishSequence = getAPASequence(confirmedEntry, bearishPOI, "bearish");
  const ltf = confirmedLower.length >= 8 ? confirmedLower : confirmedEntry;
  const ltfLast = ltf[ltf.length - 1];
  const ltfBullish = ltfLast.close > ltfLast.open, ltfBearish = ltfLast.close < ltfLast.open;
  // The sweep itself must overlap the POI. Do not require price to remain
  // inside the zone after the later BOS/displacement has confirmed.
  const requireAPAConfirmation = checked("useAPAConfirmation");
  const buyReady = higherTrend === "Bullish" && bullishSequence.confirmed &&
    (!requireAPAConfirmation || ltfBullish);
  const sellReady = higherTrend === "Bearish" && bearishSequence.confirmed &&
    (!requireAPAConfirmation || ltfBearish);
  const signal = buyReady ? "Potential APA BUY — sweep, later BOS and displacement confirmed" :
    sellReady ? "Potential APA SELL — sweep, later BOS and displacement confirmed" :
    "APA WAIT — require trend → POI → sweep → later BOS/MSS → displacement → entry";
  const entry = last.close;
  const sl = buyReady ? Math.min(bullishSequence.sweepExtreme, bullishPOI.low) :
    sellReady ? Math.max(bearishSequence.sweepExtreme, bearishPOI.high) : null;
  const risk = sl === null ? null : Math.abs(entry - sl);
  const tp = risk === null || risk <= 0 ? null :
    (buyReady ? entry + risk * 2 : entry - risk * 2);
  const liquidityLabel = bullishSequence.swept ? "Sell-side liquidity swept at bullish POI" :
    bearishSequence.swept ? "Buy-side liquidity swept at bearish POI" : "No qualifying POI sweep";
  const apaReasons = [`Higher timeframe: ${higherTrend}.`];
  if (bullishPOI) apaReasons.push(`Bullish POI: ${formatZone(bullishPOI)}.`);
  if (bearishPOI) apaReasons.push(`Bearish POI: ${formatZone(bearishPOI)}.`);
  if (nearDemand) apaReasons.push("Latest price overlaps the bullish POI.");
  if (nearSupply) apaReasons.push("Latest price overlaps the bearish POI.");
  if (bullishSequence.swept) apaReasons.push("Sell-side liquidity sweep occurred at the bullish POI.");
  if (bearishSequence.swept) apaReasons.push("Buy-side liquidity sweep occurred at the bearish POI.");
  if (bullishSequence.confirmed) apaReasons.push(bullishSequence.structureLabel + " with displacement.");
  if (bearishSequence.confirmed) apaReasons.push(bearishSequence.structureLabel + " with displacement.");
  if (ltfBullish) apaReasons.push("Lower timeframe candle is bullish.");
  if (ltfBearish) apaReasons.push("Lower timeframe candle is bearish.");
  const reasoning = buyReady
    ? `BUY candidate: bullish higher-timeframe structure, POI reaction, sell-side sweep, later bullish structure break, displacement and lower-timeframe alignment. ${apaReasons.join(" ")}`
    : sellReady
      ? `SELL candidate: bearish higher-timeframe structure, POI reaction, buy-side sweep, later bearish structure break, displacement and lower-timeframe alignment. ${apaReasons.join(" ")}`
      : `WAIT: APA requires the ordered sequence trend → POI → liquidity sweep → later structure break → displacement → lower-timeframe entry. ${apaReasons.join(" ")}`;
  const checks = [
    ["Higher-timeframe trend", higherTrend !== "Sideways" && higherTrend !== "Unknown"],
    ["POI identified (OB / supply-demand area)", Boolean(bullishPOI || bearishPOI)],
    ["Liquidity sweep overlaps relevant POI", bullishSequence.swept || bearishSequence.swept],
    ["Liquidity sweep at POI", bullishSequence.swept || bearishSequence.swept],
    ["Later BOS/MSS after sweep", bullishSequence.confirmed || bearishSequence.confirmed],
    ["Strong displacement", bullishSequence.displacement || bearishSequence.displacement],
    ["Lower-timeframe entry direction", (buyReady && ltfBullish) || (sellReady && ltfBearish)]
  ];
  return { ready: true, strategy: "apa", trend: higherTrend,
    structure: bullishSequence.confirmed ? bullishSequence.structureLabel :
      bearishSequence.confirmed ? bearishSequence.structureLabel : structure.label,
    liquidity: liquidityLabel, sweepStatus, sweepDirection, sweepPrice, sweepLevel: sweepState.swept ? sweepState.sweepLevel : null, signal, entry, sl, tp, invalidation: sl, checks, reasoning,
    supply: zones.supply, demand: zones.demand, breaker: "SMC breaker logic is separate from APA",
    breakerFound: false, demandSupport: nearDemand, supplyResistance: nearSupply,
    structureDetails: structure, fvgDetails: getFVGState(confirmedEntry),
    orderBlock: higherTrend === "Bullish" ? bullishOB : bearishOB,
    displacement: bullishSequence.displacement || bearishSequence.displacement };
}


/* APA TOP-DOWN ENGINE: D1 -> H4 -> H1 -> M30 -> M15 setup -> M5 refinement -> M1 trigger. */
function analyseAPATopDown(symbol) {
  if (tradingState.mode !== "intraday") {
    return { ready: false, strategy: "apa", signal: "APA is Intraday-only — select Intraday to analyse APA", entry: null, sl: null, tp: null, reasoning: "APA does not generate Scalping or Swing signals." };
  }
  const setupTimeframe = APA_SETUP_FRAME.intraday;
  const daily = tradingState.candles[candleKey(symbol, "1d")] || [];
  const h4 = tradingState.candles[candleKey(symbol, "4h")] || [];
  const h1 = tradingState.candles[candleKey(symbol, "1h")] || [];
  const m30 = tradingState.candles[candleKey(symbol, "30m")] || [];
  const setup = tradingState.candles[candleKey(symbol, setupTimeframe)] || [];
  const m5 = tradingState.candles[candleKey(symbol, "5m")] || [];
  const m1 = tradingState.candles[candleKey(symbol, "1m")] || [];
  const closed = candles => Array.isArray(candles) ? candles.slice(0, -1) : [];
  const d1Trend = getTrend(closed(daily)), h4Trend = getTrend(closed(h4)), h1Trend = getTrend(closed(h1));
  const m30Trend = getTrend(closed(m30)), m5Trend = getTrend(closed(m5));
  const enough = closed(daily).length >= 12 && closed(h4).length >= 12 &&
    closed(h1).length >= 12 && closed(m30).length >= 12 &&
    closed(setup).length >= 20 && closed(m5).length >= 12 && closed(m1).length >= 20;
  const context = [d1Trend,h4Trend,h1Trend,m30Trend,m5Trend];
  const bullishContext = context.every(t => t === "Bullish"), bearishContext = context.every(t => t === "Bearish");
  const base = analyseAPA(setup, daily, m1);
  const direction = /\bBUY\b/i.test(base.signal || "") ? "BUY" : /\bSELL\b/i.test(base.signal || "") ? "SELL" : "";
  const m1Closed = closed(m1), m1Structure = getStructure(m1Closed), m1Sweep = getLiquidity(m1Closed), m1Displacement = getDisplacement(m1Closed);
  const lastM1 = m1Closed[m1Closed.length - 1], m1Bull = Boolean(lastM1 && lastM1.close > lastM1.open), m1Bear = Boolean(lastM1 && lastM1.close < lastM1.open);
  const m1BuyTrigger = m1Bull && m1Displacement && (m1Structure.bosUp || m1Structure.mssUp || m1Structure.chochUp || m1Sweep.sweepLow);
  const m1SellTrigger = m1Bear && m1Displacement && (m1Structure.bosDown || m1Structure.mssDown || m1Structure.chochDown || m1Sweep.sweepHigh);
  const contextAligned = direction === "BUY" ? bullishContext : direction === "SELL" ? bearishContext : false;
  const trigger = direction === "BUY" ? m1BuyTrigger : direction === "SELL" ? m1SellTrigger : false;
  const entry = lastM1 ? Number(lastM1.close) : null, sl = direction ? base.sl : null;
  const risk = direction && Number.isFinite(entry) && Number.isFinite(Number(sl)) ? Math.abs(entry - Number(sl)) : null;
  const tp = risk > 0 ? (direction === "BUY" ? entry + risk * 2 : entry - risk * 2) : null;
  const valid = Boolean(enough && base.ready && direction && contextAligned && trigger && Number.isFinite(entry) && risk > 0);
  const contextText = "D1 " + d1Trend + " / H4 " + h4Trend + " / H1 " + h1Trend + " / M30 " + m30Trend + " / M5 " + m5Trend;
  const waitReason = !enough ? "Waiting for sufficient closed candles across required timeframes" : !direction ? "Setup timeframe has no completed APA sequence" : !contextAligned ? "Higher-timeframe trend alignment is not confirmed" : !trigger ? "Waiting for M1 structure/sweep plus displacement entry trigger" : "APA sequence confirmed";
  return { ...base, ready: true, strategy: "apa", setupTimeframe, entryTimeframe: "1m", trend: contextText, signal: valid ? "Potential APA " + direction + " — top-down setup and M1 trigger confirmed" : "APA WAIT — " + waitReason, entry: valid ? entry : null, sl: valid ? sl : null, tp: valid ? tp : null, invalidation: valid ? sl : null, riskReward: valid && risk > 0 ? 2 : null,
    checks: [["D1 trend/context", d1Trend === (direction === "BUY" ? "Bullish" : "Bearish")], ["H4 trend alignment", h4Trend === (direction === "BUY" ? "Bullish" : "Bearish")], ["H1 trend alignment", h1Trend === (direction === "BUY" ? "Bullish" : "Bearish")], ...(tradingState.mode === "intraday" ? [["M30 context alignment", m30Trend === (direction === "BUY" ? "Bullish" : "Bearish")], ["M5 refinement alignment", m5Trend === (direction === "BUY" ? "Bullish" : "Bearish")]] : []), ["Setup timeframe sweep → BOS/MSS → displacement", Boolean(direction && /confirmed/i.test(base.signal || ""))], ["M1 directional displacement", Boolean(direction && m1Displacement && (direction === "BUY" ? m1Bull : m1Bear))], ["M1 BOS/MSS/CHoCH or liquidity sweep", Boolean(direction && (direction === "BUY" ? (m1Structure.bosUp || m1Structure.mssUp || m1Structure.chochUp || m1Sweep.sweepLow) : (m1Structure.bosDown || m1Structure.mssDown || m1Structure.chochDown || m1Sweep.sweepHigh)))], ["M1 entry trigger", valid]],
    reasoning: "Top-down: " + contextText + ". Setup timeframe: " + setupTimeframe.toUpperCase() + ". Final trigger: M1. " + waitReason + ". " + (base.reasoning || ""), m1Structure, m1Sweep, m1Displacement };
}

/* =========================================================
   NEWS TRADING — SEPARATE FOREX NEWS STRATEGY
========================================================= */

const NEWS_CALENDAR_URL =
  "https://showmytrades.com/api/public/calendar/v1?impact=high,medium&days=2";

const NEWS_CURRENCIES = new Set([
  "USD", "EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "CNY"
]);

function getForexPairCurrencies(symbol) {
  // Deriv Forex symbols are prefixed with "frx" (for example frxEURCHF).
  // Strip only known broker prefixes, then require exactly six currency letters.
  const raw = String(symbol || "").trim().toUpperCase();
  const normalized = raw.replace(/^(?:FRX|FOREX)[._-]?/, "");
  const match = normalized.match(/^([A-Z]{6})$/);
  if (!match) return null;

  const base = match[1].slice(0, 3);
  const quote = match[1].slice(3, 6);
  return NEWS_CURRENCIES.has(base) && NEWS_CURRENCIES.has(quote)
    ? { base, quote, pair: base + "/" + quote }
    : null;
}

function getNewsCurrenciesForRequest() {
  const currencies = new Set();
  tradingState.selectedSymbols.forEach(symbol => {
    const pair = getForexPairCurrencies(symbol);
    if (pair) {
      currencies.add(pair.base);
      currencies.add(pair.quote);
    }
  });
  return currencies.size ? [...currencies].join(",") : "";
}

function renderNewsCalendar() {
  const list = $("newsEventsList");
  if (!list) return;
  list.replaceChildren();

  const currencies = new Set(getNewsCurrenciesForRequest().split(",").filter(Boolean));
  const events = tradingState.newsEvents
    .filter(event => !currencies.size || currencies.has(String(event.currency || "").toUpperCase()))
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .slice(0, 18);

  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "result-item";
    empty.textContent = tradingState.newsError
      ? "Calendar unavailable: " + tradingState.newsError
      : "No matching high/medium-impact events in the current calendar window.";
    list.appendChild(empty);
    return;
  }

  events.forEach(event => {
    const row = document.createElement("div");
    row.className = "result-item";
    const date = Number(event.ts) > 0
      ? new Date(Number(event.ts) * 1000).toLocaleString()
      : "Time unavailable";
    const actual = event.actual || "Pending";
    const forecast = event.forecast || "Not supplied";
    row.textContent =
      `${String(event.impact || "unknown").toUpperCase()} | ${event.currency || "?"} | ${date} | ${event.title || "Economic event"} | Actual: ${actual} | Forecast: ${forecast} | ${event.status || "scheduled"}`;
    list.appendChild(row);
  });
}

async function loadNewsCalendar(force = false) {
  if (tradingState.newsLoading) return;
  let refreshSucceeded = false;
  if (!force && Date.now() - tradingState.newsLoadedAt < 15 * 60 * 1000) return;

  tradingState.newsLoading = true;
  tradingState.newsError = "";
  setText("newsCalendarStatus", "Loading calendar...");
  try {
    const currencies = getNewsCurrenciesForRequest();
    const url = NEWS_CALENDAR_URL + (currencies ? "&currency=" + encodeURIComponent(currencies) : "");
    const response = await fetch(url, { method: "GET", cache: "no-store" });
    if (!response.ok) throw new Error("Calendar returned HTTP " + response.status);
    const payload = await response.json();
    if (!payload || !Array.isArray(payload.events)) {
      throw new Error("Calendar response did not contain an events list");
    }
    tradingState.newsEvents = payload.events;
    tradingState.newsLoadedAt = Date.now();
    tradingState.newsError = "";
    setText("newsCalendarStatus",
      `Updated ${new Date(tradingState.newsLoadedAt).toLocaleTimeString()} — ${payload.count ?? payload.events.length} events`);
    renderNewsCalendar();
    refreshSucceeded = true;
  } catch (error) {
    tradingState.newsError = error && error.message ? error.message : "Unknown calendar error";
    tradingState.newsEvents = [];
    tradingState.newsLoadedAt = 0;
    setText("newsCalendarStatus", "Calendar unavailable — signals disabled");
    renderNewsCalendar();
    setText("newsReasoning",
      "WAIT: the economic calendar could not be loaded. News signals are disabled until reliable event data is available. " +
      tradingState.newsError);
    setText("newsSignal", "WAIT — no calendar data");
  } finally {
    tradingState.newsLoading = false;
    // Re-run only after the loading flag is cleared, so analyseNews sees
    // the newly refreshed calendar as available rather than returning WAIT.
    if (tradingState.lastAnalysedSymbol) {
      analyseMainSelection(tradingState.lastAnalysedSymbol);
    }
  }
}

function parseNewsNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const textValue = String(value).trim().replace(/,/g, "");
  const match = textValue.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  if (/K\s*$/i.test(textValue)) number *= 1e3;
  if (/M\s*$/i.test(textValue)) number *= 1e6;
  if (/B\s*$/i.test(textValue)) number *= 1e9;
  return number;
}

function getNewsCurrencyBias(event) {
  const title = String(event.title || "").toLowerCase();
  const actual = parseNewsNumber(event.actual);
  const forecast = parseNewsNumber(event.forecast);
  if (actual === null || forecast === null || actual === forecast) return null;

  let higherIsPositive = null;
  if (/unemployment|jobless claims|initial claims|continuing claims|layoffs|trade deficit|budget deficit/.test(title)) {
    higherIsPositive = false;
  } else if (/gdp|payroll|employment change|nonfarm|retail sales|pmi|industrial production|wages|average hourly earnings|consumer confidence|housing starts|building permits|interest rate decision|policy rate|trade balance/.test(title)) {
    higherIsPositive = true;
  }

  // Inflation releases can trigger different central-bank and risk reactions;
  // do not assign a mechanical currency direction to them.
  if (higherIsPositive === null) return null;
  const higherActual = actual > forecast;
  const currencyStronger = higherActual === higherIsPositive;
  return {
    currencyStronger,
    surprise: higherActual ? "Actual was above forecast" : "Actual was below forecast",
    actual,
    forecast
  };
}

function analyseNews(symbol, candles) {
  const calendarFresh = tradingState.newsLoadedAt > 0 &&
    Date.now() - tradingState.newsLoadedAt <= 15 * 60 * 1000 &&
    !tradingState.newsError && !tradingState.newsLoading;
  if (!calendarFresh) {
    return {
      ready: true, strategy: "news", trend: "Calendar unavailable or stale",
      structure: "Not evaluated", liquidity: "Not used by news engine",
      signal: "WAIT — fresh calendar required",
      reasoning: "WAIT: News Trading requires a successful calendar refresh within 15 minutes. No news signal is permitted from stale or failed calendar data.",
      checks: [["Fresh economic calendar", false]], entry: null, sl: null, tp: null,
      invalidation: null, supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }
  const pair = getForexPairCurrencies(symbol);
  if (!pair) {
    return {
      ready: true, strategy: "news", trend: "Forex pair required",
      structure: "News strategy only analyses Forex pairs",
      liquidity: "Not used by news engine",
      signal: "WAIT — select a Forex pair",
      reasoning: "WAIT: this instrument is not a supported major-currency Forex pair. News Trading does not apply economic-calendar bias to synthetic indices, metals or other markets.",
      checks: [["Forex pair selected", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  if (!Array.isArray(candles) || candles.length < 10) {
    return {
      ready: true, strategy: "news", trend: "Waiting for price data",
      structure: "Waiting", liquidity: "Waiting",
      signal: "WAIT — price candles not ready",
      reasoning: "WAIT: the pair is recognised as Forex, but the scanner needs at least 10 candles to check the market reaction after a release.",
      checks: [["Forex pair identified", true], ["Price reaction data", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  const now = Date.now();
  const nowSeconds = Math.floor(now / 1000);
  const selectedTimeframe = valueOf("timeframe") || "1m";
  const candleSeconds = GRANULARITY[selectedTimeframe] || 60;
  const preReleaseBlackoutMs = 30 * 60 * 1000;
  const recentEvents = tradingState.newsEvents
    .filter(event => {
      const currency = String(event.currency || "").toUpperCase();
      const age = now - Number(event.ts) * 1000;
      return (currency === pair.base || currency === pair.quote) &&
        Number.isFinite(Number(event.ts)) &&
        age >= 0 && age <= 2 * 60 * 60 * 1000 &&
        event.actual && event.forecast;
    })
    .sort((a, b) => Number(b.ts) - Number(a.ts));

  const upcoming = tradingState.newsEvents
    .filter(event => {
      const currency = String(event.currency || "").toUpperCase();
      const eventTime = Number(event.ts);
      const impact = String(event.impact || "").toLowerCase();
      return (currency === pair.base || currency === pair.quote) &&
        Number.isFinite(eventTime) && eventTime * 1000 >= now &&
        (impact === "high" || impact === "medium");
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts))[0];

  // Do not open a news trade shortly before a matching high/medium-impact
  // release, even if another event has already produced a recent signal.
  if (upcoming && Number(upcoming.ts) * 1000 - now <= preReleaseBlackoutMs) {
    const minutesUntil = Math.max(0, Math.ceil((Number(upcoming.ts) * 1000 - now) / 60000));
    return {
      ready: true, strategy: "news", trend: "Upcoming high-impact event blackout",
      structure: "Entry blocked before scheduled release",
      liquidity: "Not used by news engine",
      signal: "WAIT — upcoming news blackout",
      reasoning: `WAIT on ${pair.pair}: ${upcoming.currency} ${upcoming.title} (${String(upcoming.impact).toUpperCase()}) is scheduled in approximately ${minutesUntil} minute(s). News entries are blocked during the 30-minute pre-release safety window.`,
      checks: [["Forex pair identified", true], ["30-minute pre-release blackout clear", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  const last = candles[candles.length - 1];

  if (!recentEvents.length) {
    const nextText = upcoming
      ? `Next matching event: ${upcoming.currency} ${upcoming.title} (${String(upcoming.impact).toUpperCase()}) at ${new Date(Number(upcoming.ts) * 1000).toLocaleString()}.`
      : "No matching recent release with actual and forecast values is available.";
    return {
      ready: true, strategy: "news", trend: "Waiting for a confirmed news release",
      structure: "Price reaction not evaluated",
      liquidity: "Not used by news engine",
      signal: "WAIT — no completed matching event",
      reasoning: `WAIT on ${pair.pair}: ${nextText} The bot does not guess the direction before the release and confirmed price reaction.`,
      checks: [["Forex pair identified", true], ["Recent matching event with actual and forecast", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  const event = recentEvents[0];
  const bias = getNewsCurrencyBias(event);
  const eventAgeMinutes = Math.round((now - Number(event.ts) * 1000) / 60000);
  const sourceConfidence = event.confidence || "not supplied";
  const eventSummary = `${event.currency} ${event.title} (${event.impact} impact), ${eventAgeMinutes} minutes ago. Actual: ${event.actual}; forecast: ${event.forecast}.`;
  const postReleaseCandles = candles.filter(c => {
    const candleOpen = Number(c.epoch);
    return Number.isFinite(candleOpen) &&
      candleOpen >= Number(event.ts) &&
      candleOpen + candleSeconds <= nowSeconds;
  }).slice(-4);

  if (postReleaseCandles.length < 3) {
    return {
      ready: true, strategy: "news", trend: "Waiting for post-release candles",
      structure: "Not enough candles formed after this release",
      liquidity: "Not used by news engine",
      signal: "WAIT — need post-news price confirmation",
      reasoning: `WAIT on ${pair.pair}: ${eventSummary} The scanner has only ${postReleaseCandles.length} usable candle(s) formed after the release. It will not mistake pre-news movement for a reaction. Waiting for at least three post-release candles.`,
      checks: [["Completed matching release", true], ["At least three post-release candles", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  const reactionCandles = postReleaseCandles;
  const reactionLast = reactionCandles[reactionCandles.length - 1];
  const reactionFirst = reactionCandles[0];
  const reactionBullish = reactionCandles.filter(c => c.close > c.open).length;
  const reactionBearish = reactionCandles.filter(c => c.close < c.open).length;
  const reactionMomentum = reactionLast.close > reactionFirst.open && reactionBullish >= 3
    ? "bullish"
    : reactionLast.close < reactionFirst.open && reactionBearish >= 3
      ? "bearish"
      : "mixed";

  if (event.status === "tentative" || sourceConfidence === "sources_disagree") {
    return {
      ready: true, strategy: "news", trend: "Event timing is uncertain",
      structure: "Not confirmed", liquidity: "Not used by news engine",
      signal: "WAIT — calendar event is tentative",
      reasoning: `WAIT on ${pair.pair}: ${eventSummary} The calendar marks this event as tentative or its sources disagree, so the bot will not form a news direction from it.`,
      checks: [["Event timing confidence", false]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  if (!bias) {
    return {
      ready: true, strategy: "news", trend: "News surprise is not classifiable",
      structure: "Price reaction alone is insufficient",
      liquidity: "Not used by news engine",
      signal: "WAIT — no reliable directional surprise",
      reasoning: `WAIT on ${pair.pair}: ${eventSummary} The event type or numeric forecast comparison does not support a reliable currency-strength interpretation. Post-release price momentum is ${reactionMomentum}, but price movement alone is not enough to call a news trade.`,
      checks: [["Actual versus forecast", false], ["Post-release price reaction", reactionMomentum !== "mixed"]],
      entry: null, sl: null, tp: null, invalidation: null,
      supply: null, demand: null, breaker: "Not used by News Trading",
      orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
    };
  }

  const pairDirection = event.currency === pair.base
    ? (bias.currencyStronger ? "bullish" : "bearish")
    : (bias.currencyStronger ? "bearish" : "bullish");
  const confirmed = reactionMomentum === pairDirection;
  const direction = pairDirection === "bullish" ? "BUY" : "SELL";
  const signal = confirmed
    ? `Potential News ${direction} — price confirms the news bias`
    : "WAIT — price has not confirmed the news bias";
  const reasoning = confirmed
    ? `${direction} candidate on ${pair.pair}: ${eventSummary} ${bias.surprise}, which the event classifier interprets as ${bias.currencyStronger ? "stronger" : "weaker"} ${event.currency}. Because ${event.currency} is the ${event.currency === pair.base ? "base" : "quote"} currency, the expected pair bias is ${pairDirection}. The post-release candles show ${reactionMomentum} momentum, agreeing with that bias. This is a demo analysis candidate, not an executed order.`
    : `WAIT on ${pair.pair}: ${eventSummary} ${bias.surprise}, interpreted as ${bias.currencyStronger ? "stronger" : "weaker"} ${event.currency}; this implies a ${pairDirection} pair bias. However, the post-release candles show ${reactionMomentum} momentum, so price has not confirmed the news direction. No trade candidate is issued.`;

  const recentLows = candles.slice(-5).map(c => c.low);
  const recentHighs = candles.slice(-5).map(c => c.high);
  const entry = confirmed ? last.close : null;
  const sl = confirmed
    ? (pairDirection === "bullish" ? Math.min(...recentLows) : Math.max(...recentHighs))
    : null;
  const risk = sl === null ? null : Math.abs(entry - sl);
  const tp = risk && Number.isFinite(risk)
    ? (pairDirection === "bullish" ? entry + 2 * risk : entry - 2 * risk)
    : null;

  return {
    ready: true, strategy: "news",
    trend: pairDirection === "bullish" ? "News bias bullish" : "News bias bearish",
    structure: `Post-release price momentum: ${reactionMomentum}`,
    liquidity: "News event and price reaction",
    signal, reasoning, entry, sl, tp, invalidation: sl,
    checks: [
      ["Forex pair and event currency match", true],
      ["Actual versus forecast gives a directional surprise", true],
      ["Event timing is sufficiently confirmed", true],
      ["Post-release price momentum agrees", confirmed]
    ],
    supply: null, demand: null, breaker: "Not used by News Trading",
    orderBlock: null, displacement: false, structureDetails: {}, fvgDetails: {}
  };
}

function renderTimeframeAnalysis(symbol, timeframe) {
  const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const higherCandles = tradingState.candles[candleKey(symbol, frames[frames.length - 1])] || [];
  const lowerCandles = tradingState.candles[candleKey(symbol, frames[0])] || [];
  const selectedEntryTimeframe = valueOf("timeframe") || frames[0];
  const box = $("timeframeResults");
  if (!box) return;
  if (box.textContent.trim() === "No timeframe analysis available.") {
    box.replaceChildren();
  }
  const analyses = tradingState.strategy === "both"
    ? [
        ...(timeframe === "1m" ? [analyseAPATopDown(symbol)] : []),
        analyseSMC(candles)
      ]
    : [tradingState.strategy === "news"
        ? analyseNews(symbol, candles)
        : tradingState.strategy === "apa"
          ? (timeframe === "1m" ? analyseAPATopDown(symbol) : { ready: false, strategy: "apa", trend: "Top-down APA context timeframe", structure: "Entry trigger is evaluated on M1", signal: "APA context loaded — waiting for final M1 entry analysis", supply: null, demand: null })
          : analyseSMC(candles)];
  const zoneText = zone => zone ? formatPrice(zone.low) + "–" + formatPrice(zone.high) : "not identified";
  const priceText = price => price == null || !Number.isFinite(Number(price)) ? "--" : formatPrice(Number(price));
  analyses.forEach(result => {
    if (!result) return;
    if (result.ready) {
      evaluateSignalHistory(symbol, timeframe, candles);
      recordCandidateSignal(symbol, timeframe, result, candles);
    }
    const strategyName = result.strategy || tradingState.strategy;
    const resultKey = symbol + "|" + timeframe + "|" + strategyName;
    let item = Array.from(box.children).find(child => child.dataset && child.dataset.resultKey === resultKey);
    if (!item) { item = document.createElement("div"); item.className = "result-item"; item.dataset.resultKey = resultKey; }
    const isSmc = strategyName === "smc";
    const structure = result.structureDetails || {};
    const fvg = result.fvgDetails || {};
    const structureFlags = [
      structure.bosUp ? "Bullish BOS" : "",
      structure.bosDown ? "Bearish BOS" : "",
      structure.mssUp ? "Bullish MSS" : "",
      structure.mssDown ? "Bearish MSS" : "",
      structure.chochUp ? "Bullish CHoCH" : "",
      structure.chochDown ? "Bearish CHoCH" : ""
    ].filter(Boolean);
    const imbalanceFlags = [
      fvg.bullishFVG ? "Bullish FVG" : "",
      fvg.bearishFVG ? "Bearish FVG" : "",
      fvg.bullishIFVG ? "Bullish IFVG" : "",
      fvg.bearishIFVG ? "Bearish IFVG" : ""
    ].filter(Boolean);
    const details = isSmc
      ? [
          "Entry " + priceText(result.entry) + " | SL " + priceText(result.sl) + " | TP " + priceText(result.tp),
          "SL logic: " + (result.slReason || "structure invalidation"),
          "TP logic: " + (result.tpReason || "opposing liquidity target") +
            (Number.isFinite(result.riskReward) ? " | R:R " + result.riskReward.toFixed(2) + ":1" : ""),
          "Structure detections: " + (structureFlags.join(", ") || result.structure || "none confirmed"),
          "Liquidity: " + (result.liquidity || "waiting"),
          "Displacement: " + (result.displacement ? "detected" : "not detected"),
          "Imbalances: " + (imbalanceFlags.join(", ") || "none confirmed"),
          "Supply " + zoneText(result.supply) + " | Demand " + zoneText(result.demand),
          "Order Block " + zoneText(result.orderBlock) + " | Breaker " + (result.breaker || "not identified"),
          "Confirmations BUY " + (result.bullishConfirmations || 0) + " / SELL " + (result.bearishConfirmations || 0),
          result.reasoning || ""
        ].filter(Boolean).join("\n")
      : strategyName === "apa"
        ? [
            "Entry " + priceText(result.entry) + " | SL " + priceText(result.sl) + " | TP " + priceText(result.tp),
            "Supply " + zoneText(result.supply) + " | Demand " + zoneText(result.demand) + " | POI " + zoneText(result.orderBlock)
          ].join("\n")
        : (result.reasoning || "News analysis");
    item.textContent = symbol + " " + timeframe.toUpperCase() + " — " + strategyName.toUpperCase() +
      "\nTrend: " + (result.trend || "Waiting") +
      "\nDecision: " + (result.signal || "Waiting for confirmation") +
      "\n" + details;
    if (item.parentNode !== box) box.prepend(item);
  });
  renderSMCMultiTimeframeAlignment(symbol);
  while (box.children.length > 60) box.removeChild(box.lastChild);
}

function renderSMCMultiTimeframeAlignment(symbol) {
  const box = $("timeframeResults");
  if (!box) return;

  const existing = Array.from(box.children).find(child =>
    child.dataset && child.dataset.resultKey === symbol + "|SMC|ALIGNMENT"
  );
  if (tradingState.strategy !== "smc" && tradingState.strategy !== "both") {
    if (existing) existing.remove();
    return;
  }

  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const results = frames.map(timeframe => {
    const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
    if (candles.length < 20) return { timeframe, status: "waiting", signal: "WAIT" };
    const analysis = analyseSMC(candles);
    const signal = String(analysis.signal || "");
    const direction = /\bBUY\b/i.test(signal) ? "BUY" :
      /\bSELL\b/i.test(signal) ? "SELL" : "";
    return {
      timeframe,
      status: analysis.ready ? "ready" : "waiting",
      direction,
      signal,
      entry: analysis.entry,
      sl: analysis.sl,
      tp: analysis.tp
    };
  });

  const buys = results.filter(item => item.direction === "BUY");
  const sells = results.filter(item => item.direction === "SELL");
  const waiting = results.filter(item => item.status !== "ready" || !item.direction);
  let verdict = "No multi-timeframe setup yet — wait for confirmed SMC signals.";
  if (buys.length && sells.length) {
    verdict = "CONFLICT — BUY and SELL candidates disagree across timeframes. WAIT; do not treat either side as aligned.";
  } else if (buys.length >= 2) {
    verdict = "BULLISH ALIGNMENT — " + buys.length + " of " + frames.length + " timeframes show BUY candidates. Review each timeframe's own Entry, SL and TP.";
  } else if (sells.length >= 2) {
    verdict = "BEARISH ALIGNMENT — " + sells.length + " of " + frames.length + " timeframes show SELL candidates. Review each timeframe's own Entry, SL and TP.";
  } else if (buys.length === 1) {
    verdict = "SINGLE BUY CANDIDATE — not yet confirmed by another timeframe.";
  } else if (sells.length === 1) {
    verdict = "SINGLE SELL CANDIDATE — not yet confirmed by another timeframe.";
  }

  const priceText = price => price == null || !Number.isFinite(Number(price)) ? "--" : formatPrice(Number(price));
  const frameLines = results.map(item => {
    const side = item.direction || (item.status === "ready" ? "WAIT" : "WAITING FOR DATA");
    return item.timeframe.toUpperCase() + ": " + side +
      (item.direction ? " | Entry " + priceText(item.entry) + " | SL " + priceText(item.sl) + " | TP " + priceText(item.tp) : "");
  });
  const summary = existing || document.createElement("div");
  summary.className = "result-item";
  summary.dataset.resultKey = symbol + "|SMC|ALIGNMENT";
  summary.textContent = symbol + " — SMC MULTI-TIMEFRAME CHECK\n" +
    verdict + "\n" +
    "BUY candidates: " + buys.map(item => item.timeframe.toUpperCase()).join(", ") .replace(/^$/, "none") +
    " | SELL candidates: " + sells.map(item => item.timeframe.toUpperCase()).join(", ").replace(/^$/, "none") +
    " | Waiting: " + waiting.length + "\n" + frameLines.join("\n") +
    "\nAlignment is a confirmation aid only. Each timeframe keeps its own signal and trade levels; no order is placed.";
  if (summary.parentNode !== box) box.prepend(summary);
}

function renderDashboardStrategyResults(symbol, timeframe, results) {
  const panel = $("dashboardStrategyResults");
  if (!panel) return;
  const active = tradingState.strategy;
  panel.classList.toggle("hidden", active === "news");

  const engines = [
    { key: "apa", id: "dashboardApaResult", title: "APA — Advanced Price Action" },
    { key: "smc", id: "dashboardSmcResult", title: "SMC — Smart Money Concepts" }
  ];

  engines.forEach((engine, index) => {
    const output = $(engine.id);
    if (!output) return;
    const card = output.closest(".analysis-engine-card");
    if (card) card.classList.toggle("hidden", active !== "both" && active !== engine.key);

    const result = results.find(item => item && item.strategy === engine.key) ||
      (active === "both" ? results[index] : active === engine.key ? results[0] : null);
    if (!result) {
      output.textContent = "Waiting for " + engine.key.toUpperCase() + " analysis.";
      return;
    }

    const heading = symbol + " | " + String(timeframe).toUpperCase();
    if (!result.ready) {
      output.textContent = heading + "\\nStatus: " +
        (result.signal || result.trend || "Waiting for required candles") +
        "\\nThis engine has not produced a confirmed analysis yet.";
      return;
    }

    output.textContent = heading +
      "\\nTrend: " + (result.trend || "Not available") +
      "\\nStructure: " + (result.structure || "Not available") +
      "\\nDecision: " + (result.signal || "WAIT") +
      "\\nEntry: " + formatPrice(result.entry) +
      " | SL: " + formatPrice(result.sl) +
      " | TP: " + formatPrice(result.tp) +
      "\\nReason: " + (result.reasoning || "No additional reasoning available.");
  });
}

function analyseMainSelection(symbol) {
  const timeframe = valueOf("timeframe") || "1m";
  const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const higherFrame = frames[frames.length - 1];
  const lowerFrame = frames[0];
  const higherCandles = tradingState.candles[candleKey(symbol, higherFrame)] || [];
  const lowerCandles = tradingState.candles[candleKey(symbol, lowerFrame)] || [];
  const selectedEntryTimeframe = valueOf("timeframe") || frames[0];
  const analysisResults = tradingState.strategy === "both"
    ? [analyseAPATopDown(symbol), analyseSMC(candles)]
    : [tradingState.strategy === "news"
        ? analyseNews(symbol, candles)
        : tradingState.strategy === "apa"
          ? analyseAPATopDown(symbol)
          : analyseSMC(candles)];
  renderDashboardStrategyResults(symbol, timeframe, analysisResults);
  const readyResults = analysisResults.filter(item => item && item.ready);
  const result = readyResults.find(item => item.strategy === "apa") ||
    readyResults.find(item => item.strategy === "smc") || readyResults[0] || analysisResults[0];

  // History outcome tracking must run even when there is no fresh signal.
  evaluateSignalHistory(symbol, timeframe, candles);
  tradingState.lastAnalysedSymbol = symbol;
  if (!result || !result.ready) return;
  const newsActive = result.strategy === "news";
  $("newsTradingPanel")?.classList.toggle("news-active", newsActive);
  if (newsActive) {
    setText("newsPairStatus", getForexPairCurrencies(symbol)?.pair || "Not a supported Forex pair");
    setText("newsSignal", result.signal);
    setText("newsReasoning", result.reasoning || "Waiting for news analysis.");
  }

  setText("marketTrend", result.trend);
  setText("apaStructure", result.structure);
  setText("liquidityStatus", result.liquidity);
  setText("apaSweepStatus", result.sweepStatus ? `${result.sweepStatus} — ${result.sweepDirection}` : "APA sweep status not available");
  setText("apaSweepPrice", result.sweepPrice == null ? "--" : formatPrice(result.sweepPrice));
  setText("apaSweepLevel", result.sweepLevel == null ? "--" : formatPrice(result.sweepLevel));
  setText("entrySignal", tradingState.strategy === "both"
    ? readyResults.map(item => item.strategy.toUpperCase() + ": " + item.signal).join(" | ")
    : result.signal);
  setText("tradeReasoning", tradingState.strategy === "both"
    ? (readyResults.length
        ? readyResults.map(item => item.strategy.toUpperCase() + ": " + (item.reasoning || item.signal)).join("\n\n")
        : "APA and SMC are waiting for separate confirmations.")
    : (result.reasoning || "Reasoning is not available for this analysis."));
  setText("supplyZone", formatZone(result.supply));
  setText("demandZone", formatZone(result.demand));
  setText("breakerBlock", result.breaker);
  const structureState = result.structureDetails || {};
  const fvgState = result.fvgDetails || {};
  const showDirection = (up, down) => up ? "Bullish detected" : down ? "Bearish detected" : "Not detected";
  setText("bosStatus", showDirection(structureState.bosUp, structureState.bosDown));
  setText("mssStatus", showDirection(structureState.mssUp, structureState.mssDown));
  setText("chochStatus", showDirection(structureState.chochUp, structureState.chochDown));
  setText("fvgStatus", showDirection(fvgState.bullishFVG, fvgState.bearishFVG));
  setText("ifvgStatus", showDirection(fvgState.bullishIFVG, fvgState.bearishIFVG));
  setText("displacementStatus", result.displacement ? "Detected" : "Not detected");
  setText("orderBlockStatus", result.orderBlock ? formatZone(result.orderBlock) : "Not identified");
  setText("supplyDemandStatus",
    result.demandSupport ? "Price in / near demand" :
    result.supplyResistance ? "Price in / near supply" : "Zones identified — waiting for price interaction");

  const scalpDisplay = tradingState.mode === "scalping";
  const slRow = $("signalSLRow");
  const tpRow = $("signalTPRow");
  if (slRow) slRow.hidden = scalpDisplay;
  if (tpRow) tpRow.hidden = scalpDisplay;
  setText("signalEntry", formatPrice(result.entry));
  setText("signalSL", scalpDisplay ? "Not used in Scalping" : formatPrice(result.sl));
  setText("signalTP", scalpDisplay ? "Not used in Scalping" : formatPrice(result.tp));
  setText("signalInvalidation", scalpDisplay ? "Not used in Scalping" : formatPrice(result.invalidation));

  const checklist = $("strategyChecklist");
  if (checklist) {
    checklist.replaceChildren();

    (tradingState.strategy === "both" ? readyResults : [result]).forEach(item => {
      (item.checks || []).forEach(([name, passed]) => {
        const row = document.createElement("div");
        row.className = "result-item";
        row.textContent = item.strategy.toUpperCase() + " — " + (passed ? "✓ " : "○ ") + name;
        checklist.appendChild(row);
      });
    });
  }
  tradingState.lastSignals[symbol] = result;
  (tradingState.strategy === "both" ? readyResults : [result])
    .forEach(item => recordCandidateSignal(symbol, item.strategy === "apa" ? "1m" : timeframe, item, item.strategy === "apa" ? (tradingState.candles[candleKey(symbol, "1m")] || []) : candles));
}

/* =========================================================
   SIGNAL HISTORY — DEMO ANALYSIS ONLY
   Records candidate signals and checks later candles for SL/TP.
   This does not place or manage broker orders.
========================================================= */
function loadSignalHistory() {
  try {
    const saved = JSON.parse(localStorage.getItem(SIGNAL_HISTORY_KEY) || "[]");
    tradingState.signalHistory = Array.isArray(saved) ? saved.slice(0, 200) : [];
  } catch {
    tradingState.signalHistory = [];
  }
  renderSignalHistory();
}

function saveSignalHistory() {
  try {
    tradingState.signalHistory = tradingState.signalHistory.slice(0, 200);
    localStorage.setItem(SIGNAL_HISTORY_KEY, JSON.stringify(tradingState.signalHistory));
  } catch (error) {
    addResult("Signal history could not be saved on this device: " + error.message, "tradeHistory");
  }
  renderSignalHistory();
}

function renderDemoPositions() {
  const box = $("positionsList");
  if (!box) return;
  box.replaceChildren();
  const open = tradingState.signalHistory.filter(record => record.status === "OPEN");
  const limit = Math.max(1, Math.min(20, Number(valueOf("maxTrades")) || 2));
  const summary = document.createElement("p");
  summary.className = "muted";
  summary.textContent = `Demo entries: ${open.length} open / ${limit} maximum. Simulated only — no broker orders are placed.`;
  box.appendChild(summary);
  if (!open.length) {
    const empty = document.createElement("p");
    empty.textContent = "No open demo entries. The scanner will add valid BUY/SELL setups.";
    box.appendChild(empty);
    return;
  }
  open.slice().sort((a,b)=>(Number(b.opportunityRank)||0)-(Number(a.opportunityRank)||0)).slice(0, 20).forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "result-item";
    const legacySmcScalp = record.strategy === "smc" && record.mode === "scalping";
    const details = legacySmcScalp
      ? `Entry ${formatPrice(record.entry)} | SL/TP not recorded\nStatus: LEGACY SMC entry saved under the old scalp exit rules.`
      : record.mode === "scalping"
        ? `Entry ${formatPrice(record.entry)} | SL not used | TP not used\nStatus: OPEN — basket closes at first positive simulated price move.`
        : `Entry ${formatPrice(record.entry)} | SL ${formatPrice(record.sl)} | TP ${formatPrice(record.tp)}\nStatus: OPEN — waiting for individual TP or SL`;
    row.textContent =
      `Entry ${index + 1} | ${record.symbol} | ${record.direction} | ${String(record.strategy || "APA").toUpperCase()} ${String(record.timeframe || "").toUpperCase()}\n` +
      details+"\nOpportunity rank: "+(Number.isFinite(Number(record.opportunityRank))?record.opportunityRank+"/100":"not scored");
    box.appendChild(row);
  });
}

function renderScalpActivity() {
  const box = $("scalpActivity");
  if (!box) return;
  box.replaceChildren();
  const records = tradingState.signalHistory
    .filter(record => record.mode === "scalping" && record.strategy !== "smc")
    .slice(0, 30);
  const observations = tradingState.scalpObservations || [];
  if (!records.length && !observations.length) {
    box.textContent = tradingState.running
      ? "Scanner is running. Waiting for the first completed market analysis..."
      : "No scalp activity yet. Start the scanner in Scalping mode.";
    return;
  }
  if (records.length) {
    const heading = document.createElement("p");
    heading.className = "muted";
    heading.textContent = "CONFIRMED BUY/SELL scalp signals — simulated only, not broker orders.";
    box.appendChild(heading);
  }
  records.forEach((record, index) => {
    const row = document.createElement("div");
    row.className = "result-item";
    const current = Number(tradingState.lastPrices[record.symbol]);
    const move = Number.isFinite(current)
      ? (record.direction === "BUY" ? current - Number(record.entry) : Number(record.entry) - current)
      : null;
    const status = record.status === "OPEN"
      ? (move == null ? "OPEN — waiting for live quote" : `OPEN — price move ${move >= 0 ? "+" : ""}${formatPrice(Math.abs(move))}`)
      : `${record.status}${record.exitPrice != null ? " | Exit " + formatPrice(record.exitPrice) : ""}`;
    row.textContent =
      `${index + 1}. ${record.symbol} | ${record.direction} | ${String(record.strategy || "APA").toUpperCase()} | ${String(record.timeframe || "").toUpperCase()}\\n` +
      `Entry ${formatPrice(record.entry)} | ${new Date(record.createdAt).toLocaleTimeString()}\\n` +
      status;
    box.appendChild(row);
  });

  if (observations.length) {
    const heading = document.createElement("p");
    heading.className = "muted";
    heading.textContent = "LIVE SCANNER CHECKS — WAIT means no entry was opened.";
    box.appendChild(heading);
    observations.forEach(item => {
      const row = document.createElement("div");
      row.className = "result-item";
      row.textContent =
        `CHECK ${item.symbol} | ${item.timeframe.toUpperCase()} | ${item.signal}\\n` +
        `Trend: ${item.trend || "not available"} | Checked: ${new Date(item.checkedAt).toLocaleTimeString()}`;
      box.appendChild(row);
    });
  }
}

function summarizeDemoLedger(records) {
  const summary = { total: 0, open: 0, wins: 0, losses: 0, review: 0, otherClosed: 0, plannedRRTotal: 0, plannedRRCount: 0, groups: {} };
  (Array.isArray(records) ? records : []).forEach(record => {
    if (!record || !record.status) return;
    summary.total++;
    const status = String(record.status).toUpperCase();
    if (status === "OPEN") summary.open++;
    else if (status === "TP HIT") summary.wins++;
    else if (status === "SL HIT") summary.losses++;
    else if (status.startsWith("REVIEW")) summary.review++;
    else summary.otherClosed++;
    const strategy = String(record.strategy || "APA").toLowerCase();
    const timeframe = String(record.timeframe || "unknown").toLowerCase();
    const key = strategy + "|" + timeframe;
    if (!summary.groups[key]) summary.groups[key] = { strategy, timeframe, total: 0, open: 0, wins: 0, losses: 0, review: 0, otherClosed: 0, plannedRRTotal: 0, plannedRRCount: 0 };
    const group = summary.groups[key];
    group.total++;
    if (status === "OPEN") group.open++;
    else if (status === "TP HIT") group.wins++;
    else if (status === "SL HIT") group.losses++;
    else if (status.startsWith("REVIEW")) group.review++;
    else group.otherClosed++;
    const rr = Number(record.riskReward ?? record.plannedRR);
    if (Number.isFinite(rr) && rr > 0 && record.mode !== "scalping" && status !== "OPEN") {
      group.plannedRRTotal += rr; group.plannedRRCount++;
      summary.plannedRRTotal += rr; summary.plannedRRCount++;
    }
  });
  summary.averagePlannedRR = summary.plannedRRCount ? summary.plannedRRTotal / summary.plannedRRCount : null;
  Object.values(summary.groups).forEach(group => { group.averagePlannedRR = group.plannedRRCount ? group.plannedRRTotal / group.plannedRRCount : null; });
  return summary;
}

function calculateDemoRiskGuard(records, settings = {}) {
 const history=Array.isArray(records)?records:[];
 const riskPct=Math.max(0.01,Number(settings.riskPercent ?? valueOf("riskPercent"))||0.5);
 const dailyLimitPct=Math.max(0.01,Number(settings.dailyLossLimit ?? valueOf("dailyLossLimit"))||2);
 const maxConsecutive=Math.max(1,Number(settings.maxConsecutiveLosses ?? valueOf("maxConsecutiveLosses"))||3);
 const limitR=dailyLimitPct/riskPct;
 let persisted=null;try{persisted=JSON.parse(localStorage.getItem(DEMO_RISK_LOCK_KEY)||"null");}catch{}
 const resetAt=persisted&&!persisted.locked?Number(persisted.resetAt||0):0;
 const sessionHistory=resetAt?history.filter(r=>Number(r.closedAt||r.createdAt||0)>resetAt):history;
 const dayStart=new Date();dayStart.setHours(0,0,0,0);
 const daily=sessionHistory.filter(r=>r&&r.mode!=="scalping"&&(r.status==="TP HIT"||r.status==="SL HIT")&&Number(r.closedAt||0)>=Math.max(dayStart.getTime(),resetAt));
 const dailyNetR=daily.reduce((sum,r)=>sum+(r.status==="TP HIT"?Math.max(0,Number(r.riskReward??r.plannedRR)||0):-1),0);
 const closed=sessionHistory.filter(r=>r&&r.mode!=="scalping"&&(r.status==="TP HIT"||r.status==="SL HIT")).sort((a,b)=>Number(a.closedAt||a.createdAt||0)-Number(b.closedAt||b.createdAt||0));
 let consecutiveLosses=0;for(let i=closed.length-1;i>=0;i--){if(closed[i].status==="SL HIT")consecutiveLosses++;else break;}
 const eq=calculateDemoEquity(sessionHistory);const reasons=[];
 if(dailyNetR<=-limitR)reasons.push("Daily loss limit reached");
 if(consecutiveLosses>=maxConsecutive)reasons.push("Consecutive-loss limit reached");
 if(eq.maxDrawdownR>=limitR)reasons.push("Maximum drawdown limit reached");
 if(reasons.length){const lock={locked:true,lockReasons:Array.from(new Set([...(persisted?.lockReasons||[]),...reasons])),lockedAt:persisted?.lockedAt||Date.now(),source:"risk-calculation"};try{localStorage.setItem(DEMO_RISK_LOCK_KEY,JSON.stringify(lock));}catch{}}
 const activeLock=reasons.length?{locked:true,lockReasons:Array.from(new Set([...(persisted?.lockReasons||[]),...reasons])),lockedAt:persisted?.lockedAt||Date.now()}:persisted?.locked?persisted:null;
 return {locked:Boolean(activeLock),lockReasons:activeLock?.lockReasons||[],lockedAt:activeLock?.lockedAt||null,resetAt,dailyNetR,dailyLimitR:limitR,consecutiveLosses,maxConsecutiveLosses:maxConsecutive,maxDrawdownR:eq.maxDrawdownR,maxDrawdownLimitR:limitR};
}


function calculateDemoEquity(records) {
  const closed = (Array.isArray(records) ? records : []).filter(record => record && record.status !== "OPEN" && !String(record.status).toUpperCase().startsWith("REVIEW") && record.mode !== "scalping" && (record.status === "TP HIT" || record.status === "SL HIT"));
  closed.sort((a,b) => Number(a.closedAt || a.createdAt || 0) - Number(b.closedAt || b.createdAt || 0));
  let equityR = 0, peakR = 0, maxDrawdownR = 0;
  const points = [];
  closed.forEach(record => {
    const planned = Number(record.riskReward ?? record.plannedRR);
    const outcomeR = record.status === "TP HIT" && Number.isFinite(planned) && planned > 0 ? planned : -1;
    equityR += outcomeR;
    peakR = Math.max(peakR, equityR);
    maxDrawdownR = Math.max(maxDrawdownR, peakR - equityR);
    points.push({ id: record.id || String(record.closedAt || record.createdAt || points.length), strategy: String(record.strategy || "APA"), timeframe: String(record.timeframe || "unknown"), status: record.status, outcomeR, equityR, drawdownR: peakR-equityR });
  });
  return { closedTrades: closed.length, netR: equityR, maxDrawdownR, points };
}

function renderDemoRiskStatus() {
 const target=$("tradeHistory");if(!target)return;
 const guard=calculateDemoRiskGuard(tradingState.signalHistory,tradingState.settings);
 const row=document.createElement("div");row.className="result-item";
 row.textContent=guard.locked?"DEMO RISK PAUSED | "+guard.lockReasons.join("; ")+" | Locked since "+new Date(guard.lockedAt||Date.now()).toLocaleString():"Demo risk guard | Daily net "+guard.dailyNetR.toFixed(2)+"R | Consecutive losses "+guard.consecutiveLosses+"/"+guard.maxConsecutiveLosses+" | Max drawdown "+guard.maxDrawdownR.toFixed(2)+"R";
 target.appendChild(row);
 const reset=document.createElement("button");reset.type="button";reset.textContent="Reset demo risk lock (manual)";reset.disabled=!guard.locked;reset.addEventListener("click",()=>{try{localStorage.setItem(DEMO_RISK_LOCK_KEY,JSON.stringify({locked:false,resetAt:Date.now(),source:"manual-reset"}));}catch{}const current=calculateDemoRiskGuard(tradingState.signalHistory,tradingState.settings);addResult(current.locked?"Risk lock reset attempted, but current limits are still breached: "+current.lockReasons.join("; "):"Demo risk lock manually reset. Historical trades remain unchanged.","tradeHistory");renderSignalHistory();});
 target.appendChild(reset);
}

function renderSignalHistory() {
  renderDemoPositions();
  renderScalpActivity();
  const box = $("tradeHistory");
  if (!box) return;
  box.replaceChildren();
  const summary = summarizeDemoLedger(tradingState.signalHistory);
  const summaryRow = document.createElement("div");
  summaryRow.className = "result-item";
  summaryRow.textContent = `Demo ledger | Total ${summary.total} | Open ${summary.open} | Wins ${summary.wins} | Losses ${summary.losses} | Review ${summary.review} | Avg planned RR ${summary.averagePlannedRR == null ? "--" : summary.averagePlannedRR.toFixed(2)}`;
  box.appendChild(summaryRow);
  const equity = calculateDemoEquity(tradingState.signalHistory);
  const equityRow = document.createElement("div");
  equityRow.className = "result-item";
  equityRow.textContent = `Demo closed-trade curve | ${equity.closedTrades} eligible closes | Net ${equity.netR >= 0 ? "+" : ""}${equity.netR.toFixed(2)}R | Max drawdown ${equity.maxDrawdownR.toFixed(2)}R`;
  box.appendChild(equityRow);
  renderDemoRiskStatus();
  if (equity.points.length) {
    const curveRow = document.createElement("div");
    curveRow.className = "result-item";
    curveRow.textContent = "Equity R sequence: " + equity.points.map(point => `${point.strategy.toUpperCase()} ${point.timeframe.toUpperCase()} ${point.equityR >= 0 ? "+" : ""}${point.equityR.toFixed(2)}R`).join(" → ");
    box.appendChild(curveRow);
  }
  Object.values(summary.groups).sort((a,b) => a.strategy.localeCompare(b.strategy) || a.timeframe.localeCompare(b.timeframe)).forEach(group => {
    const groupRow = document.createElement("div");
    groupRow.className = "result-item";
    groupRow.textContent = `${group.strategy.toUpperCase()} ${group.timeframe.toUpperCase()} | Total ${group.total} | Open ${group.open} | Wins ${group.wins} | Losses ${group.losses} | Review ${group.review} | Avg planned RR ${group.averagePlannedRR == null ? "--" : group.averagePlannedRR.toFixed(2)}`;
    box.appendChild(groupRow);
  });
  if (!tradingState.signalHistory.length) {
    box.textContent = "No signals recorded yet. Start the scanner to build signal history.";
    return;
  }
  tradingState.signalHistory.slice().sort((a,b) => {
    if(a.status==="OPEN"&&b.status!=="OPEN")return -1;
    if(b.status==="OPEN"&&a.status!=="OPEN")return 1;
    return (Number(b.opportunityRank)||0)-(Number(a.opportunityRank)||0) || Number(b.createdAt)-Number(a.createdAt);
  }).slice(0, 50).forEach(record => {
    const row = document.createElement("div");
    row.className = "result-item";
    const date = new Date(record.createdAt).toLocaleString();
    const legacySmcScalp = record.strategy === "smc" && record.mode === "scalping";
    const outcome = record.status === "OPEN"
      ? (legacySmcScalp
          ? "LEGACY OPEN — saved under old SMC scalp rules; no SL/TP was stored"
          : record.mode === "scalping" ? "WAIT — first positive basket price move (no SL/TP)" : "WAIT — TP/SL not reached yet")
      : record.status;
    const details = legacySmcScalp
      ? `Entry ${formatPrice(record.entry)} | SL/TP not recorded\nResult: ${outcome}`
      : record.mode === "scalping"
        ? `Entry ${formatPrice(record.entry)} | SL not used | TP not used\nResult: ${outcome}`
        : `Entry ${formatPrice(record.entry)} | SL ${formatPrice(record.sl)} | TP ${formatPrice(record.tp)}\nResult: ${outcome}`;
    row.textContent =
      `${date} | ${record.symbol} | ${String(record.strategy || "APA").toUpperCase()} ${String(record.timeframe || "").toUpperCase()} | ${record.direction}\n` +
      details+"\nOpportunity rank: "+(Number.isFinite(Number(record.opportunityRank))?record.opportunityRank+"/100":"not scored");
    box.appendChild(row);
  });
}

function getSignalExpiryBars(timeframe) {
  const limits={"1m":30,"M1":30,"5m":24,"M5":24,"15m":16,"M15":16,
    "30m":12,"M30":12,"1h":10,"H1":10,"4h":8,"H4":8,"1d":5,"D1":5};
  return limits[String(timeframe||"")]||12;
}
function getTimeframeSeconds(timeframe) {
  const values={"1m":60,"M1":60,"5m":300,"M5":300,"15m":900,"M15":900,
    "30m":1800,"M30":1800,"1h":3600,"H1":3600,"4h":14400,"H4":14400,"1d":86400,"D1":86400};
  return values[String(timeframe||"")]||60;
}
function evaluateSignalHistory(symbol, timeframe, candles) {
  if (!Array.isArray(candles) || !candles.length) return;
  let changed = false;

  tradingState.signalHistory.forEach(record => {
    if (record.status !== "OPEN" || record.symbol !== symbol || record.timeframe !== timeframe) return;
    // Scalp baskets follow their separate all-positions-profitable exit rule.
    // Never expire or force-close a scalp basket through this intraday timer.
    if (record.mode === "scalping") return;

    // Recheck every later candle on each OHLC update. Deriv updates the
    // current candle repeatedly, so checking an epoch only once can miss
    // a TP/SL touched later while that same candle is still forming.
    const signalEpoch = Number(record.signalCandleEpoch ?? record.lastCheckedCandleEpoch ?? 0);
    const laterCandles = candles.filter(candle =>
      Number.isFinite(Number(candle.epoch)) && Number(candle.epoch) > signalEpoch
    ).sort((x, y) => Number(x.epoch) - Number(y.epoch));

    for (const candle of laterCandles) {
      const low = Number(candle.low);
      const high = Number(candle.high);
      if (!Number.isFinite(low) || !Number.isFinite(high)) continue;

      const hitSL = record.direction === "BUY"
        ? low <= Number(record.sl)
        : high >= Number(record.sl);
      const hitTP = record.direction === "BUY"
        ? high >= Number(record.tp)
        : low <= Number(record.tp);

      if (hitSL && hitTP) {
        record.status = "REVIEW — SL and TP touched in the same candle";
        record.closedAt = Date.now();
        record.outcomeCandleEpoch = Number(candle.epoch);
        changed = true;
        break;
      } else if (hitSL) {
        record.status = "SL HIT";
        record.closedAt = Date.now();
        record.outcomeCandleEpoch = Number(candle.epoch);
        changed = true;
        break;
      } else if (hitTP) {
        record.status = "TP HIT";
        record.closedAt = Date.now();
        record.outcomeCandleEpoch = Number(candle.epoch);
        changed = true;
        break;
      }
    }
    if (record.status === "OPEN" && laterCandles.length) {
      const lastEpoch=Number(laterCandles[laterCandles.length-1].epoch);
      const expiryEpoch=signalEpoch+getTimeframeSeconds(timeframe)*getSignalExpiryBars(timeframe);
      if (lastEpoch>=expiryEpoch) {
        record.status="REVIEW — signal expired without TP or SL";
        record.closedAt=Date.now();
        record.outcomeCandleEpoch=lastEpoch;
        record.expired=true;
        changed=true;
      }
    }
  });

  if (changed) saveSignalHistory();
}

function buildCandidateSignalKey(symbol,strategy,mode,timeframe,direction,candleEpoch) {
  return [symbol,strategy,mode,timeframe,direction,Number(candleEpoch)||0].join("|");
}
function rankCandidateOpportunity(result) {
  const rawScore=Number(result?.score);
  const score=Number.isFinite(rawScore)?Math.max(0,Math.min(100,rawScore)):0;
  const confirmations=Number.isFinite(Number(result?.count))
    ? Math.max(0,Number(result.count))
    : Object.values(result?.confirmations||{}).filter(Boolean).length;
  const models=Array.isArray(result?.entryModels)?result.entryModels.length:0;
  return {
    score,
    confirmations,
    models,
    rank: Math.round(Math.max(0,Math.min(100,score+Math.min(12,confirmations*2)+Math.min(6,models*2))))
  };
}
function hasOpposingOpenSignal(history,symbol,direction) {
  return (Array.isArray(history)?history:[]).some(record =>
    record && record.status==="OPEN" && record.symbol===symbol &&
    record.direction && record.direction!==direction
  );
}
function recordCandidateSignal(symbol, timeframe, result, candles) {
  if (!result || !result.signal) return;
  // APA is multi-timeframe for context, but only the user's selected timeframe
  // is allowed to create an entry signal or signal-history record.
  if (result.strategy === "apa" && timeframe !== "1m") return;
  const signalText = String(result.signal);
  const direction = /\bBUY\b/i.test(signalText) ? "BUY" :
    /\bSELL\b/i.test(signalText) ? "SELL" : "";

  // Keep a live scan trace even when analysis says WAIT. A WAIT is
  // an observation, never an opened or simulated trade.
  const activeStrategy = result.strategy || tradingState.strategy;
  // APA is Intraday-only. SMC alone owns the Scalping mode.
  if (tradingState.mode === "scalping" && activeStrategy === "apa") return;
  const isScalp = activeStrategy === "smc" && tradingState.mode === "scalping";
  // A scalp candidate must belong to a pair explicitly selected by the user.
  if (isScalp && (!tradingState.selectedSymbols || !tradingState.selectedSymbols.has(symbol))) return;

  if (isScalp) {
    const observation = {
      key: `${symbol}|${timeframe}`,
      symbol,
      timeframe,
      signal: signalText,
      trend: result.trend || "",
      reason: result.reasoning || "",
      checkedAt: Date.now()
    };
    const existing = tradingState.scalpObservations.findIndex(item => item.key === observation.key);
    if (existing >= 0) tradingState.scalpObservations.splice(existing, 1);
    tradingState.scalpObservations.unshift(observation);
    tradingState.scalpObservations = tradingState.scalpObservations.slice(0, 30);
    renderScalpActivity();
  }
  if (!direction) return;

  const entry = Number(result.entry);
  const sl = isScalp ? null : Number(result.sl);
  const tp = isScalp ? null : Number(result.tp);
  if (!Number.isFinite(entry) || entry <= 0) {
    console.warn("Signal not saved: a valid entry price is required.", { symbol, timeframe, signal: signalText, entry });
    return;
  }
  if (!isScalp && (![sl, tp].every(Number.isFinite) || sl <= 0 || tp <= 0)) {
    console.warn("Signal not saved: valid SL and TP are required for Intraday.", { symbol, timeframe, signal: signalText, entry, sl, tp });
    return;
  }

  const lastCandle = candles[candles.length - 1];
  const candleEpoch = Number(lastCandle?.epoch) || Math.floor(Date.now() / 1000);
  const strategy = activeStrategy;
  const signalKey = buildCandidateSignalKey(symbol,strategy,tradingState.mode,timeframe,direction,candleEpoch);
  // A signal is recorded at most once for this strategy, symbol, timeframe,
  // direction and candle, even if a later scan or another renderer sees it again.
  // Keep APA, SMC and News Trading records independent from one another.
  if (tradingState.signalHistory.some(record =>
    record.signalKey === signalKey ||
    (!record.signalKey && record.symbol === symbol && record.strategy === strategy &&
      record.mode === tradingState.mode && record.timeframe === timeframe &&
      record.direction === direction && Number(record.signalCandleEpoch) === candleEpoch)
  )) return;
  const openEntries = tradingState.signalHistory.filter(record => record.status === "OPEN");

  // Never keep opposing open candidates on the same market, even when
  // they came from different independent engines or different timeframes.
  // This is a signal-ledger conflict guard only; it never sends broker orders.
  if (hasOpposingOpenSignal(openEntries,symbol,direction)) {
    addResult("CONFLICT BLOCKED: "+symbol+" "+direction+" opposes an existing open demo candidate. Review the existing setup before accepting another direction.","scannerResults");
    return;
  }

  // SMC Scalping is locked to the user's active pair until its basket closes.
  if (isScalp && openEntries.some(record =>
    record.strategy === "smc" && record.mode === "scalping" && record.symbol !== symbol
  )) return;

  const maxEntries = Math.max(1, Math.min(20, Number(valueOf("maxTrades")) || 2));
  if (openEntries.length >= maxEntries) return;
  if (!checked("multipleEntries") && openEntries.length > 0) return;

  const sameSymbolScalpBasket = openEntries.filter(record =>
    record.mode === "scalping" && record.symbol === symbol &&
    record.strategy === strategy
  );
  if (isScalp && sameSymbolScalpBasket.some(record => record.direction !== direction)) return;

  const alreadyOpen = openEntries.some(record =>
    record.symbol === symbol && record.strategy === strategy &&
    record.timeframe === timeframe && record.direction === direction &&
    (!isScalp || Number(record.signalCandleEpoch) === candleEpoch)
  );
  if (alreadyOpen) return;

  const riskGuard = calculateDemoRiskGuard(tradingState.signalHistory, tradingState.settings);
  if (riskGuard.locked) {
    addResult("DEMO RISK PAUSE: " + riskGuard.lockReasons.join("; ") + ". New signals blocked.", "scannerResults");
    return;
  }

  const opportunityRank=rankCandidateOpportunity(result);
  const record = {
    id: `${symbol}-${strategy}-${timeframe}-${direction}-${Date.now()}`,
    signalKey,
    opportunityScore: opportunityRank.score,
    confirmationCount: opportunityRank.confirmations,
    modelCount: opportunityRank.models,
    opportunityRank: opportunityRank.rank,
    symbol, strategy, timeframe, direction, entry, sl, tp,
    lotSize: Number(valueOf("lotSize")) || null,
    mode: isScalp ? "scalping" : "intraday",
    exitPolicy: isScalp ? "all-positions-positive-basket" : "individual-tp-sl",
    createdAt: Date.now(),
    signalCandleEpoch: candleEpoch,
    lastCheckedCandleEpoch: candleEpoch,
    status: "OPEN"
  };
  tradingState.signalHistory.unshift(record);
  saveSignalHistory();
  addResult(
    isScalp
      ? `Scalp signal saved: ${symbol} ${strategy.toUpperCase()} ${direction} | Entry ${formatPrice(entry)} | fixed SL/TP not used.`
      : `Signal saved to history: ${symbol} ${strategy.toUpperCase()} ${direction} | Entry ${formatPrice(entry)} | SL ${formatPrice(sl)} | TP ${formatPrice(tp)}`,
    "tradeHistory"
  );
}

function updateMarketPrice(symbol, quote) {
  const item = tradingState.availableSymbols.find(
    market => market.symbol === symbol
  );
  if (!item) return;

  // Market-data-only simulation. This never sends broker orders.
  tradingState.lastPrices[symbol] = quote;
  manageScalpingBasketSimulation(symbol, quote);
}

function manageScalpingBasketSimulation(symbol, quote) {
  const price = Number(quote);
  if (!Number.isFinite(price) || price <= 0) return;

  // Only SMC scalp positions on this exact symbol belong to this basket.
  const basket = tradingState.signalHistory.filter(record =>
    record.status === "OPEN" &&
    record.strategy === "smc" &&
    record.mode === "scalping" &&
    record.symbol === symbol
  );
  if (!basket.length) return;

  // Every position must be individually profitable at this same quote.
  const allIndividuallyProfitable = basket.every(record => {
    const entry = Number(record.entry);
    if (!Number.isFinite(entry) || entry <= 0) return false;
    return record.direction === "BUY" ? price > entry :
      record.direction === "SELL" ? price < entry : false;
  });
  if (!allIndividuallyProfitable) return;

  const closedAt = Date.now();
  basket.forEach(record => {
    record.status = "SCALP BASKET CLOSED — ALL POSITIONS PROFITABLE";
    record.closedAt = closedAt;
    record.exitPrice = price;
  });
  saveSignalHistory();
  addResult(
    `SMC scalp basket simulation closed: every position on user-selected pair ${symbol} was individually profitable at the same quote. Fixed SL/TP not used.`,
    "tradeHistory"
  );
}

/* =========================================================
   SCANNER
========================================================= */

function recordMT5FeedHealth(symbol,timeframe,status,details={}) {
  const key=candleKey(symbol,timeframe);
  tradingState.mt5FeedHealth[key]={
    symbol,timeframe,status,checkedAt:Date.now(),
    ageSeconds:Number.isFinite(Number(details.ageSeconds))?Number(details.ageSeconds):null,
    candles:Number(details.candles)||0,
    reason:String(details.reason||"")
  };
}
function renderMT5FeedHealth(symbols,frames,batch) {
  const records=[];
  for(const symbol of symbols)for(const timeframe of frames){
    const item=tradingState.mt5FeedHealth[candleKey(symbol,timeframe)];
    records.push(item||{symbol,timeframe,status:"NOT CHECKED",reason:"Waiting for first scan"});
  }
  const healthy=records.filter(x=>x.status==="FRESH").length;
  const stale=records.filter(x=>x.status==="STALE").length;
  const missing=records.filter(x=>x.status==="MISSING"||x.status==="ERROR").length;
  const unchecked=records.filter(x=>x.status==="NOT CHECKED").length;
  const lines=records.map(x=>x.symbol+" "+x.timeframe.toUpperCase()+": "+x.status+
    (x.ageSeconds!==null&&x.ageSeconds!==undefined?" ("+x.ageSeconds+"s old)":"")+
    (x.candles?" • "+x.candles+" candles":"")+
    (x.reason?" — "+x.reason:""));
  setText("scannerStatus","MT5 feed health: "+healthy+"/"+records.length+" fresh • "+stale+" stale • "+missing+" missing/error • "+unchecked+" not checked. Batch "+(batch.total?batch.start+1+"–"+(batch.start+batch.symbols.length):"0")+"/"+batch.total+". Read-only demo analysis.");
  setText("derivConnectionStatus","MT5 read-only feed health updated "+new Date(tradingState.mt5LastScanAt).toLocaleTimeString()+".");
  setText("mt5FeedHealthStatus",lines.join("\n"));
}
async function scanMT5MarketData(){
  if(!tradingState.running||tradingState.broker!=="mt5"||tradingState.mt5ScanInProgress)return;
  tradingState.mt5ScanInProgress=true;
  try {
    const mode=valueOf("bridgeMode")||tradingState.mode||"scalping";
    const strategy=valueOf("bridgeStrategy")||tradingState.strategy||"apa";
    const rawSymbols=valueOf("bridgeSymbols").split(",").map(s=>s.trim()).filter(Boolean);
    const symbols=getScanSymbolsForMode(rawSymbols,mode,strategy);
    if(mode==="scalping"&&(strategy==="smc"||strategy==="both")&&symbols.length!==1){
      setText("scannerStatus","SMC Scalping requires exactly one user-selected MT5 pair. Enter one symbol only.");
      return;
    }
    const allowed=getBridgeFrames(mode,strategy);
    const checkedFrames=Array.from(document.querySelectorAll('[data-bridge-tf="1"]:checked')).map(x=>x.value);
    const required=(mode==="intraday"&&(strategy==="apa"||strategy==="both"))?APA_REQUIRED_FRAMES:[];
    const frames=[...new Set([...required,...(checkedFrames.length?checkedFrames.filter(tf=>allowed.includes(tf)):allowed)])];
    if(!symbols.length){setText("scannerStatus","MT5 scanner: enter symbols in the MT5 bridge settings first.");return;}
    const batch=getRotatingSymbolBatch(symbols,tradingState.mt5ScanCursor,10);
    tradingState.mt5ScanCursor=batch.nextCursor;
    for(const symbol of batch.symbols){
      for(const timeframe of frames){
        try{
          const url=MT5_MARKET_DATA_URL+"?symbol="+encodeURIComponent(symbol)+"&timeframe="+encodeURIComponent(timeframe);
          const response=await fetch(url,{cache:"no-store"});
          if(!response.ok){
            recordMT5FeedHealth(symbol,timeframe,"MISSING",{reason:"HTTP "+response.status});
            continue;
          }
          const packet=await response.json();
          const age=Number(packet.ageSeconds);
          if(packet.status!=="FRESH"||!Number.isFinite(age)||age>90){
            recordMT5FeedHealth(symbol,timeframe,"STALE",{ageSeconds:age,reason:packet.status!=="FRESH"?"Bridge reports "+String(packet.status):"Packet older than 90 seconds"});
            continue;
          }
          const bars=(packet.candles||[]).map(c=>({epoch:Number(c.epoch),open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close)})).filter(isValidCandle).slice(-150);
          if(bars.length<30){
            recordMT5FeedHealth(symbol,timeframe,"MISSING",{ageSeconds:age,candles:bars.length,reason:"Fewer than 30 valid candles"});
            continue;
          }
          const lastBar=bars[bars.length-1];
          const seconds=GRANULARITY[timeframe]||60;
          const candleAge=Math.floor(Date.now()/1000)-(lastBar.epoch+seconds);
          if(!Number.isFinite(candleAge)||candleAge>Math.max(180,seconds*2)){
            recordMT5FeedHealth(symbol,timeframe,"STALE",{ageSeconds:Math.max(age,candleAge),candles:bars.length,reason:"Latest candle is stale or not closed"});
            continue;
          }
          const key=candleKey(symbol,timeframe);
          tradingState.candles[key]=bars;
          recordMT5FeedHealth(symbol,timeframe,"FRESH",{ageSeconds:Math.max(age,candleAge),candles:bars.length});
          if(timeframe==="1m") manageScalpingBasketSimulation(symbol,lastBar.close);
          renderTimeframeAnalysis(symbol,timeframe);
          if((tradingState.strategy==="smc"||tradingState.strategy==="both")&&window.SMCIntradayEngine){
            const record=window.SMCIntradayEngine.evaluate(symbol,timeframe,bars,tradingState.mode);
            publishSMCSignal(symbol,timeframe,record,bars);
            renderSMCMultiFrame(symbol);
          }
          analyseMainSelection(symbol);
          addResult("MT5 DATA "+symbol+" "+timeframe.toUpperCase()+" • "+bars.length+" candles • feed age "+Math.max(age,candleAge)+"s","scannerResults");
        }catch(error){
          recordMT5FeedHealth(symbol,timeframe,"ERROR",{reason:error?.message||"Network or parsing error"});
        }
      }
    }
    tradingState.mt5LastScanAt=Date.now();
    renderMT5FeedHealth(batch.symbols,frames,batch);
  } finally {
    tradingState.mt5ScanInProgress=false;
  }
}
function startMT5Scanner(){
  const mode=valueOf("bridgeMode")||"scalping";
  const strategy=valueOf("bridgeStrategy")||"apa";
  const rawSymbols=valueOf("bridgeSymbols").split(",").map(s=>s.trim()).filter(Boolean);
  const symbols=getScanSymbolsForMode(rawSymbols,mode,strategy);
  if(!symbols.length){
    const message=mode==="scalping"&&(strategy==="smc"||strategy==="both")
      ?"SMC Scalping requires exactly one user-selected MT5 pair. Enter one symbol only."
      :"MT5 scanner requires at least one symbol in bridge settings.";
    addResult(message);setText("scannerStatus",message);return;
  }
  stopScanner(false);
  tradingState.scannerDesired=true;tradingState.running=true;tradingState.scanGeneration++;
  tradingState.mt5ScanCursor=0;tradingState.mt5ScanInProgress=false;
  tradingState.mode=mode;
  tradingState.strategy=strategy;
  tradingState.selectedSymbols=new Set(symbols);
  setText("scannerResults","MT5 market-data scanner started. Waiting for fresh candles.");
  setText("scannerStatus","MT5 data scanner starting — read-only.");
  scanMT5MarketData();
  tradingState.mt5ScannerTimer=setInterval(scanMT5MarketData,15000);
}
function startScanner(resume = false) {
  const persistedRisk = calculateDemoRiskGuard(tradingState.signalHistory, tradingState.settings);
  if (persistedRisk.locked) {
    tradingState.scannerDesired = false;
    tradingState.running = false;
    setText("scannerStatus", "DEMO RISK PAUSED — " + persistedRisk.lockReasons.join("; "));
    addResult("Scanner start blocked by persisted demo risk lock: " + persistedRisk.lockReasons.join("; "), "scannerResults");
    return;
  }
  if (tradingState.broker === "mt5") { startMT5Scanner(); return; }

  if (!tradingState.derivConnected || !isSocketOpen()) {
    addResult("Connect Deriv first.");
    setText("scannerStatus", "Scanner stopped: Deriv disconnected");
    return;
  }

  if (!tradingState.selectedSymbols.size) {
    addResult("Select at least one market first.");
    return;
  }
  if (tradingState.mode === "scalping" &&
      (tradingState.strategy === "smc" || tradingState.strategy === "both") &&
      tradingState.selectedSymbols.size !== 1) {
    addResult("SMC Scalping requires exactly one user-selected pair. Clear other pairs and select one.");
    setText("scannerStatus", "SMC Scalping paused — select exactly one pair.");
    return;
  }

  stopScanner(false);

  tradingState.scannerDesired = true;
  tradingState.running = true;
  tradingState.scanGeneration++;

  setText("scannerStatus", "Scanner running — DEMO monitoring only");
  setText("scannerResults", "Scanner started.");

  addResult(
    `Scanner started: ${tradingState.selectedSymbols.size} selected markets.`
  );

  scanSelectedMarkets();
  tradingState.scanTimer = setInterval(scanSelectedMarkets, tradingState.mode === "scalping" ? 12000 : 60000);
}

function scanSelectedMarkets() {
  if (!tradingState.running || !isSocketOpen()) return;

  const selected = [...tradingState.selectedSymbols];
  if (tradingState.mode === "scalping" &&
      (tradingState.strategy === "smc" || tradingState.strategy === "both") &&
      selected.length !== 1) {
    tradingState.running = false;
    setText("scannerStatus", "SMC Scalping paused — exactly one user-selected pair is required.");
    return;
  }
  // Do not advance the market cursor while a previous batch is still queued.
  if (tradingState.scanInProgress || tradingState.scanQueue.length) return;

  const universe = tradingState.mode === "intraday" &&
    (tradingState.strategy === "apa" || tradingState.strategy === "both")
    ? tradingState.availableSymbols.map(item => item.symbol)
    : selected;
  const batch = getScannerUniverseBatch(universe, tradingState.mode, tradingState.strategy,
    tradingState.scanUniverseCursor, 10);
  const symbols = batch.symbols;
  tradingState.scanUniverseCursor = batch.nextCursor;
  const modeFrames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const frames = (tradingState.strategy === "apa" || tradingState.strategy === "both")
    ? [...new Set([...modeFrames, ...APA_REQUIRED_FRAMES])]
    : modeFrames;

  tradingState.scanInProgress = true;
  symbols.forEach(symbol => {
    frames.forEach(timeframe => {
      requestCandles(symbol, timeframe);
    });
  });

  setText(
    "scannerStatus",
    `APA all-market rotation: ${symbols.length}/${batch.total} markets in this batch / ${frames.length} timeframes`
  );
}

function stopScanner(showMessage = true) {
  tradingState.running = false;
  tradingState.scannerDesired = false;
  if(tradingState.mt5ScannerTimer){clearInterval(tradingState.mt5ScannerTimer);tradingState.mt5ScannerTimer=null;}
  tradingState.mt5ScanInProgress=false;
  clearScanQueue();
  for (const subscriptionId of tradingState.candleSubscriptions.keys()) {
    if (isSocketOpen()) sendRequest({ forget: subscriptionId });
  }
  tradingState.candleSubscriptions.clear();

  if (tradingState.scanTimer) {
    clearInterval(tradingState.scanTimer);
    tradingState.scanTimer = null;
  }

  setText("scannerStatus", "Scanner stopped");

  if (showMessage) addResult("Scanner stopped.");
}

/* =========================================================
   SETTINGS
========================================================= */

function collectSettings() {
  const ids = [
    "riskPercent",
    "lotSize",
    "stopLoss",
    "takeProfit",
    "maxTrades",
    "dailyLossLimit",
    "maxConsecutiveLosses",
    "useAPA", "useATR", "useAPAConfirmation", "useTrend", "useLiquidity",
    "useBOS", "useMSS", "useCHoCH", "useDisplacement", "useOB", "useFVG",
    "useIFVG", "useBreaker", "useSupplyDemand", "apaEntryStyle"
  ];

  const settings = {};

  ids.forEach(id => {
    const element = $(id);
    settings[id] = element?.type === "checkbox"
      ? Boolean(element.checked)
      : valueOf(id);
  });

  settings.mode = valueOf("tradingStyle") || "scalping";
  settings.strategy = valueOf("strategySettings") || "apa";
  settings.timeframe = valueOf("timeframe") || "1m";

  settings.continuousScanning = checked("continuousScanning");
  settings.multipleEntries = checked("multipleEntries");
  settings.manageTrades = checked("manageTrades");

  return settings;
}

function saveSettings() {
  const risk = Number(valueOf("riskPercent"));
  const lot = Number(valueOf("lotSize"));
  const sl = Number(valueOf("stopLoss"));
  const tp = Number(valueOf("takeProfit"));
  const maxTrades = Number(valueOf("maxTrades"));
  const daily = Number(valueOf("dailyLossLimit"));
  const losses = Number(valueOf("maxConsecutiveLosses"));

  if (!(risk > 0 && risk <= 1)) {
    setText("settingsStatus", "Risk must be between 0.1% and 1%.");
    return;
  }

  if (!(lot > 0 && sl > 0 && tp > 0 && maxTrades >= 1 &&
        daily > 0 && losses >= 1)) {
    setText("settingsStatus", "Check all risk values.");
    return;
  }

  tradingState.settings = collectSettings();

  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(tradingState.settings)
    );
    setText("settingsStatus", "Settings saved on this device.");
  } catch {
    setText("settingsStatus", "Could not save settings.");
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

    Object.entries(saved).forEach(([key, value]) => {
      const el = $(key);
      if (!el) return;

      if (el.type === "checkbox") {
        el.checked = Boolean(value);
      } else {
        el.value = value;
      }
    });

    // Default to Deriv, but never guess a broker server name.
    // The user must copy the exact server shown in their MT5 account.

    if (saved.mode && $("tradingStyle")) {
      $("tradingStyle").value = saved.mode;
    }

    updateMode();

    if (saved.strategy) syncStrategy(saved.strategy);
  } catch {
    updateMode();
  }
}

/* =========================================================
   INITIALIZATION
========================================================= */

function initApp() {
  // Independent SMC intraday confirmation signals (no order execution)
  window.addEventListener("smc:signal", event => {
    const s = event.detail;
    addResult(`SMC CONFIRMED ${s.side} ${s.symbol} ${s.timeframe.toUpperCase()} • ${s.count} confirmations • score ${s.score}/100`, "scannerResults");
  });

  // Navigation
  document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showSection(button.dataset.page);
    });
  });

  // Deriv controls
  $("connectDeriv")?.addEventListener("click", connectDeriv);
  $("disconnectDeriv")?.addEventListener("click", disconnectDeriv);

  // Markets
  $("selectAllPairs")?.addEventListener("click", selectAllPairs);
  $("clearPairs")?.addEventListener("click", clearPairs);

  // Scanner buttons
  $("startScanner")?.addEventListener("click", startScanner);
  $("stopScanner")?.addEventListener("click", () => stopScanner(true));
  $("scannerStartButton")?.addEventListener("click", startScanner);
  $("scannerStopButton")?.addEventListener("click", () => stopScanner(true));

  // Modes
  $("tradingStyle")?.addEventListener("change", updateMode);
  $("timeframe")?.addEventListener("change", updateActiveTimeframes);

  // Strategies
  ["strategySelect", "scannerStrategy", "strategySettings"].forEach(id => {
    $(id)?.addEventListener("change", event => {
      syncStrategy(event.target.value);
    });
  });

  // Brokers
  $("brokerType")?.addEventListener("change", () => updateBrokerPanels("brokerType"));
  $("scannerBroker")?.addEventListener("change", () => updateBrokerPanels("scannerBroker"));
  $("connectMT5")?.addEventListener("click", prepareMT5Connection);
  $("refreshMT5Bridge")?.addEventListener("click", refreshMT5BridgeStatus);
  $("bridgeMode")?.addEventListener("change", renderBridgeTimeframes);
  $("syncBridgeConfig")?.addEventListener("click", syncMT5BridgeConfig);
  $("refreshBridgeConfig")?.addEventListener("click", refreshMT5BridgeConfig);
  $("mt5Broker")?.addEventListener("change", () => {
    setText("mt5ConnectionStatus", "Broker selected. The VPS and secure MT5 bridge are still required.");
  });

  // News calendar
  $("refreshNews")?.addEventListener("click", () => loadNewsCalendar(true));

  // SMC historical replay — uses the selected symbol/timeframe cached candles only.
  $("runSMCHistoricalTest")?.addEventListener("click", () => {
    const symbol=tradingState.lastAnalysedSymbol||Array.from(tradingState.selectedSymbols||[])[0]||tradingState.availableSymbols?.[0]?.symbol;
    const tf=$("timeframe")?.value||$("scannerTimeframe")?.value||"15m";
    const candles=tradingState.candles[symbol+"|"+tf]||[];
    const result=window.SMCIntradayEngine?.backtest(candles,{warmup:40,horizon:30,rr:2});
    if(!result||result.error){setText("smcBacktestStatus","Historical test: "+(result?.error||"engine unavailable"));return;}
    setText("smcBacktestStatus","REPLAY ("+symbol+" "+tf+") — signals "+result.total+" | TP2 "+result.wins+" | SL "+result.losses+" (ambiguous SL-first "+result.ambiguous+") | unresolved "+result.open+" | win rate "+result.winRate.toFixed(1)+"% | average "+result.avgR.toFixed(2)+"R. "+result.note);
  });
  // Settings
  $("saveSettings")?.addEventListener("click", saveSettings);

  loadSettings();
  if ($("mt5Broker") && tradingState.settings.mt5Broker) {
    $("mt5Broker").value = tradingState.settings.mt5Broker;
  }
  if ($("mt5Server") && tradingState.settings.mt5Server) {
    $("mt5Server").value = tradingState.settings.mt5Server;
  }
  // Keep both broker selectors and their panels in sync on every page load.
  updateBrokerPanels("brokerType");
  updatePairCount();

  renderBridgeTimeframes();
  refreshMT5BridgeStatus();
  setConnectionStatus("Not connected");
  setText("scannerStatus", "Scanner stopped");
  setText("cloudStatus", "Cloud engine status: Not verified");
  setText("positionsList", "No positions available — order execution disabled.");
  loadSignalHistory();

  console.log("SMC Sniper Pro APA initialized.");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

/* =========================================================
   SAFETY
========================================================= */

// No buy(), sell(), proposal, buy contract, or live order
// execution functions exist in this monitoring version.
// Live trading is intentionally locked.



  


