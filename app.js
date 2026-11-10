"use strict";

/* =====================================================
   SMC SNIPER PRO APA
   Deriv public market data
   DEMO MONITORING ONLY
   LIVE TRADING LOCKED
   NO ORDER EXECUTION
===================================================== */

const DERIV_PUBLIC_WS =
  "wss://ws.derivws.com/websockets/v3";

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
  selectedSymbols: [],
  lastPrices: {},
  subscriptions: {},
  candles: {},
  requestId: 0,
  reconnectTimer: null
};

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

const $ = id => document.getElementById(id);

/* =====================================================
   GENERAL HELPERS
===================================================== */

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = value;
}

function addResult(message) {
  const box = $("scannerResults");
  if (!box) return;

  const item = document.createElement("div");
  item.className = "result-item";
  item.textContent = message;

  box.prepend(item);

  while (box.children.length > 60) {
    box.removeChild(box.lastChild);
  }
}

function setConnectionStatus(message) {
  setText("derivConnectionStatus", message);
  setText("brokerStatus", "Broker: " + message);
}

function nextId() {
  tradingState.requestId += 1;
  return tradingState.requestId;
}

function sendRequest(payload) {
  const socket = tradingState.derivSocket;

  if (
    !socket ||
    socket.readyState !== WebSocket.OPEN
  ) {
    return false;
  }

  try {
    socket.send(JSON.stringify({
      ...payload,
      req_id: nextId()
    }));

    return true;
  } catch (error) {
    addResult("Request failed: " + error.message);
    return false;
  }
}

/* =====================================================
   NAVIGATION
===================================================== */

function showSection(pageId) {
  const target = $(pageId);

  if (!target || !target.classList.contains("page")) {
    return;
  }

  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle(
      "active",
      page.id === pageId
    );
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.toggle(
      "active",
      button.dataset.page === pageId
    );
  });
}

/* =====================================================
   TRADING STYLE AND TIMEFRAMES
===================================================== */

function getSelectedTimeframes() {
  return TIMEFRAMES[tradingState.mode] ||
    TIMEFRAMES.scalping;
}

function updateMode() {
  const style = $("tradingStyle");
  const timeframe = $("timeframe");

  if (style && TIMEFRAMES[style.value]) {
    tradingState.mode = style.value;
  }

  const frames = getSelectedTimeframes();

  if (timeframe) {
    const previousValue = timeframe.value;

    timeframe.innerHTML = "";

    frames.forEach(frame => {
      const option = document.createElement("option");

      option.value = frame;
      option.textContent = frame.toUpperCase();

      timeframe.appendChild(option);
    });

    timeframe.value = frames.includes(previousValue)
      ? previousValue
      : frames[0];
  }

  setText(
    "timeframeInfo",
    "Automatic analysis: " +
    frames.map(frame => frame.toUpperCase()).join(", ")
  );

  setText(
    "activeTimeframes",
    "Selected timeframes: " +
    frames.map(frame => frame.toUpperCase()).join(", ")
  );
}

/* =====================================================
   STRATEGY SELECTION
===================================================== */

function updateStrategy(value) {
  const requested = value ||
    $("strategySelect")?.value ||
    tradingState.strategy;

  tradingState.strategy =
    requested === "smc" ? "smc" : "apa";

  [
    "strategySelect",
    "scannerStrategy",
    "strategySettings"
  ].forEach(id => {
    const field = $(id);

    if (field) {
      field.value = tradingState.strategy;
    }
  });

  const name = tradingState.strategy === "apa"
    ? "APA — Advanced Price Action"
    : "Trend & Market Structure";

  setText(
    "strategyInfo",
    "Selected strategy: " + name
  );

  updateStrategySettings();
}

function updateStrategySettings() {
  const strategy =
    $("strategySettings")?.value ||
    tradingState.strategy;

  const apa = $("apaSettings");
  const smc = $("smcSettings");

  if (apa) {
    apa.classList.toggle("hidden", strategy !== "apa");
  }

  if (smc) {
    smc.classList.toggle("hidden", strategy !== "smc");
  }
}

