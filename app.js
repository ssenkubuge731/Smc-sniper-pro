

"use strict";

/* SMC SNIPER PRO APA
   Public market data + demo monitoring only.
   No order placement. Live trading is permanently locked.
*/

const DERIV_PUBLIC_WS = "wss://api.derivws.com/trading/v1/options/ws/public";

const tradingState = {
  mode: "scalping",
  broker: "deriv",
  demo: true,
  liveLocked: true,
  running: false,
  derivConnected: false,
  mt5Connected: false,
  derivSocket: null,
  availableSymbols: [],
  selectedSymbols: [],
  lastPrices: Object.create(null),
  subscriptions: Object.create(null),
  requestId: 1,
  marketTimer: null
};

/* HELPERS */

function el(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = String(value);
}

function setStatus(id, value) {
  setText(id, value);
}

function nextRequestId() {
  return tradingState.requestId++;
}

function sendRequest(payload) {
  const socket = tradingState.derivSocket;

  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  try {
    socket.send(JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error("Deriv send failed:", error);
    return false;
  }
}

function enforceDemoOnly() {
  tradingState.demo = true;
  tradingState.liveLocked = true;

  const mode = el("executionMode");
  if (mode) mode.value = "demo";

  const live = el("liveLock");
  if (live) {
    live.textContent = "LIVE TRADING LOCKED";
    live.disabled = true;
  }

  const liveOption = document.querySelector(
    '#executionMode option[value="live"]'
  );

  if (liveOption) liveOption.disabled = true;
}

/* NAVIGATION */

function showSection(name) {
  document.querySelectorAll(".page").forEach(page => {
    page.style.display = "none";
    page.classList.remove("active");
  });

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.remove("active");
  });

  const page = el(name);

  if (page) {
    page.style.display = "block";
    page.classList.add("active");
  }

  const button = document.querySelector(
    '.nav-btn[data-page="' + name + '"]'
  );

  if (button) button.classList.add("active");
}

/* TRADING STYLES */

function updateMode() {
  const selector = el("tradingStyle");
  const timeframe = el("timeframe");

  if (!selector || !timeframe) return;

  tradingState.mode = selector.value || "scalping";

  const modes = {
    scalping: ["M1", "M5", "M15"],
    intraday: ["M30", "H1", "H4"],
    swing: ["H1", "H4", "D1"]
  };

  const choices = modes[tradingState.mode] || modes.scalping;
  const previous = timeframe.value;

  timeframe.replaceChildren();

  choices.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    timeframe.appendChild(option);
  });

  timeframe.value = choices.includes(previous)
    ? previous
    : choices[0];
}

/* BROKER PANELS */

function updateBrokerPanels() {
  const selector = el("brokerType");
  if (!selector) return;

  tradingState.broker = selector.value || "deriv";

  const derivPanel = el("derivPanel");
  const mt5Panel = el("mt5Panel");

  if (derivPanel) {
    const show = tradingState.broker === "deriv";
    derivPanel.classList.toggle("hidden", !show);
    derivPanel.style.display = show ? "block" : "none";
  }

  if (mt5Panel) {
    const show = tradingState.broker === "mt5";
    mt5Panel.classList.toggle("hidden", !show);
    mt5Panel.style.display = show ? "block" : "none";
  }
}

function updateScannerBroker() {
  const selector = el("scannerBroker");

  if (selector && selector.value === "mt5") {
    setStatus(
      "scannerStatus",
      "MT5 bridge is not configured. Select Deriv to scan public markets."
    );
  } else if (!tradingState.running) {
    setStatus("scannerStatus", "Scanner stopped.");
  }
}

/* DERIV CONNECTION */

