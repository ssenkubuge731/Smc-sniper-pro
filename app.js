
"use strict";

/* =====================================================
   SMC SNIPER PRO APA
   Advanced Price Action
   PUBLIC MARKET DATA
   DEMO MONITORING ONLY
   LIVE TRADING LOCKED
===================================================== */

const DERIV_PUBLIC_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

const CLOUD_WORKER_URL =
    "https://smc-sniper-oauth.henryssenkubuge38.workers.dev/";

/* ================= STATE ================= */

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
    lastPrices: {},
    subscriptions: {},

    requestId: 1,
    marketTimer: null
};

/* ================= HELPERS ================= */

function el(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = el(id);
    if (element) element.textContent = String(value);
}

function setStatus(id, message) {
    setText(id, message);
}

function sendRequest(request) {
    const socket = tradingState.derivSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(request));
        return true;
    } catch (error) {
        console.error("WebSocket send error:", error);
        return false;
    }
}

function nextRequestId() {
    return tradingState.requestId++;
}

function enforceDemoOnly() {
    tradingState.demo = true;
    tradingState.liveLocked = true;

    const mode = el("executionMode");
    if (mode) mode.value = "demo";

    const lock = el("liveLock");
    if (lock) {
        lock.textContent = "LIVE TRADING LOCKED";
        lock.disabled = true;
    }
}

/* ================= NAVIGATION ================= */

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

/* ================= TRADING MODES ================= */

function updateMode() {
    const selector = el("tradingStyle");
    const timeframe = el("timeframe");

    if (!selector || !timeframe) return;

    tradingState.mode = selector.value;

    const modes = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    const choices = modes[tradingState.mode] || modes.scalping;
    const previous = timeframe.value;

    timeframe.innerHTML = "";

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

/* ================= BROKER PANELS ================= */

function updateBrokerPanels() {
    const selector = el("brokerType");
    if (!selector) return;

    tradingState.broker = selector.value;

    const derivPanel = el("derivPanel");
    const mt5Panel = el("mt5Panel");

    if (derivPanel) {
        derivPanel.style.display =
            tradingState.broker === "deriv" ? "block" : "none";
    }

    if (mt5Panel) {
        mt5Panel.style.display =
            tradingState.broker === "mt5" ? "block" : "none";
    }
}

function updateScannerBroker() {
    const selector = el("scannerBroker");
    if (!selector) return;

    if (selector.value === "mt5") {
        setStatus(
            "scannerStatus",
            "MT5 bridge required. Deriv scanner is not active."
        );
    } else {
        setStatus(
            "scannerStatus",
            tradingState.running
                ? "Scanner running"
                : "Scanner stopped"
        );
    }
}

/* ================= CLOUD WORKER ================= */

async function checkCloudWorker() {
    setStatus("cloudStatus", "Checking cloud worker...");

    try {
        const response = await fetch(CLOUD_WORKER_URL, {
            method: "GET",
            cache: "no-store"
        });

        setStatus(
            "cloudStatus",
            response.ok
                ? "Cloud worker reachable."
                : "Cloud worker returned HTTP " + response.status
        );
    } catch (error) {
        setStatus(
            "cloudStatus",
            "Cloud worker unavailable. Public market data is separate."
        );
    }
}

/* ================= DERIV CONNECTION ================= */

function connectDeriv() {
    const existing = tradingState.derivSocket;

    if (
        existing &&
        (
            existing.readyState === WebSocket.OPEN ||
            existing.readyState === WebSocket.CONNECTING
        )
    ) {
        setStatus(
            "derivConnectionStatus",
            "Deriv is already connected or connecting."
        );
        return;
    }

    if (typeof WebSocket === "undefined") {
        setStatus(
            "derivConnectionStatus",
            "Your browser does not support WebSocket."
        );
        return;
    }

    setStatus(
        "derivConnectionStatus",
        "Connecting to Deriv public market data..."
    );

    try {
        const socket = new WebSocket(DERIV_PUBLIC_WS);

        tradingState.derivSocket = socket;

        socket.onopen = function() {
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

            // Official public active-symbols request.
            // No OAuth or App ID required for public prices.

            const sent = sendRequest({
                active_symbols: "brief",
                req_id: nextRequestId()
            });

            if (!sent) {
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
                        "Connected, but no market response arrived. Check the connection and retry."
                    );
                }
            }, 15000);

            updateDashboard();
        };

        socket.onmessage = function(event) {
            if (tradingState.derivSocket !== socket) return;

            let data;

            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error("Invalid Deriv response:", event.data);
                return;
            }

            console.log("Deriv response:", data);

            handleDerivMessage(data);
        };

        socket.onerror = function(error) {
            console.error("Deriv WebSocket error:", error);

            setStatus(
                "derivConnectionStatus",
                "Deriv connection error. Check internet and try again."
            );
        };

        socket.onclose = function(event) {
            if (tradingState.derivSocket !== socket) return;

            clearTimeout(tradingState.marketTimer);

            tradingState.derivConnected = false;
            tradingState.running = false;
            tradingState.derivSocket = null;
            tradingState.subscriptions = {};

            setStatus(
                "derivConnectionStatus",
                "Disconnected. Connection code: " + event.code
            );

            setStatus("brokerStatus", "Deriv not connected.");
            setStatus("scannerStatus", "Scanner stopped.");

            updateDashboard();
        };

    } catch (error) {
        console.error(error);

        setStatus(
            "derivConnectionStatus",
            "Could not start the Deriv connection."
        );
    }
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