/* =====================================================
   BROKER PANELS
===================================================== */

function updateBrokerPanels() {
  const type = $("brokerType")?.value || "deriv";

  const deriv = $("derivPanel");
  const mt5 = $("mt5Panel");

  if (deriv) {
    deriv.classList.toggle("hidden", type !== "deriv");
  }

  if (mt5) {
    mt5.classList.toggle("hidden", type !== "mt5");
  }

  tradingState.broker = type;

  if (type === "mt5") {
    setText(
      "mt5ConnectionStatus",
      "MT5 bridge is not configured."
    );
  }
}

/* =====================================================
   DERIV CONNECTION
===================================================== */

function connectDeriv() {
  if (
    tradingState.derivSocket &&
    (
      tradingState.derivSocket.readyState === WebSocket.OPEN ||
      tradingState.derivSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    setConnectionStatus("Connection already active.");
    return;
  }

  const appId = $("derivAppId")?.value.trim();

  if (!appId) {
    setConnectionStatus("Enter your Deriv App ID first.");
    return;
  }

  if (!window.WebSocket) {
    setConnectionStatus("WebSocket is not supported.");
    return;
  }

  clearTimeout(tradingState.reconnectTimer);

  setConnectionStatus("Connecting to Deriv...");

  let socket;

  try {
    socket = new WebSocket(
      DERIV_PUBLIC_WS +
      "?app_id=" +
      encodeURIComponent(appId)
    );
  } catch (error) {
    setConnectionStatus(
      "Connection error: " + error.message
    );
    return;
  }

  tradingState.derivSocket = socket;

  socket.onopen = () => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = true;

    setConnectionStatus(
      "Connected. Loading Deriv markets..."
    );

    setText("systemStatus", "Connected");
    setText("cloudStatus", "Cloud engine: Not verified");

    sendRequest({
      active_symbols: "brief",
      product_type: "basic"
    });
  };

  socket.onmessage = event => {
    let data;

    try {
      data = JSON.parse(event.data);
    } catch {
      return;
    }

    handleDerivMessage(data);
  };

  socket.onerror = () => {
    if (tradingState.derivSocket === socket) {
      setConnectionStatus("Deriv connection error.");
    }
  };

  /* =====================================================
   DERIV CONNECTION
===================================================== */

function connectDeriv() {
  if (
    tradingState.derivSocket &&
    (
      tradingState.derivSocket.readyState === WebSocket.OPEN ||
      tradingState.derivSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    setConnectionStatus("Connection already active.");
    return;
  }

  const appId = $("derivAppId")?.value.trim();

  if (!appId) {
    setConnectionStatus("Enter your Deriv App ID first.");
    return;
  }

  if (!window.WebSocket) {
    setConnectionStatus("WebSocket is not supported.");
    return;
  }

  clearTimeout(tradingState.reconnectTimer);

  setConnectionStatus("Connecting to Deriv...");

  let socket;

  try {
    socket = new WebSocket(
      DERIV_PUBLIC_WS +
      "?app_id=" +
      encodeURIComponent(appId)
    );
  } catch (error) {
    setConnectionStatus(
      "Connection error: " + error.message
    );
    return;
  }

  tradingState.derivSocket = socket;

  socket.onopen = () => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = true;

    setConnectionStatus(
      "Connected. Loading Deriv markets..."
    );

    setText("systemStatus", "Connected");
    setText("cloudStatus", "Cloud engine: Not verified");

    sendRequest({
      active_symbols: "brief",
      product_type: "basic"
    });
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

    handleDerivMessage(data);
  };

  socket.onerror = () => {
    if (tradingState.derivSocket === socket) {
      setConnectionStatus("Deriv connection error.");
    }
  };

  /* Only ONE close handler */

  socket.onclose = event => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = false;
    tradingState.derivSocket = null;
    tradingState.subscriptions = {};
    tradingState.candles = {};

    const reason = event.reason || "No reason provided";

    setConnectionStatus(
      "Disconnected. Code: " +
      event.code +
      " | " +
      reason
    );

    setText("systemStatus", "Disconnected");

    if (tradingState.running) {
      stopScanner();
    }
  };
}
  if (tradingState.derivSocket !== socket) return;

  tradingState.derivConnected = false;
  tradingState.derivSocket = null;
  tradingState.subscriptions = {};
  tradingState.candles = {};

  const reason = event.reason || "No reason provided";

  setConnectionStatus(
    "Disconnected. Code: " +
    event.code +
    " | " +
    reason
  );

  setText("systemStatus", "Disconnected");

  if (tradingState.running) {
    stopScanner();
  }
};
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = false;
    tradingState.derivSocket = null;
    tradingState.subscriptions = {};
    tradingState.candles = {};

    setConnectionStatus("Disconnected.");
    setText("systemStatus", "Disconnected");

    if (tradingState.running) {
      stopScanner();
    }
  };
}