function connectDeriv() {
  if (typeof WebSocket === "undefined") {
    setStatus(
      "derivConnectionStatus",
      "This browser does not support WebSocket."
    );
    return;
  }

  const current = tradingState.derivSocket;

  if (
    current &&
    (
      current.readyState === WebSocket.OPEN ||
      current.readyState === WebSocket.CONNECTING
    )
  ) {
    setStatus(
      "derivConnectionStatus",
      "Deriv is already connected or connecting."
    );
    return;
  }

  tradingState.availableSymbols = [];
  tradingState.subscriptions = Object.create(null);

  renderMarkets();

  setStatus(
    "derivConnectionStatus",
    "Connecting to Deriv public market data..."
  );

  let socket;

  try {
    socket = new WebSocket(DERIV_PUBLIC_WS);
  } catch (error) {
    setStatus(
      "derivConnectionStatus",
      "Could not open Deriv connection: " + error.message
    );
    return;
  }

  tradingState.derivSocket = socket;

  socket.onopen = () => {
    if (tradingState.derivSocket !== socket) return;

    tradingState.derivConnected = true;

    setStatus(
      "derivConnectionStatus",
      "Connected. Requesting available markets..."
    );

    setStatus(
      "brokerStatus",
      "Deriv public market data connected."
    );

    const reqId = nextRequestId();

    if (!sendRequest({
      active_symbols: "brief",
      req_id: reqId
    })) {
      setStatus(
        "derivConnectionStatus",
        "Connected, but the market request could not be sent."
      );
      return;
    }

    clearTimeout(tradingState.marketTimer);

    tradingState.marketTimer = setTimeout(() => {
      if (
        tradingState.derivSocket === socket &&
        tradingState.availableSymbols.length === 0
      ) {
        setStatus(
          "derivConnectionStatus",
          "No market list received within 15 seconds. Check connection and retry."
        );
      }
    }, 15000);

    updateDashboard();
  };

  socket.onmessage = event => {
    if (tradingState.derivSocket !== socket) return;

    let data;

    try {
      data = JSON.parse(event.data);
    } catch (error) {
      console.error("Unparseable Deriv message:", event.data);
      setStatus(
        "derivConnectionStatus",
        "Deriv sent an unreadable response. See browser log."
      );
      return;
    }

    console.log("Deriv response:", data);
    handleDerivMessage(data);
  };

  socket.onerror = error => {
    console.error("Deriv WebSocket error:", error);

    setStatus(
      "derivConnectionStatus",
      "Deriv connection error. Check internet and retry."
    );
  };

  socket.onclose = event => {
    if (tradingState.derivSocket !== socket) return;

    clearTimeout(tradingState.marketTimer);

    tradingState.derivConnected = false;
    tradingState.running = false;
    tradingState.derivSocket = null;
    tradingState.subscriptions = Object.create(null);

    setStatus(
      "derivConnectionStatus",
      "Disconnected. Connection code: " + event.code
    );

    setStatus("brokerStatus", "Deriv not connected.");
    setStatus("scannerStatus", "Scanner stopped.");

    updateDashboard();
  };
}

function disconnectDeriv() {
  stopScanner();

  const socket = tradingState.derivSocket;

  if (socket) {
    socket.close();
  } else {
    tradingState.derivConnected = false;
    setStatus("derivConnectionStatus", "Not connected.");
    setStatus("brokerStatus", "Deriv not connected.");
    updateDashboard();
  }
}

/* MARKET RESPONSE HANDLING */

function normalizeMarket(market) {
  if (!market || typeof market !== "object") return null;

  const symbol =
    market.underlying_symbol ||
    market.symbol ||
    market.underlying ||
    "";

  if (!symbol) return null;

  return {
    ...market,
    symbol,
    display_name:
      market.underlying_symbol_name ||
      market.display_name ||
      market.display_name_short ||
      symbol,
    market_display_name:
      market.market_display_name ||
      market.market ||
      "",
    submarket_display_name:
      market.submarket_display_name ||
      market.submarket ||
      ""
  };
}