/* ================= DERIV RESPONSES ================= */

function handleDerivMessage(data) {
    if (data.error) {
        clearTimeout(tradingState.marketTimer);

        setStatus(
            "derivConnectionStatus",
            "Deriv error: " + data.error.message
        );

        console.error("Deriv API error:", data.error);
        return;
    }

    if (data.errors) {
        clearTimeout(tradingState.marketTimer);

        setStatus(
            "derivConnectionStatus",
            "Deriv error: " + JSON.stringify(data.errors)
        );
        return;
    }

    if (data.msg_type === "active_symbols") {
        clearTimeout(tradingState.marketTimer);

        if (!Array.isArray(data.active_symbols)) {
            setStatus(
                "derivConnectionStatus",
                "Deriv replied without a valid market list."
            );
            return;
        }

        loadMarkets(data.active_symbols);
        return;
    }

    if (data.msg_type === "tick" && data.tick) {
        updateLivePrice(data.tick, data.subscription);
        return;
    }

    if (data.msg_type) {
        console.log("Other Deriv message:", data.msg_type);
    }
}

/* ================= MARKET LOADING ================= */

function loadMarkets(markets) {
    tradingState.availableSymbols = markets
        .filter(market => market)
        .map(market => {
            return {
                ...market,

                // Support Deriv's new and old API field names.
                symbol:
                    market.underlying_symbol ||
                    market.symbol ||
                    "",

                display_name:
                    market.underlying_symbol_name ||
                    market.display_name ||
                    market.underlying_symbol ||
                    market.symbol ||
                    "Unknown market",

                symbol_type:
                    market.underlying_symbol_type ||
                    market.symbol_type ||
                    "",

                market_display_name:
                    market.market_display_name ||
                    market.market ||
                    "",

                submarket_display_name:
                    market.submarket_display_name ||
                    market.submarket ||
                    ""
            };
        })
        .filter(market => market.symbol);

    renderMarkets();
    updateDashboard();

    if (tradingState.availableSymbols.length === 0) {
        setStatus(
            "derivConnectionStatus",
            "Deriv replied, but no usable market symbols were found."
        );
        return;
    }

    setStatus(
        "derivConnectionStatus",
        "Connected. " +
        tradingState.availableSymbols.length +
        " markets loaded successfully."
    );
}

    setStatus(
        "derivConnectionStatus",
        "Connected. " +
        tradingState.availableSymbols.length +
        " markets loaded successfully."
    );
}