function disconnectDeriv() {
  clearTimeout(tradingState.reconnectTimer);

  stopScanner();

  const socket = tradingState.derivSocket;

  tradingState.derivSocket = null;
  tradingState.derivConnected = false;

  if (socket) {
    socket.close();
  }

  tradingState.availableSymbols = [];
  tradingState.selectedSymbols = [];
  tradingState.lastPrices = {};
  tradingState.subscriptions = {};
  tradingState.candles = {};

  renderMarkets();

  setConnectionStatus("Disconnected.");
  setText("systemStatus", "Disconnected");
  setText("pairCount", "0");
}

/* =====================================================
   DERIV MESSAGE HANDLING
===================================================== */

function handleDerivMessage(data) {
  if (data.error) {
    addResult(
      "Deriv error: " + data.error.message
    );
    return;
  }

  if (data.active_symbols) {
    loadMarkets(data.active_symbols);
    return;
  }

  if (data.msg_type === "tick" && data.tick) {
    handleTick(data.tick);
    return;
  }

  if (
    data.msg_type === "history" &&
    (data.candles || data.history)
  ) {
    handleHistory(data);
    return;
  }

  if (data.msg_type === "candles" && data.candles) {
    handleCandles(data);
  }
}

/* =====================================================
   MARKET CATEGORIES
===================================================== */

function marketCategory(item) {
  const name = (
    (item.display_name || "") +
    " " +
    (item.symbol || "")
  ).toLowerCase();

  if (
    name.includes("volatility") ||
    name.includes("boom") ||
    name.includes("crash") ||
    name.includes("jump") ||
    name.includes("step") ||
    name.includes("range break")
  ) {
    return "Deriv Indices";
  }

  if (
    name.includes("gold") ||
    name.includes("xau") ||
    name.includes("silver") ||
    name.includes("xag")
  ) {
    return "Gold & Metals";
  }

  if (
    item.market === "forex" ||
    name.includes("forex")
  ) {
    return "Forex";
  }

  return "Other";
}

function loadMarkets(symbols) {
  if (!Array.isArray(symbols)) return;

  tradingState.availableSymbols = symbols
    .filter(item => item.symbol && item.display_name)
    .map(item => ({
      symbol: item.symbol,
      name: item.display_name,
      category: marketCategory(item)
    }));

  const validSymbols = new Set(
    tradingState.availableSymbols.map(item => item.symbol)
  );

  tradingState.selectedSymbols =
    tradingState.selectedSymbols.filter(
      symbol => validSymbols.has(symbol)
    );

  renderMarkets();

  setText(
    "systemStatus",
    "Connected — " +
    tradingState.availableSymbols.length +
    " markets"
  );

  setConnectionStatus(
    "Connected. " +
    tradingState.availableSymbols.length +
    " markets loaded successfully."
  );

  addResult(
    tradingState.availableSymbols.length +
    " Deriv markets loaded."
  );
}

/* =====================================================
   MARKET DISPLAY
===================================================== */