function handleDerivMessage(data) {
  if (data.error) {
    clearTimeout(tradingState.marketTimer);

    setStatus(
      "derivConnectionStatus",
      "Deriv error: " +
      (data.error.message || JSON.stringify(data.error))
    );

    return;
  }

  if (Array.isArray(data.errors) && data.errors.length) {
    clearTimeout(tradingState.marketTimer);

    setStatus(
      "derivConnectionStatus",
      "Deriv error: " +
      (data.errors[0].message || JSON.stringify(data.errors[0]))
    );

    return;
  }

  const payload =
    data.data && typeof data.data === "object"
      ? data.data
      : data;

  const type = payload.msg_type || data.msg_type;

  if (type === "active_symbols" ||
      Array.isArray(payload.active_symbols)) {
    clearTimeout(tradingState.marketTimer);

    loadMarkets(
      payload.active_symbols ||
      data.active_symbols ||
      []
    );

    return;
  }

  if (type === "tick" && payload.tick) {
    updateLivePrice(
      payload.tick,
      payload.subscription || data.subscription
    );
  }
}

/* LOAD MARKETS */

function loadMarkets(markets) {
  const list = Array.isArray(markets) ? markets : [];

  tradingState.availableSymbols =
    list.map(normalizeMarket).filter(Boolean);

  renderMarkets();
  updateDashboard();

  if (!tradingState.availableSymbols.length) {
    setStatus(
      "derivConnectionStatus",
      "Deriv replied, but no usable active market symbols were found."
    );

    console.warn("Deriv active_symbols payload:", markets);
    return;
  }

  setStatus(
    "derivConnectionStatus",
    "Connected. " +
    tradingState.availableSymbols.length +
    " markets loaded successfully."
  );
}

function marketCategory(market) {
  const text = [
    market.display_name,
    market.market_display_name,
    market.submarket_display_name,
    market.symbol,
    market.symbol_type
  ].join(" ").toLowerCase();

  if (/forex|frx|currency/.test(text)) return "Forex";
  if (/gold|xau|metal/.test(text)) return "Gold";

  if (
    /index|volatility|crash|boom|step|jump|range/.test(text)
  ) {
    return "Deriv Indices";
  }

  return "Other";
}

function renderMarkets() {
  const container = el("pairList");
  if (!container) return;

  container.replaceChildren();

  if (!tradingState.availableSymbols.length) {
    container.textContent = "No markets loaded yet.";
    updateSelectedCount();
    return;
  }

  const groups = {
    "Deriv Indices": [],
    Forex: [],
    Gold: [],
    Other: []
  };

  tradingState.availableSymbols.forEach(market => {
    groups[marketCategory(market)].push(market);
  });

  Object.entries(groups).forEach(([category, markets]) => {
    if (!markets.length) return;

    const heading = document.createElement("h3");
    heading.textContent =
      category + " (" + markets.length + ")";

    container.appendChild(heading);

    markets.forEach(market => {
      const label = document.createElement("label");
      label.className = "market-option";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = market.symbol;
      checkbox.dataset.marketSymbol = market.symbol;
      checkbox.checked =
        tradingState.selectedSymbols.includes(market.symbol);

      checkbox.addEventListener(
        "change",
        updateSelectedMarkets
      );

      const name = document.createElement("span");
      name.textContent =
        market.display_name + " (" + market.symbol + ")";

      const price = document.createElement("span");
      price.id = priceElementId(market.symbol);
      price.className = "market-price";
      price.textContent =
        tradingState.lastPrices[market.symbol] ?? "--";

      label.append(checkbox, name, price);
      container.appendChild(label);
    });
  });

  updateSelectedCount();
}

function priceElementId(symbol) {
  return "price-" +
    String(symbol).replace(/[^a-zA-Z0-9_-]/g, "_");
}

/* PAIR SELECTION */

function updateSelectedMarkets() {
  tradingState.selectedSymbols = Array.from(
    document.querySelectorAll(
      "#pairList input[data-market-symbol]:checked"
    ),
    input => input.value
  );

  updateSelectedCount();
  updateDashboard();
}