function getMarketCategory(market) {
    const name = (
        (market.display_name || "") + " " +
        (market.market_display_name || "") + " " +
        (market.submarket_display_name || "") + " " +
        (market.symbol || "")
    ).toLowerCase();

    if (
        name.includes("forex") ||
        name.includes("frx") ||
        name.includes("currency")
    ) return "Forex";

    if (
        name.includes("gold") ||
        name.includes("xau") ||
        name.includes("metal")
    ) return "Gold";

    if (
        name.includes("index") ||
        name.includes("volatility") ||
        name.includes("crash") ||
        name.includes("boom") ||
        name.includes("step") ||
        name.includes("jump") ||
        name.includes("range")
    ) return "Deriv Indices";

    return "Other";
}

function renderMarkets() {
    const container = el("pairList");
    if (!container) return;

    container.innerHTML = "";

    if (tradingState.availableSymbols.length === 0) {
        container.textContent = "No markets loaded yet.";
        return;
    }

    const groups = {
        "Deriv Indices": [],
        "Forex": [],
        "Gold": [],
        "Other": []
    };

    tradingState.availableSymbols.forEach(market => {
        groups[getMarketCategory(market)].push(market);
    });

    Object.keys(groups).forEach(category => {
        if (groups[category].length === 0) return;

        const heading = document.createElement("h3");
        heading.textContent =
            category + " (" + groups[category].length + ")";

        container.appendChild(heading);

        groups[category].forEach(market => {
            const label = document.createElement("label");
            label.className = "market-option";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = market.symbol;
            checkbox.dataset.marketSymbol = market.symbol;

            checkbox.checked =
                tradingState.selectedSymbols.includes(market.symbol);

            checkbox.addEventListener("change", updateSelectedMarkets);

            const name = document.createElement("span");
            name.textContent =
                (market.display_name || market.symbol) +
                " (" + market.symbol + ")";

            const price = document.createElement("span");
            price.id = "price-" + market.symbol;
            price.className = "market-price";
            price.textContent =
                tradingState.lastPrices[market.symbol] ?? "--";

            label.appendChild(checkbox);
            label.appendChild(name);
            label.appendChild(price);

            container.appendChild(label);
        });
    });

    updateSelectedCount();
}

/* ================= PAIR SELECTION ================= */

function updateSelectedMarkets() {
    const checkboxes = document.querySelectorAll(
        "#pairList input[data-market-symbol]"
    );

    tradingState.selectedSymbols = [];

    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            tradingState.selectedSymbols.push(checkbox.value);
        }
    });

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

/* ================= LIVE TICKS ================= */

function subscribeSymbol(symbol) {
    if (!tradingState.derivConnected) return;
    if (tradingState.subscriptions[symbol]) return;

    const id = nextRequestId();

    const sent = sendRequest({
        ticks: symbol,
        subscribe: 1,
        req_id: id
    });

    if (sent) {
        tradingState.subscriptions[symbol] = {
            requestId: id,
            subscriptionId: null
        };
    }
}