function renderMarkets() {
  const box = $("pairList");
  if (!box) return;

  box.innerHTML = "";

  if (!tradingState.availableSymbols.length) {
    box.textContent = "No markets loaded yet.";
    updatePairCount();
    return;
  }

  const categories = [
    "Deriv Indices",
    "Forex",
    "Gold & Metals",
    "Other"
  ];

  categories.forEach(category => {
    const group = tradingState.availableSymbols.filter(
      item => item.category === category
    );

    if (!group.length) return;

    const heading = document.createElement("h4");

    heading.textContent = category;
    heading.style.gridColumn = "1 / -1";

    box.appendChild(heading);

    group.forEach(item => {
      const label = document.createElement("label");
      label.className = "market-option";

      const checkbox = document.createElement("input");

      checkbox.type = "checkbox";
      checkbox.value = item.symbol;

      checkbox.checked =
        tradingState.selectedSymbols.includes(item.symbol);

      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          if (
            !tradingState.selectedSymbols.includes(item.symbol)
          ) {
            tradingState.selectedSymbols.push(item.symbol);
          }
        } else {
          tradingState.selectedSymbols =
            tradingState.selectedSymbols.filter(
              symbol => symbol !== item.symbol
            );
        }

        updatePairCount();
      });

      const name = document.createElement("span");

      name.textContent = item.name;

      label.append(checkbox, name);
      box.appendChild(label);
    });
  });

  updatePairCount();
}

function updatePairCount() {
  const count = tradingState.selectedSymbols.length;

  setText(
    "selectedPairCount",
    count + " pairs selected"
  );

  setText("pairCount", count);
}

function selectAllPairs() {
  tradingState.selectedSymbols =
    tradingState.availableSymbols.map(item => item.symbol);

  renderMarkets();
}

function clearPairs() {
  tradingState.selectedSymbols = [];
  renderMarkets();
}

/* =====================================================
   LIVE TICK DATA
===================================================== */

function subscribeToTick(symbol) {
  if (tradingState.subscriptions[symbol]) return;

  const sent = sendRequest({
    ticks: symbol,
    subscribe: 1
  });

  if (sent) {
    tradingState.subscriptions[symbol] = true;
  }
}

function handleTick(tick) {
  if (!tick.symbol) return;

  tradingState.lastPrices[tick.symbol] = tick.quote;

  const market = tradingState.availableSymbols.find(
    item => item.symbol === tick.symbol
  );

  if (market) {
    market.price = tick.quote;
  }

  if (tradingState.running) {
    addLivePrice(tick.symbol, tick.quote);
  }
}

function addLivePrice(symbol, price) {
  const market = tradingState.availableSymbols.find(
    item => item.symbol === symbol
  );

  const name = market ? market.name : symbol;
  const box = $("scannerResults");

  if (!box) return;

  let row = Array.from(
    box.querySelectorAll("[data-market-symbol]")
  ).find(
    item => item.dataset.marketSymbol === symbol
  );

  if (!row) {
    row = document.createElement("div");
    row.className = "result-item";
    row.dataset.marketSymbol = symbol;

    box.prepend(row);
  }

  row.textContent =
    name +
    " | Live price: " +
    price +
    " | Waiting for candle analysis";
}

/* =====================================================
   CANDLE SUBSCRIPTIONS
===================================================== */

function subscribeToCandles(symbol, timeframe) {
  const key = symbol + "_" + timeframe;

  if (tradingState.candles[key]?.requested) {
    return;
  }

  const granularity = GRANULARITY[timeframe];

  if (!granularity) return;

  const sent = sendRequest({
    ticks_history: symbol,
    adjust_start_time: 1,
    count: 100,
    end: "latest",
    granularity,
    style: "candles",
    subscribe: 1
  });

  if (sent) {
    tradingState.candles[key] = {
      requested: true,
      data: []
    };
  }
}

/* =====================================================
   CANDLE HISTORY
===================================================== */

function findTimeframe(data) {
  const granularity = Number(
    data.echo_req?.granularity
  );

  return Object.keys(GRANULARITY).find(
    timeframe =>
      GRANULARITY[timeframe] === granularity
  );
}

