

"use strict";

/* =========================================================
   SMC SNIPER PRO APA
   Deriv public market data
   DEMO MONITORING ONLY
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

  scanQueue: [],
  scanTimer: null,
  lastSignals: {},
  scanGeneration: 0
};

/* =========================================================
   HELPERS
========================================================= */

const $ = id => document.getElementById(id);

const setText = (id, value) => {
  const element = $(id);
  if (element) element.textContent = String(value);
};

const valueOf = id => $(id)?.value ?? "";

function isSocketOpen() {
  return Boolean(
    tradingState.derivSocket &&
    tradingState.derivSocket.readyState === WebSocket.OPEN
  );
}

function candleKey(symbol, timeframe) {
  return `${symbol}|${timeframe}`;
}

function formatPrice(value) {
  if (value === null || value === undefined ||
      !Number.isFinite(Number(value))) {
    return "--";
  }

  return Number(value).toFixed(5)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

/* =========================================================
   STATUS AND RESULTS
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
   DERIV REQUEST SENDER
========================================================= */

function sendRequest(payload, context = null) {
  if (!isSocketOpen()) return false;

  const reqId = tradingState.requestId++;

  const request = {
    ...payload,
    req_id: reqId
  };

  if (context) {
    tradingState.requestContexts.set(reqId, context);
  }

  try {
    tradingState.derivSocket.send(JSON.stringify(request));
    return true;
  } catch (error) {
    tradingState.requestContexts.delete(reqId);
    addResult("Could not send Deriv request: " + error.message);
    return false;
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
   TIMEFRAME SETTINGS
========================================================= */

function updateMode() {
  const modeSelect = $("tradingStyle");
  const timeframeSelect = $("timeframe");

  if (!modeSelect || !timeframeSelect) return;

  const mode = TIMEFRAMES[modeSelect.value]
    ? modeSelect.value
    : "scalping";

  tradingState.mode = mode;
  modeSelect.value = mode;

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

  const selectedOption =
    modeSelect.options[modeSelect.selectedIndex];

  setText(
    "timeframeInfo",
    `${selectedOption ? selectedOption.text : mode}: ${frames
      .map(frame => frame.toUpperCase())
      .join(", ")}`
  );

  updateActiveTimeframes();
}

function updateActiveTimeframes() {
  const frames =
    TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;

  const selected = valueOf("timeframe") || frames[0];

  setText(
    "activeTimeframes",
    `Available: ${frames.map(f => f.toUpperCase()).join(", ")}. Main display: ${selected.toUpperCase()}.`
  );
}

/* =========================================================
   STRATEGY SELECTION
========================================================= */

function syncStrategy(value) {
  if (!["apa", "smc"].includes(value)) value = "apa";

  tradingState.strategy = value;

  [
    "strategySelect",
    "scannerStrategy",
    "strategySettings"
  ].forEach(id => {
    const element = $(id);
    if (element) element.value = value;
  });

  $("apaSettings")?.classList.toggle("hidden", value !== "apa");
  $("smcSettings")?.classList.toggle("hidden", value !== "smc");

  setText(
    "strategyInfo",
    value === "apa"
      ? "APA analysis selected. Price action, trend and candle confirmation are used."
      : "Trend & Market Structure selected. Structure and liquidity analysis are used."
  );
}

/* =========================================================
   BROKER PANELS
========================================================= */

function updateBrokerPanels() {
  const broker =
    valueOf("brokerType") ||
    valueOf("scannerBroker") ||
    "deriv";

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
  const existing = tradingState.derivSocket;

  if (
    existing &&
    (existing.readyState === WebSocket.OPEN ||
     existing.readyState === WebSocket.CONNECTING)
  ) {
    setConnectionStatus("Deriv connection is already active.");
    return;
  }

  if (!window.WebSocket) {
    setConnectionStatus("WebSocket is not supported by this browser.");
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

  socket.onopen = () => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = true;

    setConnectionStatus("Connected. Requesting active markets...");

    setText("cloudStatus", "Cloud engine status: Not verified");

    const sent = sendRequest({
      active_symbols: "brief"
    });

    if (!sent) {
      setConnectionStatus(
        "Connected, but could not request market symbols."
      );
    }
  };

  socket.onmessage = event => {
    if (tradingState.derivSocket !== socket) return;

    let data;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      addResult("Could not read Deriv response.");
      return;
    }

    console.log("DERIV RESPONSE:", data);
    handleDerivMessage(data);
  };

  socket.onerror = () => {
    if (tradingState.derivSocket === socket) {
      setConnectionStatus(
        "Deriv connection error. Check internet or API availability."
      );
    }
  };

  socket.onclose = event => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = false;
    tradingState.derivSocket = null;

    tradingState.requestContexts.clear();
    tradingState.candles = {};

    stopScanner(false);

    setConnectionStatus(
      "Disconnected. Code: " + event.code +
      (event.reason ? " | " + event.reason : "")
    );
  };
}

function disconnectDeriv() {
  stopScanner(false);

  const socket = tradingState.derivSocket;

  tradingState.derivConnected = false;
  tradingState.derivSocket = null;

  tradingState.requestContexts.clear();
  tradingState.candles = {};

  if (socket && socket.readyState < WebSocket.CLOSING) {
    socket.close();
  }

  setConnectionStatus("Disconnected from Deriv.");
}

/* =========================================================
   DERIV RESPONSE HANDLER
========================================================= */

function handleDerivMessage(data) {
  if (!data || typeof data !== "object") return;

  if (data.error) {
    const message = data.error.message || "Unknown Deriv API error";
    setConnectionStatus("Deriv API: " + message);
    addResult("Deriv API error: " + message);
    return;
  }

  if (Array.isArray(data.errors) && data.errors.length) {
    const message = data.errors[0].message ||
      "Deriv returned an API error.";

    setConnectionStatus("Deriv API: " + message);
    addResult("Deriv API error: " + message);
    return;
  }


  const marketData =
    data.active_symbols ||
    data.underlying_symbols ||
    data.data?.active_symbols ||
    data.data?.underlying_symbols;

  if (Array.isArray(marketData)) {
    loadMarkets(marketData);
    return;
  }


  const context = data.req_id
    ? tradingState.requestContexts.get(data.req_id)
    : null;

  if (data.msg_type === "tick" && data.tick) {
    const symbol = data.tick.symbol;
    const quote = Number(data.tick.quote);

    if (symbol && Number.isFinite(quote)) {
      tradingState.lastPrices[symbol] = quote;
      updateMarketPrice(symbol, quote);
    }
  }

  if (
    data.msg_type === "candles" &&
    Array.isArray(data.candles)
  ) {
    const candleContext =
      context || findCandleContext(data.echo_req);

    if (data.req_id) {
      tradingState.requestContexts.delete(data.req_id);
    }

    if (!candleContext) return;

    const key = candleKey(
      candleContext.symbol,
      candleContext.timeframe
    );

    tradingState.candles[key] = data.candles
      .map(normalizeCandle)
      .filter(isValidCandle)
      .slice(-150);

    renderTimeframeAnalysis(
      candleContext.symbol,
      candleContext.timeframe
    );

    analyseMainSelection(candleContext.symbol);
  }

  if (
    (data.msg_type === "ohlc" && data.ohlc) ||
    (data.msg_type === "candle" && data.candle)
  ) {
    const candleContext =
      context || findCandleContext(data.echo_req);

    if (!candleContext) return;

    const key = candleKey(
      candleContext.symbol,
      candleContext.timeframe
    );

    const list = tradingState.candles[key] || [];

    const candle = normalizeCandle(data.ohlc || data.candle);
    if (!isValidCandle(candle)) return;

    const last = list[list.length - 1];

    if (last && last.epoch === candle.epoch) {
      list[list.length - 1] = candle;
    } else {
      list.push(candle);
    }

    tradingState.candles[key] = list.slice(-150);

    renderTimeframeAnalysis(
      candleContext.symbol,
      candleContext.timeframe
    );

    analyseMainSelection(candleContext.symbol);
  }
}

function findCandleContext(echoRequest) {
  if (!echoRequest || !echoRequest.ticks_history) return null;

  const timeframe = Object.keys(GRANULARITY).find(
    frame => GRANULARITY[frame] === Number(echoRequest.granularity)
  );

  return {
    symbol: echoRequest.ticks_history,
    timeframe: timeframe || valueOf("timeframe") || "1m"
  };
}

/* =========================================================
   MARKET LOADING
========================================================= */

function loadMarkets(markets) {
  tradingState.availableSymbols = markets
    .filter(item => item && item.symbol)
    .map(item => ({
      symbol: item.symbol,
      name: item.display_name || item.symbol,
      market: item.market_display_name || item.market || "Other",
      submarket: item.submarket_display_name || item.submarket || ""
    }));

  if (!tradingState.availableSymbols.length) {
    setConnectionStatus(
      "Deriv responded, but returned zero active markets."
    );
    return;
  }

  renderMarketList();

  setConnectionStatus(
    `Connected. ${tradingState.availableSymbols.length} markets loaded.`
  );

  addResult(
    `${tradingState.availableSymbols.length} Deriv markets loaded successfully.`
  );
}

function marketCategory(item) {
  const text = `${item.market} ${item.submarket}`.toLowerCase();

  if (
    text.includes("forex") ||
    text.includes("major pairs") ||
    text.includes("minor pairs")
  ) return "Forex";

  if (
    text.includes("metal") ||
    text.includes("gold") ||
    text.includes("silver")
  ) return "Gold & Metals";

  if (
    text.includes("derived") ||
    text.includes("synthetic") ||
    text.includes("indices") ||
    text.includes("index")
  ) return "Deriv Indices";

  return "Other";
}

function renderMarketList() {
  const container = $("pairList");
  if (!container) return;

  if (!tradingState.availableSymbols.length) {
    container.textContent = "No markets loaded yet.";
    return;
  }

  const groups = [
    "Deriv Indices",
    "Forex",
    "Gold & Metals",
    "Other"
  ];

  container.replaceChildren();

  groups.forEach(group => {
    const items = tradingState.availableSymbols.filter(
      item => marketCategory(item) === group
    );

    if (!items.length) return;

    const heading = document.createElement("div");
    heading.className = "market-group-title";
    heading.style.gridColumn = "1 / -1";
    heading.style.color = "#20d69b";
    heading.style.fontWeight = "bold";
    heading.textContent = `${group} (${items.length})`;

    container.appendChild(heading);

    items.forEach(item => {
      const label = document.createElement("label");
      label.className = "market-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = item.symbol;
      checkbox.checked =
        tradingState.selectedSymbols.has(item.symbol);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          tradingState.selectedSymbols.add(item.symbol);
        } else {
          tradingState.selectedSymbols.delete(item.symbol);
        }

        updatePairCounts();
      });

      const name = document.createElement("span");
      name.textContent = item.name;

      const price = document.createElement("small");
      price.className = "market-price";
      price.id = "price-" +
        item.symbol.replace(/[^a-zA-Z0-9_-]/g, "_");
      price.textContent =
        tradingState.lastPrices[item.symbol] ?? "";

      const textWrap = document.createElement("span");
      textWrap.style.minWidth = "0";
      textWrap.append(name, price);

      label.append(checkbox, textWrap);
      container.appendChild(label);
    });
  });

  updatePairCounts();
}

