
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

const TIMEFRAMES = {
  scalping: ["1m", "5m", "15m"],
  intraday: ["30m", "1h", "4h"],
  swing: ["1h", "4h", "1d"]
};

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

  requestId: 1,
  scanTimer: null,
  scanGeneration: 0,
  scanQueue: [],
  scanQueueTimer: null,
  scanInProgress: false,
  scannerDesired: false,
  pingTimer: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  manualDisconnect: false,
  lastSignals: {},
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

  frames.forEach(frame => {
    const option = document.createElement("option");
    option.value = frame;
    option.textContent = frame.toUpperCase();
    timeframeSelect.appendChild(option);
  });

  timeframeSelect.value = frames.includes(previous)
    ? previous
    : frames[0];

  setText(
    "timeframeInfo",
    `${mode.toUpperCase()}: ${frames.map(f => f.toUpperCase()).join(", ")}`
  );

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
  if (!["apa", "smc", "news"].includes(value)) value = "apa";
  tradingState.strategy = value;

  ["strategySelect", "scannerStrategy", "strategySettings"].forEach(id => {
    if ($(id)) $(id).value = value;
  });

  $("apaSettings")?.classList.toggle("hidden", value !== "apa");
  $("smcSettings")?.classList.toggle("hidden", value !== "smc");

  setText("strategyInfo",
    value === "apa"
      ? "APA Advanced Price Action selected — original APA sequence."
      : value === "smc"
        ? "SMC selected — independent Smart Money Concepts confirmation engine."
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

function updateBrokerPanels() {
  const broker = valueOf("brokerType") ||
    valueOf("scannerBroker") || "deriv";

  tradingState.broker = broker;

  $("derivPanel")?.classList.toggle("hidden", broker !== "deriv");
  $("mt5Panel")?.classList.toggle("hidden", broker !== "mt5");

  if ($("brokerType")) $("brokerType").value = broker;
  if ($("scannerBroker")) $("scannerBroker").value = broker;
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
    setConnectionStatus("Deriv API: " + message);
    addResult(message);
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

  const context = data.req_id
    ? tradingState.requestContexts.get(data.req_id)
    : null;

  if (data.req_id) {
    tradingState.requestContexts.delete(data.req_id);
  }

  if (data.msg_type === "candles" && Array.isArray(data.candles)) {
    if (!context) return;

    const key = candleKey(context.symbol, context.timeframe);

    tradingState.candles[key] = data.candles
      .map(normalizeCandle)
      .filter(isValidCandle)
      .slice(-150);

    renderTimeframeAnalysis(context.symbol, context.timeframe);
    analyseMainSelection(context.symbol);
  }

  if (data.msg_type === "ohlc" && data.ohlc && context) {
    const key = candleKey(context.symbol, context.timeframe);
    const list = tradingState.candles[key] || [];
    const candle = normalizeCandle(data.ohlc);

    if (isValidCandle(candle)) {
      list.push(candle);
      tradingState.candles[key] = list.slice(-150);
      analyseMainSelection(context.symbol);
    }
  }

  if (data.msg_type === "tick" && data.tick) {
    const symbol = data.tick.symbol;
    const quote = Number(data.tick.quote);

    if (symbol && Number.isFinite(quote)) {
      tradingState.lastPrices[symbol] = quote;
      updateMarketPrice(symbol, quote);
    }
  }
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
}

function clearPairs() {
  tradingState.selectedSymbols.clear();
  renderMarketList();
  updatePairCount();
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
      granularity: job.granularity
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
  if (!Array.isArray(candles) || candles.length < 20)
    return { label: "Waiting", bosUp: false, bosDown: false, mssUp: false, mssDown: false };
  const sample = candles.slice(-20), last = sample[sample.length - 1];
  const prior = sample.slice(0, -1);
  const priorHigh = Math.max(...prior.map(c => c.high));
  const priorLow = Math.min(...prior.map(c => c.low));
  const oldTrend = getTrend(sample.slice(0, -5));
  const bosUp = last.close > priorHigh, bosDown = last.close < priorLow;
  const mssUp = oldTrend === "Bearish" && bosUp;
  const mssDown = oldTrend === "Bullish" && bosDown;
  return { label: mssUp ? "Bullish MSS / CHoCH" : mssDown ? "Bearish MSS / CHoCH" :
    bosUp ? "Bullish BOS" : bosDown ? "Bearish BOS" : "No confirmed break",
    bosUp, bosDown, mssUp, mssDown };
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

  // An order block is a candidate until price returns to it and reacts.
  const bullishOBTouch = Boolean(
    bullishOB && last.low <= bullishOB.high &&
    last.high >= bullishOB.low && last.close > last.open &&
    last.close >= bullishOB.low
  );
  const bearishOBTouch = Boolean(
    bearishOB && last.high >= bearishOB.low &&
    last.low <= bearishOB.high && last.close < last.open &&
    last.close <= bearishOB.high
  );

  let breaker = "Not identified";
  let bullishBreaker = false;
  let bearishBreaker = false;
  if (bearishOB && last.close > bearishOB.high) {
    breaker = "Bullish breaker candidate";
    bullishBreaker = true;
  } else if (bullishOB && last.close < bullishOB.low) {
    breaker = "Bearish breaker candidate";
    bearishBreaker = true;
  }

  const demandSupport = Boolean(
    zones.demand && last.low <= zones.demand.high &&
    last.close >= zones.demand.low
  );
  const supplyResistance = Boolean(
    zones.supply && last.high >= zones.supply.low &&
    last.close <= zones.supply.high
  );
  const bullishCandle = last.close > last.open;
  const bearishCandle = last.close < last.open;

  // Count independent confirmation groups. BOS/MSS/CHoCH are one
  // structure group; FVG/IFVG are one imbalance group; OB/breaker
  // are one block group so the same event is never double-counted.
  const bullConfirmations = [];
  const bearConfirmations = [];

  if (trend === "Bullish") bullConfirmations.push("Bullish trend");
  if (trend === "Bearish") bearConfirmations.push("Bearish trend");

  if (structure.bosUp || structure.mssUp) {
    bullConfirmations.push(structure.mssUp ? "Bullish MSS / CHoCH" : "Bullish BOS");
  }
  if (structure.bosDown || structure.mssDown) {
    bearConfirmations.push(structure.mssDown ? "Bearish MSS / CHoCH" : "Bearish BOS");
  }

  if (liquidity.sweepLow) bullConfirmations.push("Low-side liquidity sweep");
  if (liquidity.sweepHigh) bearConfirmations.push("High-side liquidity sweep");

  if (displacement && bullishCandle) bullConfirmations.push("Bullish displacement");
  if (displacement && bearishCandle) bearConfirmations.push("Bearish displacement");

  if (fvg.bullishFVG || fvg.bullishIFVG) bullConfirmations.push(
    fvg.bullishIFVG ? "Bullish IFVG" : "Bullish FVG"
  );
  if (fvg.bearishFVG || fvg.bearishIFVG) bearConfirmations.push(
    fvg.bearishIFVG ? "Bearish IFVG" : "Bearish FVG"
  );

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
  const bullishReversalConfirmed = Boolean(
    (structure.bosUp || structure.mssUp) && liquidity.sweepLow
  );
  const bearishReversalConfirmed = Boolean(
    (structure.bosDown || structure.mssDown) && liquidity.sweepHigh
  );

  let buyReady = rawBuyReady;
  let sellReady = rawSellReady;
  let blockedDirectionReason = "";

  if (buyReady && trend === "Bearish" && !bullishReversalConfirmed) {
    buyReady = false;
    blockedDirectionReason = "Bullish candidate blocked: the higher market trend is bearish and there is no bullish structure break plus low-side liquidity sweep to confirm a reversal.";
  }
  if (sellReady && trend === "Bullish" && !bearishReversalConfirmed) {
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

  const conflicting = buyReady && sellReady;
  const signal = conflicting
    ? "Conflicting confirmations — no signal"
    : buyReady
      ? (bullConfirmations.length >= 3 ? "Stronger BUY candidate — " : "Potential BUY — ") +
        bullConfirmations.length + " confirmations"
      : sellReady
        ? (bearConfirmations.length >= 3 ? "Stronger SELL candidate — " : "Potential SELL — ") +
          bearConfirmations.length + " confirmations"
        : "Waiting — need 2 compatible confirmations";

  const entry = last.close;
  const sl = buyReady && !conflicting
    ? Math.min(last.low, zones.demand ? zones.demand.low : last.low)
    : sellReady && !conflicting
      ? Math.max(last.high, zones.supply ? zones.supply.high : last.high)
      : null;
  const risk = sl === null ? null : Math.abs(entry - sl);
  const tp = risk === null ? null : (buyReady ? entry + risk * 2 : entry - risk * 2);

  const activeSide = conflicting ? "conflicting" : buyReady ? "buy" : sellReady ? "sell" : "wait";
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
    ["Trend direction", trend !== "Sideways" && trend !== "Unknown"],
    ["Liquidity sweep", liquidity.sweepLow || liquidity.sweepHigh],
    ["BOS / MSS / CHoCH (one structure group)", structure.bosUp || structure.bosDown || structure.mssUp || structure.mssDown],
    ["Strong displacement", displacement],
    ["Order Block identified", Boolean(bullishOB || bearishOB)],
    ["Order Block reaction", bullishOBTouch || bearishOBTouch],
    ["Supply zone identified", Boolean(zones.supply)],
    ["Demand zone identified", Boolean(zones.demand)],
    ["Breaker Block candidate", bullishBreaker || bearishBreaker],
    ["FVG / IFVG (one imbalance group)", fvg.bullishFVG || fvg.bearishFVG || fvg.bullishIFVG || fvg.bearishIFVG],
    ["Bullish confirmations", bullConfirmations.length + (bullConfirmations.length === 1 ? " — " + bullConfirmations.join(", ") : " — " + bullConfirmations.join(", "))],
    ["Bearish confirmations", bearConfirmations.length + (bearConfirmations.length === 1 ? " — " + bearConfirmations.join(", ") : " — " + bearConfirmations.join(", "))],
    ["Minimum 2 compatible confirmations", (buyReady || sellReady) && !conflicting]
  ];

  return {
    ready: true, strategy: "smc", trend, structure: structure.label,
    liquidity: liquidity.label, signal, entry,
    sl: conflicting ? null : sl, tp: conflicting ? null : tp,
    invalidation: conflicting ? null : sl, checks,
    displacement, supply: zones.supply, demand: zones.demand, breaker,
    breakerFound: bullishBreaker || bearishBreaker,
    orderBlock: trend === "Bullish" ? (bullishOB || bearishOB) : (bearishOB || bullishOB),
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

function analyseAPA(entryCandles, higherCandles, lowerCandles) {
  if (!Array.isArray(entryCandles) || entryCandles.length < 20 ||
      !Array.isArray(higherCandles) || higherCandles.length < 12)
    return { ready: false, trend: "Waiting for higher-timeframe data",
      structure: "Waiting", liquidity: "Waiting", supply: null, demand: null,
      breaker: "APA POI scan waiting", checks: [], signal: "Waiting for APA timeframes" };
  const last = entryCandles[entryCandles.length - 1];
  const higherTrend = getTrend(higherCandles);
  const structure = getStructure(entryCandles), liquidity = getLiquidity(entryCandles);
  const zones = findStructureZones(higherCandles);
  const bullishOB = findOrderBlock(higherCandles, "bullish");
  const bearishOB = findOrderBlock(higherCandles, "bearish");
  const bullishPOI = Boolean(bullishOB || zones.demand);
  const bearishPOI = Boolean(bearishOB || zones.supply);
  const nearDemand = Boolean(zones.demand && last.low <= zones.demand.high && last.close >= zones.demand.low);
  const nearSupply = Boolean(zones.supply && last.high >= zones.supply.low && last.close <= zones.supply.high);
  const ltf = Array.isArray(lowerCandles) && lowerCandles.length >= 8 ? lowerCandles : entryCandles;
  const ltfLast = ltf[ltf.length - 1];
  const ltfBullish = ltfLast.close > ltfLast.open, ltfBearish = ltfLast.close < ltfLast.open;
  const bullishStructure = structure.bosUp || structure.mssUp;
  const bearishStructure = structure.bosDown || structure.mssDown;
  const buyReady = higherTrend === "Bullish" && bullishPOI && nearDemand &&
    (bullishStructure || liquidity.sweepLow) && ltfBullish;
  const sellReady = higherTrend === "Bearish" && bearishPOI && nearSupply &&
    (bearishStructure || liquidity.sweepHigh) && ltfBearish;
  const signal = buyReady ? "Potential APA BUY — trend, POI and entry aligned" :
    sellReady ? "Potential APA SELL — trend, POI and entry aligned" :
    "APA waiting: Trend → POI → CHoCH/BOS → lower-timeframe entry";
  const entry = last.close, sl = buyReady ? zones.demand.low : sellReady ? zones.supply.high : null;
  const risk = sl === null ? null : Math.abs(entry - sl);
  const tp = risk === null ? null : (buyReady ? entry + risk * 2 : entry - risk * 2);
  const apaReasons = [];
  apaReasons.push(`Higher timeframe: ${higherTrend}.`);
  if (bullishOB) apaReasons.push("Bullish order-block candidate found.");
  if (bearishOB) apaReasons.push("Bearish order-block candidate found.");
  if (zones.demand) apaReasons.push(`Demand zone: ${formatZone(zones.demand)}.`);
  if (zones.supply) apaReasons.push(`Supply zone: ${formatZone(zones.supply)}.`);
  if (nearDemand) apaReasons.push("Price is reacting in/near demand.");
  if (nearSupply) apaReasons.push("Price is reacting in/near supply.");
  if (liquidity.sweepLow) apaReasons.push("A low-side liquidity sweep is detected.");
  if (liquidity.sweepHigh) apaReasons.push("A high-side liquidity sweep is detected.");
  if (bullishStructure) apaReasons.push("Bullish BOS/MSS confirmation is present.");
  if (bearishStructure) apaReasons.push("Bearish BOS/MSS confirmation is present.");
  if (ltfBullish) apaReasons.push("Lower-timeframe candle is bullish.");
  if (ltfBearish) apaReasons.push("Lower-timeframe candle is bearish.");
  const reasoning = buyReady
    ? `BUY candidate: the higher-timeframe trend is bullish, price reacted at demand, bullish structure or a low sweep confirms, and the lower timeframe is bullish. ${apaReasons.join(" ")}`
    : sellReady
      ? `SELL candidate: the higher-timeframe trend is bearish, price reacted at supply, bearish structure or a high sweep confirms, and the lower timeframe is bearish. ${apaReasons.join(" ")}`
      : `WAIT: APA requires higher-timeframe trend alignment, a relevant point of interest, price reaction there, BOS/MSS or a liquidity sweep, and lower-timeframe direction. Current evidence: ${apaReasons.join(" ") || "not enough candle data"}`;
  const checks = [
    ["Higher-timeframe trend", higherTrend !== "Sideways" && higherTrend !== "Unknown"],
    ["POI identified (OB / flip zone / liquidity area)", bullishPOI || bearishPOI],
    ["Price reacting at POI", nearDemand || nearSupply],
    ["Liquidity pool sweep", liquidity.sweepLow || liquidity.sweepHigh],
    ["CHoCH / BOS confirmation", bullishStructure || bearishStructure],
    ["Lower-timeframe entry direction", ltfBullish || ltfBearish]
  ];
  return { ready: true, strategy: "apa", trend: higherTrend, structure: structure.label,
    liquidity: liquidity.label, signal, entry, sl, tp, invalidation: sl, checks, reasoning,
    supply: zones.supply, demand: zones.demand, breaker: "SMC breaker logic is separate from APA",
    breakerFound: false, demandSupport: nearDemand, supplyResistance: nearSupply,
    structureDetails: structure,
    fvgDetails: getFVGState(entryCandles),
    orderBlock: higherTrend === "Bullish" ? bullishOB : bearishOB,
    displacement: getDisplacement(entryCandles) };
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
  if (!force && Date.now() - tradingState.newsLoadedAt < 15 * 60 * 1000) return;

  tradingState.newsLoading = true;
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
    if (tradingState.lastAnalysedSymbol) {
      analyseMainSelection(tradingState.lastAnalysedSymbol);
    }
  } catch (error) {
    tradingState.newsError = error && error.message ? error.message : "Unknown calendar error";
    setText("newsCalendarStatus", "Calendar unavailable");
    renderNewsCalendar();
    setText("newsReasoning",
      "WAIT: the economic calendar could not be loaded. News signals are disabled until reliable event data is available. " +
      tradingState.newsError);
    setText("newsSignal", "WAIT — no calendar data");
  } finally {
    tradingState.newsLoading = false;
  }
}

function parseNewsNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const textValue = String(value).trim().replace(/,/g, "");
  const match = textValue.match(/-?\\d+(?:\\.\\d+)?/);
  if (!match) return null;
  let number = Number(match[0]);
  if (!Number.isFinite(number)) return null;
  if (/\\bK\\b/i.test(textValue)) number *= 1e3;
  if (/\\bM\\b/i.test(textValue)) number *= 1e6;
  if (/\\bB\\b/i.test(textValue)) number *= 1e9;
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
      return (currency === pair.base || currency === pair.quote) &&
        Number(event.ts) * 1000 >= now;
    })
    .sort((a, b) => Number(a.ts) - Number(b.ts))[0];

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
  const postReleaseCandles = candles.filter(c =>
    Number(c.epoch) >= Number(event.ts)
  ).slice(-4);

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