function unsubscribeSymbol(symbol) {
    const subscription = tradingState.subscriptions[symbol];

    if (subscription && subscription.subscriptionId) {
        sendRequest({
            forget: subscription.subscriptionId,
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

    const priceElement = el("price-" + symbol);

    if (priceElement) {
        priceElement.textContent = quote;
    }

    if (tradingState.running) {
        updateScannerResults(symbol, quote);

        setStatus(
            "scannerStatus",
            "SCANNER RUNNING — Live prices updating."
        );
    }
}

/* ================= SCANNER ================= */

function startScanner() {
    const broker = el("scannerBroker");

    if (broker && broker.value === "mt5") {
        setStatus(
            "scannerStatus",
            "MT5 bridge is not connected. Select Deriv for market scanning."
        );
        return;
    }

    if (!tradingState.derivConnected) {
        setStatus("scannerStatus", "Connect Deriv first.");
        return;
    }

    updateSelectedMarkets();

    if (tradingState.selectedSymbols.length === 0) {
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
            "Scanner started. Waiting for live prices...";
    }

    setText("marketTrend", "Waiting for price data");
    setText("apaStructure", "Analysis not implemented");
    setText("liquidityStatus", "Analysis not implemented");
    setText("entrySignal", "No verified APA signal");

    tradingState.selectedSymbols.forEach(symbol => {
        subscribeSymbol(symbol);
    });

    updateDashboard();

    setStatus(
        "scannerStatus",
        "SCANNER RUNNING — Monitoring " +
        tradingState.selectedSymbols.length + " markets."
    );
}

function stopScanner() {
    tradingState.running = false;

    Object.keys(tradingState.subscriptions).forEach(symbol => {
        unsubscribeSymbol(symbol);
    });

    setStatus("scannerStatus", "Scanner stopped.");

    updateDashboard();
}

function updateScannerResults(symbol, price) {
    const container = el("scannerResults");
    if (!container) return;

    const id = "scanner-result-" + symbol;
    let row = el(id);

    if (!row) {
        row = document.createElement("p");
        row.id = id;
        container.appendChild(row);
    }

    row.textContent =
        symbol + " | Price: " + price +
        " | APA analysis pending";
}

/* ================= SETTINGS ================= */

function saveSettings() {
    const numberFields = [
        ["riskPercent", 0.1, 1],
        ["lotSize", 0.01, 100],
        ["stopLoss", 1, 1000000],
        ["takeProfit", 1, 1000000],
        ["maxTrades", 1, 20],
        ["dailyLossLimit", 0.1, 10]
    ];

    for (const [id, min, max] of numberFields) {
        const input = el(id);
        if (!input) continue;

        const value = Number(input.value);

        if (!Number.isFinite(value) || value < min || value > max) {
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

    numberFields.forEach(([id]) => {
        if (el(id)) settings[id] = el(id).value;
    });

    if (el("tradingStyle")) {
        settings.tradingStyle = el("tradingStyle").value;
    }

    if (el("timeframe")) {
        settings.timeframe = el("timeframe").value;
    }

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

        Object.keys(settings).forEach(id => {
            const input = el(id);
            if (!input) return;

            if (input.type === "checkbox") {
                input.checked = Boolean(settings[id]);
            } else {
                input.value = settings[id];
            }
        });

    } catch (error) {
        console.error("Could not load settings:", error);
    }
}

/* ================= MT5 ================= */

function connectMT5() {
    tradingState.mt5Connected = false;

    setStatus(
        "mt5ConnectionStatus",
        "MT5 bridge not configured. A separate MT5 terminal bridge or Expert Advisor is required."
    );
}

/* ================= DASHBOARD ================= */

function updateDashboard() {
    setText(
        "systemStatus",
        tradingState.running ? "Scanner Running" : "System Ready"
    );

    setText(
        "pairCount",
        tradingState.selectedSymbols.length
    );

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

/* ================= INITIALIZATION ================= */

function initializeApp() {
    console.log("Starting SMC Sniper Pro APA...");

    // Navigation

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", function() {
            showSection(this.dataset.page);
        });
    });

    // Dashboard and scanner controls

    const buttons = {
        connectDeriv: connectDeriv,
        disconnectDeriv: disconnectDeriv,

        selectAllPairs: selectAllPairs,
        clearPairs: clearPairs,

        scannerStartButton: startScanner,
        scannerStopButton: stopScanner,

        startScanner: startScanner,
        stopScanner: stopScanner,

        saveSettings: saveSettings,
        connectMT5: connectMT5
    };

    Object.keys(buttons).forEach(id => {
        const button = el(id);

        if (button) {
            button.addEventListener("click", buttons[id]);
        }
    });

    // Select controls

    if (el("tradingStyle")) {
        el("tradingStyle").addEventListener("change", updateMode);
    }

    if (el("brokerType")) {
        el("brokerType").addEventListener("change", updateBrokerPanels);
    }

    if (el("scannerBroker")) {
        el("scannerBroker").addEventListener("change", updateScannerBroker);
    }

    // Load settings and initialize the interface

    loadSettings();
    enforceDemoOnly();
    updateMode();
    updateBrokerPanels();
    updateScannerBroker();
    updateSelectedCount();

    showSection("dashboard");
    updateDashboard();

    checkCloudWorker();

    console.log("SMC Sniper Pro APA initialized.");
}

/* ================= START ================= */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}