function updateMarketPrice(symbol, quote) {
  const safeId = "price-" +
    symbol.replace(/[^a-zA-Z0-9_-]/g, "_");

  setText(safeId, quote);
}

function updatePairCounts() {
  const count = tradingState.selectedSymbols.size;

  setText("pairCount", count);
  setText(
    "selectedPairCount",
    `${count} pair${count === 1 ? "" : "s"} selected`
  );
}

function selectAllPairs() {
  tradingState.availableSymbols.forEach(item => {
    tradingState.selectedSymbols.add(item.symbol);
  });

  renderMarketList();
}

function clearPairs() {
  tradingState.selectedSymbols.clear();
  renderMarketList();
}

/* =========================================================
   SCANNER START / STOP
========================================================= */

function startScanner() {
  if (!isSocketOpen() || !tradingState.derivConnected) {
    addResult("Connect Deriv first. The scanner needs market data.");
    setText("scannerStatus", "Scanner: Waiting for Deriv connection");
    return;
  }

  if (!tradingState.selectedSymbols.size) {
    addResult("Select at least one market before starting.");
    return;
  }

  stopScanner(false);

  tradingState.running = true;
  tradingState.scanGeneration += 1;

  const generation = tradingState.scanGeneration;

  tradingState.strategy =
    valueOf("scannerStrategy") ||
    valueOf("strategySelect") ||
    "apa";

  syncStrategy(tradingState.strategy);

  tradingState.scanQueue = [];

  const frames =
    TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;

  tradingState.selectedSymbols.forEach(symbol => {
    frames.forEach(timeframe => {
      tradingState.scanQueue.push({
        symbol,
        timeframe,
        generation
      });
    });
  });

  setText("scannerStatus", "Scanner: Running");
  setText(
    "scannerResults",
    "Scanner started. Loading candle history..."
  );
  setText("systemStatus", "Scanning");

  updateActiveTimeframes();
  processScanQueue();
}