function analyseCandles(candles) {
  return tradingState.strategy === "smc" ? analyseSMC(candles) : analyseAPA(candles, candles, candles);
}

function renderTimeframeAnalysis(symbol, timeframe) {
  const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const higherCandles = tradingState.candles[candleKey(symbol, frames[frames.length - 1])] || [];
  const lowerCandles = tradingState.candles[candleKey(symbol, frames[0])] || [];
  const result = tradingState.strategy === "news"
    ? analyseNews(symbol, candles)
    : tradingState.strategy === "apa"
      ? analyseAPA(candles, higherCandles, lowerCandles)
      : analyseSMC(candles);

  const box = $("timeframeResults");
  if (!box) return;

  const resultKey = `${symbol}|${timeframe}`;
  let item = Array.from(box.children).find(
    child => child.dataset && child.dataset.resultKey === resultKey
  );

  if (!item) {
    item = document.createElement("div");
    item.className = "result-item";
    item.dataset.resultKey = resultKey;
    box.prepend(item);
  }

  item.textContent = `${symbol} ${timeframe.toUpperCase()}: ${result.trend} | ${result.structure} | ${result.signal}`;

  while (box.children.length > 30) {
    box.removeChild(box.lastChild);
  }
}

function analyseMainSelection(symbol) {
  const timeframe = valueOf("timeframe") || "1m";
  const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;
  const higherFrame = frames[frames.length - 1];
  const lowerFrame = frames[0];
  const higherCandles = tradingState.candles[candleKey(symbol, higherFrame)] || [];
  const lowerCandles = tradingState.candles[candleKey(symbol, lowerFrame)] || [];
  const result = tradingState.strategy === "news"
    ? analyseNews(symbol, candles)
    : tradingState.strategy === "apa"
      ? analyseAPA(candles, higherCandles, lowerCandles)
      : analyseSMC(candles);

  if (!result.ready) return;
  tradingState.lastAnalysedSymbol = symbol;
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
  setText("entrySignal", result.signal);
  setText("tradeReasoning", result.reasoning || "Reasoning is not available for this analysis.");
  setText("supplyZone", formatZone(result.supply));
  setText("demandZone", formatZone(result.demand));
  setText("breakerBlock", result.breaker);
  const structureState = result.structureDetails || {};
  const fvgState = result.fvgDetails || {};
  const showDirection = (up, down) => up ? "Bullish detected" : down ? "Bearish detected" : "Not detected";
  setText("bosStatus", showDirection(structureState.bosUp, structureState.bosDown));
  setText("mssStatus", showDirection(structureState.mssUp, structureState.mssDown));
  setText("chochStatus", showDirection(structureState.mssUp, structureState.mssDown));
  setText("fvgStatus", showDirection(fvgState.bullishFVG, fvgState.bearishFVG));
  setText("ifvgStatus", showDirection(fvgState.bullishIFVG, fvgState.bearishIFVG));
  setText("displacementStatus", result.displacement ? "Detected" : "Not detected");
  setText("orderBlockStatus", result.orderBlock ? formatZone(result.orderBlock) : "Not identified");
  setText("supplyDemandStatus",
    result.demandSupport ? "Price in / near demand" :
    result.supplyResistance ? "Price in / near supply" : "Zones identified — waiting for price interaction");

  setText("signalEntry", formatPrice(result.entry));
  setText("signalSL", formatPrice(result.sl));
  setText("signalTP", formatPrice(result.tp));
  setText("signalInvalidation", formatPrice(result.invalidation));

  const checklist = $("strategyChecklist");
  if (checklist) {
    checklist.replaceChildren();

    result.checks.forEach(([name, passed]) => {
      const row = document.createElement("div");
      row.className = "result-item";
      row.textContent = `${passed ? "✓" : "○"} ${name}`;
      checklist.appendChild(row);
    });
  }

  tradingState.lastSignals[symbol] = result;
}

