
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
  settings: {}
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
  if (!["apa", "smc"].includes(value)) value = "apa";

  tradingState.strategy = value;

  [
    "strategySelect",
    "scannerStrategy",
    "strategySettings"
  ].forEach(id => {
    if ($(id)) $(id).value = value;
  });

  $("apaSettings")?.classList.toggle("hidden", value !== "apa");
  $("smcSettings")?.classList.toggle("hidden", value !== "smc");

  setText(
    "strategyInfo",
    value === "apa"
      ? "APA Advanced Price Action selected — original APA sequence."
      : "SMC selected — independent Smart Money Concepts confirmation engine."
  );
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
  if (!Array.isArray(candles) || candles.length < 20)
    return { ready: false, trend: "Insufficient candles", structure: "Waiting",
      liquidity: "Waiting", supply: null, demand: null, breaker: "Waiting",
      checks: [], signal: "Waiting for candles" };
  const last = candles[candles.length - 1];
  const trend = getTrend(candles), structure = getStructure(candles);
  const liquidity = getLiquidity(candles), fvg = getFVGState(candles);
  const displacement = getDisplacement(candles), zones = findStructureZones(candles);
  const bullishOB = findOrderBlock(candles, "bullish");
  const bearishOB = findOrderBlock(candles, "bearish");
  let breaker = "Not identified", bullishBreaker = false, bearishBreaker = false;
  if (bearishOB && last.close > bearishOB.high) {
    breaker = "Bullish breaker candidate"; bullishBreaker = true;
  } else if (bullishOB && last.close < bullishOB.low) {
    breaker = "Bearish breaker candidate"; bearishBreaker = true;
  }
  const demandSupport = Boolean(zones.demand && last.low <= zones.demand.high && last.close >= zones.demand.low);
  const supplyResistance = Boolean(zones.supply && last.high >= zones.supply.low && last.close <= zones.supply.high);
  const bullish = last.close > last.open, bearish = last.close < last.open;
  const bullCount = [trend === "Bullish", liquidity.sweepLow,
    structure.bosUp || structure.mssUp, displacement && bullish,
    fvg.bullishFVG || fvg.bullishIFVG, demandSupport, bullishBreaker || Boolean(bullishOB)].filter(Boolean).length;
  const bearCount = [trend === "Bearish", liquidity.sweepHigh,
    structure.bosDown || structure.mssDown, displacement && bearish,
    fvg.bearishFVG || fvg.bearishIFVG, supplyResistance, bearishBreaker || Boolean(bearishOB)].filter(Boolean).length;
  const buyReady = bullCount >= 2 && bullish &&
    (demandSupport || fvg.bullishFVG || fvg.bullishIFVG || structure.bosUp || structure.mssUp);
  const sellReady = bearCount >= 2 && bearish &&
    (supplyResistance || fvg.bearishFVG || fvg.bearishIFVG || structure.bosDown || structure.mssDown);
  const signal = buyReady ? "Potential BUY — " + bullCount + " confirmations" :
    sellReady ? "Potential SELL — " + bearCount + " confirmations" :
    "Waiting — need 2 compatible confirmations";
  const entry = last.close;
  const sl = buyReady ? Math.min(last.low, zones.demand ? zones.demand.low : last.low) :
    sellReady ? Math.max(last.high, zones.supply ? zones.supply.high : last.high) : null;
  const risk = sl === null ? null : Math.abs(entry - sl);
  const tp = risk === null ? null : (buyReady ? entry + risk * 2 : entry - risk * 2);
  const checks = [
    ["Trend direction", trend !== "Sideways" && trend !== "Unknown"],
    ["Liquidity sweep", liquidity.sweepLow || liquidity.sweepHigh],
    ["BOS / MSS / CHoCH", structure.bosUp || structure.bosDown || structure.mssUp || structure.mssDown],
    ["Strong displacement", displacement],
    ["Order Block identified", Boolean(bullishOB || bearishOB)],
    ["Supply zone identified", Boolean(zones.supply)],
    ["Demand zone identified", Boolean(zones.demand)],
    ["Breaker Block candidate", bullishBreaker || bearishBreaker],
    ["FVG / IFVG", fvg.bullishFVG || fvg.bearishFVG || fvg.bullishIFVG || fvg.bearishIFVG],
    ["Two compatible confirmations", buyReady || sellReady]
  ];
  return { ready: true, strategy: "smc", trend, structure: structure.label,
    liquidity: liquidity.label, signal, entry, sl, tp, invalidation: sl, checks,
    displacement, supply: zones.supply, demand: zones.demand, breaker,
    breakerFound: bullishBreaker || bearishBreaker,
    orderBlock: trend === "Bullish" ? bullishOB : bearishOB,
    demandSupport, supplyResistance, bullishConfirmations: bullCount,
    bearishConfirmations: bearCount,
    fvg: fvg.bullishFVG || fvg.bearishFVG,
    ifvg: fvg.bullishIFVG || fvg.bearishIFVG };
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
  const checks = [
    ["Higher-timeframe trend", higherTrend !== "Sideways" && higherTrend !== "Unknown"],
    ["POI identified (OB / flip zone / liquidity area)", bullishPOI || bearishPOI],
    ["Price reacting at POI", nearDemand || nearSupply],
    ["Liquidity pool sweep", liquidity.sweepLow || liquidity.sweepHigh],
    ["CHoCH / BOS confirmation", bullishStructure || bearishStructure],
    ["Lower-timeframe entry direction", ltfBullish || ltfBearish]
  ];
  return { ready: true, strategy: "apa", trend: higherTrend, structure: structure.label,
    liquidity: liquidity.label, signal, entry, sl, tp, invalidation: sl, checks,
    supply: zones.supply, demand: zones.demand, breaker: "SMC breaker logic is separate from APA",
    breakerFound: false, demandSupport: nearDemand, supplyResistance: nearSupply,
    displacement: getDisplacement(entryCandles) };
}

function analyseCandles(candles) {
  return tradingState.strategy === "smc" ? analyseSMC(candles) : analyseAPA(candles, candles, candles);
}

function renderTimeframeAnalysis(symbol, timeframe) {
  const candles = tradingState.candles[candleKey(symbol, timeframe)] || [];
  const result = analyseCandles(candles);

  const box = $("timeframeResults");
  if (!box) return;

  const item = document.createElement("div");
  item.className = "result-item";
  item.textContent = `${symbol} ${timeframe.toUpperCase()}: ${result.trend} | ${result.structure} | ${result.signal}`;
  box.prepend(item);

  while (box.children.length > 15) {
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
  const result = tradingState.strategy === "apa"
    ? analyseAPA(candles, higherCandles, lowerCandles)
    : analyseSMC(candles);

  if (!result.ready) return;

  setText("marketTrend", result.trend);
  setText("apaStructure", result.structure);
  setText("liquidityStatus", result.liquidity);
  setText("entrySignal", result.signal);
  setText("supplyZone", formatZone(result.supply));
  setText("demandZone", formatZone(result.demand));
  setText("breakerBlock", result.breaker);
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



  