function processScanQueue() {
  if (!tradingState.running) return;

  if (!tradingState.scanQueue.length) {
    addResult(
      "Initial candle-history requests sent. Waiting for market updates."
    );
    tradingState.scanTimer = null;
    return;
  }

  if (!isSocketOpen()) {
    stopScanner(false);
    setText("scannerStatus", "Scanner: Connection lost");
    addResult("Scanner stopped because the Deriv connection was lost.");
    return;
  }

  const task = tradingState.scanQueue.shift();

  if (task.generation !== tradingState.scanGeneration) return;

  const payload = {
    ticks_history: task.symbol,
    adjust_start_time: 1,
    count: 100,
    end: "latest",
    style: "candles",
    granularity: GRANULARITY[task.timeframe],
    subscribe: 1
  };

  const sent = sendRequest(payload, {
    symbol: task.symbol,
    timeframe: task.timeframe
  });

  if (!sent) {
    addResult(
      `Could not request ${task.symbol} ${task.timeframe.toUpperCase()} data.`
    );
  }

  tradingState.scanTimer =
    window.setTimeout(processScanQueue, 300);
}

function stopScanner(updateStatus = true) {
  tradingState.running = false;
  tradingState.scanGeneration += 1;
  tradingState.scanQueue = [];

  if (tradingState.scanTimer) {
    window.clearTimeout(tradingState.scanTimer);
  }

  tradingState.scanTimer = null;

  setText("scannerStatus", "Scanner: Stopped");

  if (updateStatus) {
    setText(
      "systemStatus",
      tradingState.derivConnected ? "Connected" : "Not connected"
    );

    addResult("Scanner stopped. No orders were placed.");
  }
}