function updateSelectedCount() {
  setText(
    "selectedPairCount",
    tradingState.selectedSymbols.length + " pairs selected"
  );
}

function selectAllPairs() {
  tradingState.selectedSymbols =
    tradingState.availableSymbols.map(market => market.symbol);

  renderMarkets();
  updateDashboard();
}

function clearPairs() {
  tradingState.selectedSymbols = [];
  renderMarkets();
  updateDashboard();
}

/* LIVE TICKS */

function subscribeSymbol(symbol) {
  if (
    !tradingState.derivConnected ||
    tradingState.subscriptions[symbol]
  ) {
    return;
  }

  const requestId = nextRequestId();

  if (sendRequest({
    ticks: symbol,
    subscribe: 1,
    req_id: requestId
  })) {
    tradingState.subscriptions[symbol] = {
      requestId,
      subscriptionId: null
    };
  }
}

function unsubscribeSymbol(symbol) {
  const item = tradingState.subscriptions[symbol];

  if (item && item.subscriptionId) {
    sendRequest({
      forget: item.subscriptionId,
      req_id: nextRequestId()
    });
  }

  delete tradingState.subscriptions[symbol];
}

function updateLivePrice(tick, subscription) {
  if (!tick || !tick.symbol) return;

  const symbol = tick.symbol;
  const quote = tick.quote;

  tradingState.lastPrices[symbol] = quote;

  if (
    subscription &&
    subscription.id &&
    tradingState.subscriptions[symbol]
  ) {
    tradingState.subscriptions[symbol].subscriptionId =
      subscription.id;
  }

  const price = el(priceElementId(symbol));

  if (price) price.textContent = quote;

  if (tradingState.running) {
    updateScannerResults(symbol, quote);

    setStatus(
      "scannerStatus",
      "SCANNER RUNNING — Live prices updating. APA signal calculations are not yet enabled."
    );
  }
}

/* SCANNER — PRICE MONITOR ONLY */

function startScanner() {
  const broker = el("scannerBroker");

  if (broker && broker.value === "mt5") {
    setStatus(
      "scannerStatus",
      "MT5 bridge is not configured. Select Deriv for market monitoring."
    );
    return;
  }

  if (!tradingState.derivConnected) {
    setStatus("scannerStatus", "Connect Deriv first.");
    return;
  }

  updateSelectedMarkets();

  if (!tradingState.selectedSymbols.length) {
    setStatus(
      "scannerStatus",
      "Select at least one market first."
    );
    return;
  }

  tradingState.running = true;

  const results = el("scannerResults");

  if (results) {
    results.textContent =
      "Scanner started. Waiting for live prices... APA analysis is not yet enabled.";
  }

  setText("marketTrend", "Waiting for price data");
  setText("apaStructure", "APA analysis not yet enabled");
  setText("liquidityStatus", "Waiting for analysis engine");
  setText("entrySignal", "No verified APA signal");

  tradingState.selectedSymbols.forEach(subscribeSymbol);

  updateDashboard();

  setStatus(
    "scannerStatus",
    "SCANNER RUNNING — Monitoring " +
    tradingState.selectedSymbols.length +
    " markets."
  );
}

function stopScanner() {
  tradingState.running = false;

  Object.keys(tradingState.subscriptions).forEach(
    unsubscribeSymbol
  );

  setStatus("scannerStatus", "Scanner stopped.");
  updateDashboard();
}

function updateScannerResults(symbol, quote) {
  const container = el("scannerResults");
  if (!container) return;

  const id = "scanner-result-" +
    String(symbol).replace(/[^a-zA-Z0-9_-]/g, "_");

  let row = el(id);

  if (!row) {
    row = document.createElement("p");
    row.id = id;
    container.appendChild(row);
  }

  row.textContent =
    symbol + " | Price: " + quote +
    " | APA analysis pending";
}