function handleHistory(data) {
  const symbol = data.echo_req?.ticks_history;
  const timeframe = findTimeframe(data);

  if (!symbol || !timeframe) return;

  const key = symbol + "_" + timeframe;

  const candles =
    data.candles ||
    data.history?.candles ||
    [];

  tradingState.candles[key] = {
    requested: true,
    data: Array.isArray(candles) ? candles : []
  };

  analyseCandles(symbol, timeframe);
}

function handleCandles(data) {
  const symbol = data.echo_req?.ticks_history;
  const timeframe = findTimeframe(data);

  if (!symbol || !timeframe) return;

  const key = symbol + "_" + timeframe;

  const incoming = Array.isArray(data.candles)
    ? data.candles
    : [];

  const existing =
    tradingState.candles[key]?.data || [];

  const combined = new Map();

  existing.forEach(candle => {
    combined.set(
      Number(candle.epoch),
      candle
    );
  });

  incoming.forEach(candle => {
    combined.set(
      Number(candle.epoch),
      candle
    );
  });

  const updated = Array.from(combined.values())
    .sort((a, b) => Number(a.epoch) - Number(b.epoch))
    .slice(-150);

  tradingState.candles[key] = {
    requested: true,
    data: updated
  };

  analyseCandles(symbol, timeframe);
}

/* =====================================================
   PRELIMINARY CANDLE ANALYSIS
===================================================== */

function analyseCandles(symbol, timeframe) {
  const key = symbol + "_" + timeframe;

  const candles =
    tradingState.candles[key]?.data || [];

  if (candles.length < 20) return;

  const recent = candles.slice(-20);

  const last = recent[recent.length - 1];
  const previous = recent[recent.length - 2];

  const closes = recent.map(
    candle => Number(candle.close)
  );

  const highs = recent.map(
    candle => Number(candle.high)
  );

  const lows = recent.map(
    candle => Number(candle.low)
  );

  if (
    closes.some(value => !Number.isFinite(value)) ||
    highs.some(value => !Number.isFinite(value)) ||
    lows.some(value => !Number.isFinite(value))
  ) {
    return;
  }

  const average =
    closes.reduce((sum, value) => sum + value, 0) /
    closes.length;

  const current = Number(last.close);

  let trend = "SIDEWAYS";

  if (current > average) trend = "BULLISH";
  if (current < average) trend = "BEARISH";

  const high = Math.max(...highs.slice(0, -2));
  const low = Math.min(...lows.slice(0, -2));

  let structure = "RANGE";

  if (current > high) {
    structure = "POSSIBLE BULLISH BREAK";
  }

  if (current < low) {
    structure = "POSSIBLE BEARISH BREAK";
  }

  const body = Math.abs(
    Number(last.close) - Number(last.open)
  );

  const range = Math.abs(
    Number(last.high) - Number(last.low)
  );

  const displacement =
    range > 0 && body / range >= 0.7;

  const result = {
    trend,
    structure,
    displacement,
    candleDirection:
      Number(last.close) > Number(last.open)
        ? "BULLISH"
        : Number(last.close) < Number(last.open)
          ? "BEARISH"
          : "NEUTRAL",
    previousClose: Number(previous.close)
  };

  displayAnalysis(symbol, timeframe, result);
}

/* =====================================================
   ANALYSIS DISPLAY
===================================================== */

function displayAnalysis(symbol, timeframe, result) {
  setText("marketTrend", result.trend);
  setText("apaStructure", result.structure);

  setText(
    "liquidityStatus",
    "Requires further confirmation"
  );

  setText(
    "entrySignal",
    "No verified entry"
  );

  const checklist = $("strategyChecklist");

  if (checklist) {
    checklist.textContent =
      "Preliminary candle analysis only. " +
      "Trend: " + result.trend +
      " | Structure: " + result.structure +
      " | Displacement candle: " +
      (result.displacement ? "Yes" : "No") +
      ". APA/SMC confirmation is not yet complete.";
  }

  const box = $("timeframeResults");

  if (box) {
    const item = document.createElement("div");

    item.className = "result-item";

    item.textContent =
      symbol +
      " " +
      timeframe.toUpperCase() +
      " | Trend: " +
      result.trend +
      " | Structure: " +
      result.structure;

    box.prepend(item);

    while (box.children.length > 40) {
      box.removeChild(box.lastChild);
    }
  }
}