/* =========================================================
   CANDLE DATA
========================================================= */

function normalizeCandle(candle) {
  return {
    epoch: Number(candle.epoch),
    open: Number(candle.open),
    high: Number(candle.high),
    low: Number(candle.low),
    close: Number(candle.close)
  };
}

function isValidCandle(candle) {
  return (
    Number.isFinite(candle.epoch) &&
    Number.isFinite(candle.open) &&
    Number.isFinite(candle.high) &&
    Number.isFinite(candle.low) &&
    Number.isFinite(candle.close)
  );
}

/* =========================================================
   BASIC PRICE ANALYSIS
========================================================= */

function average(values) {
  if (!values.length) return 0;

  return values.reduce((sum, value) => sum + value, 0) /
    values.length;
}

function calculateATR(candles, period = 14) {
  if (candles.length < 2) return 0;

  const ranges = [];

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];

    ranges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }

  return average(ranges.slice(-period));
}

function analyseCandles(candles, strategy) {
  if (!Array.isArray(candles) || candles.length < 25) {
    return {
      ready: false,
      reason: "Waiting for more candle data"
    };
  }

  const closes = candles.map(candle => candle.close);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2];

  const fastAverage = average(closes.slice(-20));
  const slowAverage = average(closes.slice(-50));
  const atr = calculateATR(candles);

  const recentCandles = candles.slice(-11, -1);

  const previousHigh = Math.max(
    ...recentCandles.map(candle => candle.high)
  );

  const previousLow = Math.min(
    ...recentCandles.map(candle => candle.low)
  );

  const bullishTrend =
    fastAverage > slowAverage &&
    last.close > fastAverage;

  const bearishTrend =
    fastAverage < slowAverage &&
    last.close < fastAverage;

  const bullishCandle =
    last.close > last.open &&
    last.close > previous.close;

  const bearishCandle =
    last.close < last.open &&
    last.close < previous.close;

  const bullishBreak = last.close > previousHigh;
  const bearishBreak = last.close < previousLow;

  const sweepLow =
    last.low < previousLow &&
    last.close > previousLow;

  const sweepHigh =
    last.high > previousHigh &&
    last.close < previousHigh;

  let direction = "WAIT";
  let confirmations = [];
  let structure = "No clear structure break";
  let liquidity = "No clear sweep";

  if (strategy === "apa") {
    if (bullishTrend && bullishCandle && bullishBreak) {
      direction = "BUY CANDIDATE";
      confirmations = [
        "Bullish trend",
        "Bullish candle confirmation",
        "Recent range high broken"
      ];
      structure = "Bullish price-action breakout";

    } else if (bearishTrend && bearishCandle && bearishBreak) {
      direction = "SELL CANDIDATE";
      confirmations = [
        "Bearish trend",
        "Bearish candle confirmation",
        "Recent range low broken"
      ];
      structure = "Bearish price-action breakout";

    } else {
      confirmations = [
        bullishTrend
          ? "Bullish trend"
          : bearishTrend
            ? "Bearish trend"
            : "Trend not aligned",
        "Waiting for candle and range confirmation"
      ];
    }

  } else {
    if (sweepLow) liquidity = "Possible sell-side liquidity sweep";
    if (sweepHigh) liquidity = "Possible buy-side liquidity sweep";

    if (bullishTrend && (bullishBreak || sweepLow) && bullishCandle) {
      direction = "BUY CANDIDATE";
      structure = bullishBreak
        ? "Possible bullish BOS"
        : "Possible bullish liquidity reclaim";

      confirmations = [
        "Bullish trend",
        sweepLow ? "Possible liquidity sweep" : "Recent high break",
        "Bullish candle displacement candidate"
      ];

    } else if (
      bearishTrend &&
      (bearishBreak || sweepHigh) &&
      bearishCandle
    ) {
      direction = "SELL CANDIDATE";
      structure = bearishBreak
        ? "Possible bearish BOS"
        : "Possible bearish liquidity reclaim";

      confirmations = [
        "Bearish trend",
        sweepHigh ? "Possible liquidity sweep" : "Recent low break",
        "Bearish candle displacement candidate"
      ];

    } else {
      confirmations = [
        bullishTrend
          ? "Bullish trend"
          : bearishTrend
            ? "Bearish trend"
            : "Trend not aligned",
        liquidity,
        "Waiting for structure confirmation"
      ];
    }
  }

  const entry = last.close;
  const stopDistance = atr * 1.5;
  const targetDistance = atr * 2;

  const buy = direction.startsWith("BUY");
  const sell = direction.startsWith("SELL");

  return {
    ready: true,
    direction,
    trend: bullishTrend
      ? "Bullish"
      : bearishTrend
        ? "Bearish"
        : "Neutral / mixed",
    structure,
    liquidity,
    confirmations,
    entry: buy || sell ? entry : null,
    stopLoss: buy
      ? entry - stopDistance
      : sell
        ? entry + stopDistance
        : null,
    takeProfit: buy
      ? entry + targetDistance
      : sell
        ? entry - targetDistance
        : null,
    invalidation: buy
      ? last.low
      : sell
        ? last.high
        : null,
    atr,
    lastPrice: last.close,
    time: last.epoch
  };
}