/* SETTINGS */

function saveSettings() {
  const fields = [
    ["riskPercent", 0.1, 1],
    ["lotSize", 0.01, 100],
    ["stopLoss", 1, 1000000],
    ["takeProfit", 1, 1000000],
    ["maxTrades", 1, 20],
    ["dailyLossLimit", 0.1, 10]
  ];

  for (const [id, min, max] of fields) {
    const input = el(id);
    if (!input) continue;

    const value = Number(input.value);

    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max
    ) {
      setStatus(
        "settingsStatus",
        "Invalid value in " + id + ". Check the allowed limits."
      );
      return;
    }
  }

  const settings = {};

  document.querySelectorAll(
    "#settings input[type='checkbox']"
  ).forEach(input => {
    settings[input.id] = input.checked;
  });

  fields.forEach(([id]) => {
    if (el(id)) settings[id] = el(id).value;
  });

  ["tradingStyle", "timeframe"].forEach(id => {
    if (el(id)) settings[id] = el(id).value;
  });

  try {
    localStorage.setItem(
      "smcSniperAPASettings",
      JSON.stringify(settings)
    );

    setStatus(
      "settingsStatus",
      "Settings saved on this device. Live trading remains locked."
    );
  } catch (error) {
    setStatus(
      "settingsStatus",
      "Browser storage unavailable. Settings were not saved."
    );
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem("smcSniperAPASettings");
    if (!raw) return;

    const settings = JSON.parse(raw);

    Object.entries(settings).forEach(([id, value]) => {
      const input = el(id);
      if (!input) return;

      if (input.type === "checkbox") {
        input.checked = Boolean(value);
      } else {
        input.value = value;
      }
    });
  } catch (error) {
    console.warn("Could not load saved settings:", error);
  }
}

/* MT5 */

function connectMT5() {
  tradingState.mt5Connected = false;

  setStatus(
    "mt5ConnectionStatus",
    "MT5 bridge not configured. A separate MT5 Expert Advisor or bridge is required."
  );
}

/* DASHBOARD */

function updateDashboard() {
  setText(
    "systemStatus",
    tradingState.running ? "Scanner Running" : "System Ready"
  );

  setText("pairCount", tradingState.selectedSymbols.length);
  setText("openTrades", "0");

  setText(
    "brokerStatus",
    tradingState.derivConnected
      ? "Broker: Deriv market data connected"
      : "Broker: Not connected"
  );

  if (!tradingState.running) {
    setText("scannerStatus", "Scanner: Stopped");
  }

  enforceDemoOnly();
}

/* INITIALIZATION */

function initializeApp() {
  console.log("Starting SMC Sniper Pro APA...");

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.addEventListener("click", () => {
      showSection(button.dataset.page);
    });
  });

  const actions = {
    connectDeriv,
    disconnectDeriv,
    selectAllPairs,
    clearPairs,
    scannerStartButton: startScanner,
    scannerStopButton: stopScanner,
    startScanner,
    stopScanner,
    saveSettings,
    connectMT5
  };

  Object.entries(actions).forEach(([id, action]) => {
    const button = el(id);
    if (button) button.addEventListener("click", action);
  });

  if (el("tradingStyle")) {
    el("tradingStyle").addEventListener("change", updateMode);
  }

  if (el("brokerType")) {
    el("brokerType").addEventListener("change", updateBrokerPanels);
  }

  if (el("scannerBroker")) {
    el("scannerBroker").addEventListener("change", updateScannerBroker);
  }

  loadSettings();
  enforceDemoOnly();
  updateMode();
  updateBrokerPanels();
  updateScannerBroker();
  updateSelectedCount();

  showSection("dashboard");
  updateDashboard();

  console.log(
    "SMC Sniper Pro APA initialized. Public market data only; live trading locked."
  );
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeApp);
} else {
  initializeApp();
}

  