/* =====================================================
   SCANNER
===================================================== */

function startScanner() {
  if (!tradingState.derivConnected) {
    addResult(
      "Connect Deriv before starting the scanner."
    );
    return;
  }

  if (!tradingState.selectedSymbols.length) {
    addResult("Select at least one market.");
    return;
  }

  const dashboardStyle = $("tradingStyle");

  if (
    dashboardStyle &&
    TIMEFRAMES[dashboardStyle.value]
  ) {
    tradingState.mode = dashboardStyle.value;
  }

  const scannerStrategy = $("scannerStrategy");

  if (scannerStrategy) {
    tradingState.strategy =
      scannerStrategy.value === "smc" ? "smc" : "apa";
  }

  updateMode();
  updateStrategy(tradingState.strategy);

  tradingState.running = true;

  const results = $("scannerResults");

  if (results) {
    results.innerHTML = "";
  }

  setText("scannerStatus", "Scanner: Running");
  setText("systemStatus", "Scanner running");

  setText(
    "activeTimeframes",
    "Scanning " +
    getSelectedTimeframes().join(", ")
  );

  addResult(
    "Scanner started in " +
    tradingState.mode +
    " mode using " +
    tradingState.strategy.toUpperCase() +
    "."
  );

  const frames = getSelectedTimeframes();

  tradingState.selectedSymbols.forEach(symbol => {
    subscribeToTick(symbol);

    frames.forEach(frame => {
      subscribeToCandles(symbol, frame);
    });
  });
}

function stopScanner() {
  tradingState.running = false;

  setText("scannerStatus", "Scanner: Stopped");

  addResult("Scanner stopped.");
}

/* =====================================================
   SETTINGS
===================================================== */

const SETTINGS_FIELDS = [
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

  for (const id of SETTINGS_FIELDS) {
    const field = $(id);

    if (!field) continue;

    settings[id] = field.type === "checkbox"
      ? field.checked
      : field.value;
  }

  settings.strategy =
    $("strategySettings")?.value || "apa";

  settings.mode =
    $("tradingStyle")?.value || "scalping";

  const risk = Number(settings.riskPercent);
  const lot = Number(settings.lotSize);
  const sl = Number(settings.stopLoss);
  const tp = Number(settings.takeProfit);
  const maxTrades = Number(settings.maxTrades);
  const dailyLimit = Number(settings.dailyLossLimit);
  const maxLosses = Number(settings.maxConsecutiveLosses);

  if (
    !Number.isFinite(risk) ||
    risk <= 0 ||
    risk > 1
  ) {
    setText(
      "settingsStatus",
      "Risk must be above 0 and no more than 1%."
    );
    return;
  }

  if (
    !Number.isFinite(lot) ||
    lot <= 0 ||
    !Number.isFinite(sl) ||
    sl <= 0 ||
    !Number.isFinite(tp) ||
    tp <= 0 ||
    !Number.isInteger(maxTrades) ||
    maxTrades < 1 ||
    maxTrades > 20 ||
    !Number.isFinite(dailyLimit) ||
    dailyLimit <= 0 ||
    dailyLimit > 10 ||
    !Number.isInteger(maxLosses) ||
    maxLosses < 1 ||
    maxLosses > 20
  ) {
    setText(
      "settingsStatus",
      "Check your risk settings."
    );
    return;
  }

  try {
    localStorage.setItem(
      "smcSniperSettings",
      JSON.stringify(settings)
    );

    tradingState.strategy = settings.strategy;

    setText(
      "settingsStatus",
      "Settings saved on this device. No orders are enabled."
    );

    updateStrategySettings();
  } catch {
    setText(
      "settingsStatus",
      "Unable to save settings on this device."
    );
  }
}