/* =========================================================
   TIMEFRAME RESULTS
========================================================= */

function renderTimeframeAnalysis(symbol, timeframe) {
  const candles =
    tradingState.candles[candleKey(symbol, timeframe)];

  if (!candles) return;

  const result = analyseCandles(
    candles,
    tradingState.strategy
  );

  const container = $("timeframeResults");
  if (!container) return;

  const name =
    tradingState.availableSymbols.find(
      item => item.symbol === symbol
    )?.name || symbol;

  const row = document.createElement("div");
  row.className = "result-item";

  row.textContent = result.ready
    ? `${name} · ${timeframe.toUpperCase()}: ${result.trend} | ${result.direction}`
    : `${name} · ${timeframe.toUpperCase()}: ${result.reason}`;

  const key = `${symbol}-${timeframe}`.replace(
    /[^a-zA-Z0-9_-]/g,
    "_"
  );

  row.dataset.analysisKey = key;

  const old = container.querySelector(
    `[data-analysis-key="${key}"]`
  );

  if (old) {
    old.replaceWith(row);
  } else {
    if (container.textContent === "No timeframe analysis available.") {
      container.textContent = "";
    }

    container.prepend(row);
  }

  while (container.children.length > 60) {
    container.removeChild(container.lastChild);
  }
}