function updateMarketPrice(symbol, quote) {
  const item = tradingState.availableSymbols.find(
    market => market.symbol === symbol
  );
  if (!item) return;

  // Price is stored for scanner use; no orders are placed.
  tradingState.lastPrices[symbol] = quote;
}

/* =========================================================
   SCANNER
========================================================= */

function startScanner(resume = false) {
  if (!tradingState.derivConnected || !isSocketOpen()) {
    addResult("Connect Deriv first.");
    setText("scannerStatus", "Scanner stopped: Deriv disconnected");
    return;
  }

  if (!tradingState.selectedSymbols.size) {
    addResult("Select at least one market first.");
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

  const symbols = [...tradingState.selectedSymbols];
  const frames = TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;

  if (tradingState.scanInProgress || tradingState.scanQueue.length) return;

  tradingState.scanInProgress = true;
  symbols.forEach(symbol => {
    frames.forEach(timeframe => {
      requestCandles(symbol, timeframe);
    });
  });

  setText(
    "scannerStatus",
    `Scanner active: ${symbols.length} markets / ${frames.length} timeframes`
  );
}

function stopScanner(showMessage = true) {
  tradingState.running = false;
  tradingState.scannerDesired = false;
  clearScanQueue();

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
    "maxConsecutiveLosses"
  ];

  const settings = {};

  ids.forEach(id => {
    settings[id] = valueOf(id);
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
  $("brokerType")?.addEventListener("change", updateBrokerPanels);
  $("scannerBroker")?.addEventListener("change", updateBrokerPanels);

  // News calendar
  $("refreshNews")?.addEventListener("click", () => loadNewsCalendar(true));

  // Settings
  $("saveSettings")?.addEventListener("click", saveSettings);

  loadSettings();
  updateBrokerPanels();
  updatePairCount();

  setConnectionStatus("Not connected");
  setText("scannerStatus", "Scanner stopped");
  setText("cloudStatus", "Cloud engine status: Not verified");
  setText("positionsList", "No positions available — order execution disabled.");
  setText("tradeHistory", "No completed trades — order execution disabled.");

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



  