function loadSettings() {
  try {
    const saved = JSON.parse(
      localStorage.getItem("smcSniperSettings") || "{}"
    );

    Object.entries(saved).forEach(([id, value]) => {
      const field = $(id);

      if (!field) return;

      if (field.type === "checkbox") {
        field.checked = Boolean(value);
      } else {
        field.value = value;
      }
    });

    if (saved.strategy) {
      tradingState.strategy =
        saved.strategy === "smc" ? "smc" : "apa";

      if ($("strategySelect")) {
        $("strategySelect").value = tradingState.strategy;
      }

      if ($("scannerStrategy")) {
        $("scannerStrategy").value = tradingState.strategy;
      }

      if ($("strategySettings")) {
        $("strategySettings").value = tradingState.strategy;
      }
    }

    if (
      saved.mode &&
      TIMEFRAMES[saved.mode] &&
      $("tradingStyle")
    ) {
      $("tradingStyle").value = saved.mode;
      tradingState.mode = saved.mode;
    }
  } catch {
    setText("settingsStatus", "Using default settings.");
  }

  updateMode();
  updateStrategy(tradingState.strategy);
}

/* =====================================================
   DEMO-ONLY PROTECTION
===================================================== */

function enforceDemoOnly() {
  tradingState.demo = true;
  tradingState.liveLocked = true;

  const execution = $("executionMode");

  if (execution) {
    execution.value = "demo";
  }

  const lock = $("liveLock");

  if (lock) {
    lock.disabled = true;
    lock.textContent = "LIVE TRADING LOCKED";
  }
}

/* =====================================================
   INITIALIZATION
===================================================== */

function initializeApp() {
  /* Navigation */

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click", () => {
      showSection(button.dataset.page);
    });
  });

  /* Trading style */

  $("tradingStyle")?.addEventListener(
    "change",
    updateMode
  );

  /* Strategy selection */

  $("strategySelect")?.addEventListener(
    "change",
    event => updateStrategy(event.target.value)
  );

  $("scannerStrategy")?.addEventListener(
    "change",
    event => updateStrategy(event.target.value)
  );

  $("strategySettings")?.addEventListener(
    "change",
    event => updateStrategy(event.target.value)
  );

  /* Broker selection */

  $("brokerType")?.addEventListener(
    "change",
    updateBrokerPanels
  );

  /* Deriv */

  $("connectDeriv")?.addEventListener(
    "click",
    connectDeriv
  );

  $("disconnectDeriv")?.addEventListener(
    "click",
    disconnectDeriv
  );

  /* Market selection */

  $("selectAllPairs")?.addEventListener(
    "click",
    selectAllPairs
  );

  $("clearPairs")?.addEventListener(
    "click",
    clearPairs
  );

  /* Scanner controls */

  $("startScanner")?.addEventListener(
    "click",
    startScanner
  );

  $("scannerStartButton")?.addEventListener(
    "click",
    () => {
      showSection("scanner");
      startScanner();
    }
  );

  $("stopScanner")?.addEventListener(
    "click",
    stopScanner
  );

  $("scannerStopButton")?.addEventListener(
    "click",
    stopScanner
  );

  /* Settings */

  $("saveSettings")?.addEventListener(
    "click",
    saveSettings
  );

  /* MT5 placeholder */

  $("connectMT5")?.addEventListener(
    "click",
    () => {
      setText(
        "mt5ConnectionStatus",
        "MT5 bridge is not configured. No connection established."
      );
    }
  );

  $("scannerBroker")?.addEventListener(
    "change",
    event => {
      if (event.target.value === "mt5") {
        addResult(
          "MT5 requires a separately configured secure bridge."
        );
      }
    }
  );

  /* Start the application */

  enforceDemoOnly();

  loadSettings();

  updateBrokerPanels();

  setText("systemStatus", "Not connected");
  setText("pairCount", "0");
  setText("openTrades", "0");
  setText("scannerStatus", "Scanner: Stopped");
  setText("cloudStatus", "Cloud engine: Not verified");
  setText("positionsList", "No positions available.");
  setText("tradeHistory", "No completed trades available.");

  addResult(
    "SMC Sniper Pro APA initialized. Demo monitoring only."
  );
}

/* =====================================================
   START APPLICATION
===================================================== */

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeApp,
    { once: true }
  );
} else {
  initializeApp();
}
  