/* =========================================================
   MAIN ANALYSIS DISPLAY
========================================================= */

function analyseMainSelection(symbol) {
  const frames =
    TIMEFRAMES[tradingState.mode] || TIMEFRAMES.scalping;

  const timeframe = valueOf("timeframe") || frames[0];

  const candles =
    tradingState.candles[candleKey(symbol, timeframe)];

  if (!candles) return;

  const result = analyseCandles(
    candles,
    tradingState.strategy
  );

  if (!result.ready) return;

  const name =
    tradingState.availableSymbols.find(
      item => item.symbol === symbol
    )?.name || symbol;

  setText("marketTrend", `${result.trend} (${name})`);
  setText("apaStructure", result.structure);
  setText("liquidityStatus", result.liquidity);
  setText("entrySignal", result.direction);

  setText("signalEntry", formatPrice(result.entry));
  setText("signalSL", formatPrice(result.stopLoss));
  setText("signalTP", formatPrice(result.takeProfit));
  setText("signalInvalidation", formatPrice(result.invalidation));

  const checklist = $("strategyChecklist");

  if (checklist) {
    checklist.replaceChildren();

    result.confirmations.forEach(item => {
      const line = document.createElement("div");
      line.className = "result-item";
      line.textContent = "• " + item;
      checklist.appendChild(line);
    });

    const note = document.createElement("p");
    note.className = "warning";
    note.textContent =
      "Preliminary candle-based analysis only. Confirm levels and market context on your chart. This is not a verified APA/SMC trade signal.";

    checklist.appendChild(note);
  }

  const signalKey =
    `${symbol}|${timeframe}|${result.direction}|${result.time}`;

  if (
    result.direction !== "WAIT" &&
    !tradingState.lastSignals[signalKey]
  ) {
    tradingState.lastSignals[signalKey] = true;

    addResult(
      `${name} ${timeframe.toUpperCase()}: ${result.direction}. Entry ${formatPrice(result.entry)}; SL ${formatPrice(result.stopLoss)}; TP ${formatPrice(result.takeProfit)}. Analysis only; no order placed.`
    );
  }
}

/* =========================================================
   SETTINGS
========================================================= */

const SETTING_IDS = [
  "tradingStyle",
  "strategySelect",
  "scannerStrategy",
  "strategySettings",
  "apaEntryStyle",
  "useAPA",
  "useATR",
  "useAPAConfirmation",
  "useTrend",
  "useLiquidity",
  "useBOS",
  "useMSS",
  "useCHoCH",
  "useDisplacement",
  "useOB",
  "useFVG",
  "useIFVG",
  "useBreaker",
  "useSupplyDemand",
  "riskPercent",
  "lotSize",
  "stopLoss",
  "takeProfit",
  "maxTrades",
  "dailyLossLimit",
  "maxConsecutiveLosses",
  "continuousScanning",
  "multipleEntries",
  "manageTrades"
];

function saveSettings() {
  const settings = {};

  SETTING_IDS.forEach(id => {
    const element = $(id);
    if (!element) return;

    settings[id] = element.type === "checkbox"
      ? element.checked
      : element.value;
  });

  const risk = Number(valueOf("riskPercent"));
  const lot = Number(valueOf("lotSize"));
  const sl = Number(valueOf("stopLoss"));
  const tp = Number(valueOf("takeProfit"));
  const maxTrades = Number(valueOf("maxTrades"));
  const dailyLoss = Number(valueOf("dailyLossLimit"));
  const losses = Number(valueOf("maxConsecutiveLosses"));

  if (
    !(risk >= 0.1 && risk <= 1) ||
    !(lot > 0) ||
    !(sl > 0) ||
    !(tp > 0) ||
    !(maxTrades >= 1 && maxTrades <= 20) ||
    !(dailyLoss >= 0.1 && dailyLoss <= 10) ||
    !(losses >= 1 && losses <= 20)
  ) {
    setText(
      "settingsStatus",
      "Check your risk values. Risk must be 0.1–1%. Lot/stake and SL/TP must be positive."
    );
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));

    setText(
      "settingsStatus",
      "Settings saved on this device. Saving settings does not activate trading."
    );
  } catch (error) {
    setText(
      "settingsStatus",
      "Could not save settings in this browser."
    );
  }
}

function loadSettings() {
  let settings = {};

  try {
    settings = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "{}"
    );
  } catch (error) {
    settings = {};
  }

  Object.entries(settings).forEach(([id, value]) => {
    const element = $(id);
    if (!element) return;

    if (element.type === "checkbox") {
      element.checked = Boolean(value);
    } else {
      element.value = value;
    }
  });

  if (
    $("tradingStyle") &&
    !TIMEFRAMES[valueOf("tradingStyle")]
  ) {
    $("tradingStyle").value = "scalping";
  }

  updateMode();

  syncStrategy(
    valueOf("strategySettings") ||
    valueOf("strategySelect") ||
    "apa"
  );
}

/* =========================================================
   INITIALIZE APP
========================================================= */

function initializeApp() {
  // Prevent duplicate initialization if called more than once.
  if (window.smcSniperInitialized) return;
  window.smcSniperInitialized = true;

  document.querySelectorAll(".nav-btn[data-page]").forEach(button => {
    button.addEventListener("click", () => {
      showSection(button.dataset.page);
    });
  });

  $("tradingStyle")?.addEventListener("change", updateMode);

  $("timeframe")?.addEventListener("change", () => {
    updateActiveTimeframes();

    tradingState.selectedSymbols.forEach(symbol => {
      analyseMainSelection(symbol);
    });
  });

  [
    "strategySelect",
    "scannerStrategy",
    "strategySettings"
  ].forEach(id => {
    $(id)?.addEventListener("change", event => {
      syncStrategy(event.target.value);
    });
  });

  $("brokerType")?.addEventListener(
    "change",
    updateBrokerPanels
  );

  $("scannerBroker")?.addEventListener("change", event => {
    if ($("brokerType")) {
      $("brokerType").value = event.target.value;
    }

    updateBrokerPanels();
  });

  // DERIV CONNECT BUTTON: one listener only.
  $("connectDeriv")?.addEventListener(
    "click",
    connectDeriv
  );

  $("disconnectDeriv")?.addEventListener(
    "click",
    disconnectDeriv
  );

  $("selectAllPairs")?.addEventListener(
    "click",
    selectAllPairs
  );

  $("clearPairs")?.addEventListener(
    "click",
    clearPairs
  );

  $("startScanner")?.addEventListener(
    "click",
    startScanner
  );

  $("scannerStartButton")?.addEventListener("click", () => {
    showSection("scanner");
    startScanner();
  });

  $("stopScanner")?.addEventListener(
    "click",
    () => stopScanner(true)
  );

  $("scannerStopButton")?.addEventListener(
    "click",
    () => stopScanner(true)
  );

  $("saveSettings")?.addEventListener(
    "click",
    saveSettings
  );

  $("connectMT5")?.addEventListener("click", () => {
    setText(
      "mt5ConnectionStatus",
      "MT5 bridge is not configured. A separate secure server and MT5 terminal are required."
    );
  });

  loadSettings();
  updateBrokerPanels();
  syncStrategy(tradingState.strategy);
  updatePairCounts();

  setConnectionStatus(
    "Not connected. Connect Deriv to load public markets."
  );

  setText("cloudStatus", "Cloud engine status: Not verified");
  setText("scannerStatus", "Scanner: Stopped");
  setText("timeframeResults", "No timeframe analysis available.");
  setText(
    "positionsList",
    "No positions available. Order execution is disabled."
  );
  setText("tradeHistory", "No completed trades available.");
  setText("openTrades", "0");
  setText("scannerResults", "Scanner has not started.");

  console.log("SMC Sniper Pro APA initialized successfully.");
}

/* =========================================================
   START APPLICATION - RUN ONCE
========================================================= */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp,
    { once: true }
  );
} else {
  initializeApp();
}

  


