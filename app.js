"use strict";

/* SMC SNIPER PRO APA
   DEMO ONLY - LIVE TRADING LOCKED
*/

const DERIV_PUBLIC_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

const CLOUD_WORKER_URL =
    "https://smc-sniper-oauth.henryssenkubuge38.workers.dev/";

const tradingState = {
    mode: "scalping",
    demo: true,
    liveLocked: true,
    running: false,
    broker: "deriv",
    derivConnected: false,
    mt5Connected: false,
    derivSocket: null,
    availableSymbols: [],
    selectedSymbols: [],
    subscriptions: {},
    lastPrices: {},
    settings: {},
    marketRequestTimer: null
};

/* HELPERS */

function el(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const item = el(id);
    if (item) item.textContent = value;
}

function setStatus(id, message) {
    setText(id, message);
}

/* NAVIGATION */

function showSection(name) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.remove("active");
    });

    const page = el(name);
    if (page) page.style.display = "block";

    const button = document.querySelector(
        `.nav-btn[data-page="${name}"]`
    );

    if (button) button.classList.add("active");
}

/* TRADING STYLES */

function updateMode() {
    const mode = el("tradingStyle");
    const timeframe = el("timeframe");

    if (!mode) return;

    tradingState.mode = mode.value;

    const choices = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    if (timeframe) {
        const options = choices[mode.value] || choices.scalping;
        const oldValue = timeframe.value;

        timeframe.innerHTML = "";

        options.forEach(value => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = value;
            timeframe.appendChild(option);
        });

        if (options.includes(oldValue)) {
            timeframe.value = oldValue;
        }
    }

    updateDashboard();
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
            ? "Deriv market data connected"
            : "Deriv not connected"
    );

    setText(
        "scannerStatus",
        tradingState.running ? "Scanner active" : "Scanner stopped"
    );

    setText("liveLock", "LIVE TRADING LOCKED - DEMO ONLY");
}

/* BROKER PANELS */

function updateBrokerPanels() {
    const broker = el("brokerType");
    const value = broker ? broker.value : "deriv";

    if (el("derivPanel")) {
        el("derivPanel").style.display =
            value === "deriv" ? "block" : "none";
    }

    if (el("mt5Panel")) {
        el("mt5Panel").style.display =
            value === "mt5" ? "block" : "none";
    }
}

function updateScannerBroker() {
    const broker = el("scannerBroker");
    if (!broker) return;

    tradingState.broker = broker.value;

    setStatus(
        "scannerStatus",
        broker.value === "mt5"
            ? "MT5 bridge required."
            : "Connect Deriv market data first."
    );

    updateDashboard();
}

/* DERIV CONNECTION */

function connectDeriv() {
    if (
        tradingState.derivSocket &&
        (
            tradingState.derivSocket.readyState === WebSocket.OPEN ||
            tradingState.derivSocket.readyState === WebSocket.CONNECTING
        )
    ) {
        setStatus(
            "derivConnectionStatus",
            "Deriv connection is already open or connecting."
        );
        return;
    }

    setStatus(
        "derivConnectionStatus",
        "Connecting to Deriv public market data..."
    );

    tradingState.availableSymbols = [];
    tradingState.lastPrices = {};
    tradingState.subscriptions = {};

    let socket;

    try {
        socket = new WebSocket(DERIV_PUBLIC_WS);
    } catch (error) {
        setStatus(
            "derivConnectionStatus",
            "Could not open connection: " + error.message
        );
        return;
    }

    tradingState.derivSocket = socket;

    socket.onopen = function() {
        tradingState.derivConnected = true;

        setStatus(
            "derivConnectionStatus",
            "Connected. Requesting available markets..."
        );

        updateDashboard();

        socket.send(JSON.stringify({
            active_symbols: "brief",
            req_id: 1001
        }));

        clearTimeout(tradingState.marketRequestTimer);

        tradingState.marketRequestTimer = setTimeout(function() {
            if (tradingState.availableSymbols.length === 0) {
                setStatus(
                    "derivConnectionStatus",
                    "Connection open, but no market list received."
                );
            }
        }, 12000);
    };

    socket.onmessage = function(event) {
        let data;

        try {
            data = JSON.parse(event.data);
        } catch (error) {
            setStatus(
                "derivConnectionStatus",
                "Received an unreadable API response."
            );
            return;
        }

        handleDerivMessage(data);
    };

    socket.onerror = function() {
        setStatus(
            "derivConnectionStatus",
            "WebSocket error. Check internet or Deriv connection."
        );
    };

    socket.onclose = function(event) {
        clearTimeout(tradingState.marketRequestTimer);

        tradingState.derivConnected = false;
        tradingState.derivSocket = null;
        tradingState.subscriptions = {};

        setStatus(
            "derivConnectionStatus",
            "Connection closed. Code: " + event.code
        );

        updateDashboard();
    };
}

/* API RESPONSE HANDLER */

function handleDerivMessage(data) {
    console.log("Deriv API response:", data);

    if (data.error) {
        setStatus(
            "derivConnectionStatus",
            "Deriv error: " +
            (data.error.message || "Unknown error")
        );
        return;
    }

    if (Array.isArray(data.errors) && data.errors.length > 0) {
        setStatus(
            "derivConnectionStatus",
            "API error: " +
            (data.errors[0].message || "Unknown API error")
        );
        return;
    }

    if (data.msg_type === "active_symbols") {
        clearTimeout(tradingState.marketRequestTimer);
        loadAvailableSymbols(data.active_symbols || []);
        return;
    }

    if (data.msg_type === "tick" && data.tick) {
        updateLivePrice(data.tick);
        return;
    }

    if (data.msg_type === "forget") {
        return;
    }

    if (data.msg_type) {
        setStatus(
            "derivConnectionStatus",
            "Connected. API response received: " + data.msg_type
        );
        return;
    }

    setStatus(
        "derivConnectionStatus",
        "Unexpected API response. Fields received: " +
        Object.keys(data).join(", ")
    );
}

/* LOAD MARKETS */

function loadAvailableSymbols(symbols) {
    if (!Array.isArray(symbols)) {
        setStatus(
            "derivConnectionStatus",
            "Unexpected market-list format."
        );
        return;
    }

    tradingState.availableSymbols = symbols
        .map(item => ({
            ...item,
            symbol: item.symbol || item.underlying_symbol,
            display_name:
                item.display_name ||
                item.underlying_symbol_name,
            symbol_type:
                item.symbol_type ||
                item.underlying_symbol_type,
            pip: item.pip || item.pip_size
        }))
        .filter(item => item.symbol);

    if (tradingState.availableSymbols.length === 0) {
        setStatus(
            "derivConnectionStatus",
            "Deriv responded, but returned zero active markets."
        );
        return;
    }

    renderPairs();

    setStatus(
        "derivConnectionStatus",
        "Connected. " +
        tradingState.availableSymbols.length +
        " markets loaded successfully."
    );

    updateDashboard();
}

/* DISPLAY PAIRS */

function renderPairs() {
    const container = el("pairList");
    if (!container) return;

    container.innerHTML = "";

    if (tradingState.availableSymbols.length === 0) {
        container.textContent = "No markets loaded yet.";
        updateSelectedPairCount();
        return;
    }

    tradingState.availableSymbols.forEach(symbol => {
        const row = document.createElement("label");
        row.className = "pair-item";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = symbol.symbol;

        checkbox.checked =
            tradingState.selectedSymbols.includes(symbol.symbol);

        checkbox.addEventListener("change", function() {
            if (this.checked) {
                if (!tradingState.selectedSymbols.includes(symbol.symbol)) {
                    tradingState.selectedSymbols.push(symbol.symbol);
                }
            } else {
                tradingState.selectedSymbols =
                    tradingState.selectedSymbols.filter(
                        item => item !== symbol.symbol
                    );

                unsubscribeSymbol(symbol.symbol);
            }

            updateSelectedPairCount();
            updateDashboard();
        });

        const name = document.createElement("span");
        name.textContent =
            (symbol.display_name || symbol.symbol) +
            " (" + symbol.symbol + ")";

        const price = document.createElement("span");
        price.id = "price-" + symbol.symbol;
        price.textContent =
            tradingState.lastPrices[symbol.symbol] ?? "--";

        row.appendChild(checkbox);
        row.appendChild(name);
        row.appendChild(price);

        container.appendChild(row);
    });

    updateSelectedPairCount();
}

function updateSelectedPairCount() {
    setText(
        "selectedPairCount",
        tradingState.selectedSymbols.length
    );
}

/* SELECT ALL AND CLEAR */

function selectAllPairs() {
    if (tradingState.availableSymbols.length === 0) {
        setStatus(
            "scannerStatus",
            "No markets available. Connect Deriv first."
        );
        return;
    }

    tradingState.selectedSymbols =
        tradingState.availableSymbols.map(item => item.symbol);

    renderPairs();
    updateDashboard();
}

function clearPairs() {
    Object.keys(tradingState.subscriptions).forEach(symbol => {
        unsubscribeSymbol(symbol);
    });

    tradingState.selectedSymbols = [];

    renderPairs();
    updateDashboard();
}

/* LIVE PRICES */

function updateLivePrice(tick) {
    if (!tick.symbol) return;

    tradingState.lastPrices[tick.symbol] = tick.quote;

    const price = el("price-" + tick.symbol);

    if (price) {
        price.textContent = tick.quote;
    }

    if (tradingState.running) {
        updateScannerResults(tick.symbol, tick.quote);
    }
}

/* SEND API MESSAGE */

function sendDerivMessage(message) {
    const socket = tradingState.derivSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    socket.send(JSON.stringify(message));
    return true;
}

/* PRICE SUBSCRIPTIONS */

function subscribeSymbol(symbol) {
    if (tradingState.subscriptions[symbol]) return;

    const sent = sendDerivMessage({
        ticks: symbol,
        subscribe: 1,
        req_id: Date.now()
    });

    if (sent) {
        tradingState.subscriptions[symbol] = true;
    }
}

function unsubscribeSymbol(symbol) {
    if (!tradingState.subscriptions[symbol]) return;

    delete tradingState.subscriptions[symbol];
}

/* SCANNER */

function startScanner() {
    if (tradingState.broker === "mt5") {
        setStatus("scannerStatus", "MT5 bridge is not connected.");
        return;
    }

    if (!tradingState.derivConnected) {
        setStatus("scannerStatus", "Connect Deriv first.");
        return;
    }

    if (tradingState.selectedSymbols.length === 0) {
        setStatus("scannerStatus", "Select at least one market.");
        return;
    }

    tradingState.running = true;

    tradingState.selectedSymbols.forEach(symbol => {
        subscribeSymbol(symbol);
    });

    setStatus(
        "scannerStatus",
        "Live market prices streaming. APA analysis engine is not yet implemented."
    );

    setText("entrySignal", "Waiting for APA analysis engine.");

    updateDashboard();
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

    let row = el("result-" + symbol);

    if (!row) {
        row = document.createElement("div");
        row.id = "result-" + symbol;
        row.className = "scanner-result";
        container.appendChild(row);
    }

    row.textContent =
        symbol + " | Price: " + price +
        " | APA analysis pending";
}

/* DISCONNECT */

function disconnectDeriv() {
    stopScanner();

    clearTimeout(tradingState.marketRequestTimer);

    const socket = tradingState.derivSocket;

    tradingState.derivConnected = false;
    tradingState.availableSymbols = [];
    tradingState.selectedSymbols = [];
    tradingState.subscriptions = {};
    tradingState.lastPrices = {};

    tradingState.derivSocket = null;

    if (socket) {
        socket.onclose = null;
        socket.close();
    }

    renderPairs();

    setStatus(
        "derivConnectionStatus",
        "Disconnected from Deriv."
    );

    updateDashboard();
}

/* MT5 */

function connectMT5() {
    tradingState.mt5Connected = false;

    setStatus(
        "mt5ConnectionStatus",
        "MT5 requires a separate Expert Advisor or bridge."
    );
}

/* CLOUD WORKER */

async function checkCloudWorker() {
    try {
        const response = await fetch(CLOUD_WORKER_URL + "health");

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        const result = await response.json();

        setText(
            "cloudStatus",
            result.status || result.message || "Cloud Worker online"
        );
    } catch (error) {
        setText("cloudStatus", "Cloud Worker unavailable");
        console.error("Cloud Worker:", error);
    }
}

/* SETTINGS */

function saveSettings() {
    const ids = [
        "riskPercent",
        "lotSize",
        "stopLoss",
        "takeProfit",
        "maxTrades",
        "dailyLossLimit"
    ];

    const settings = {};

    ids.forEach(id => {
        const input = el(id);
        if (input) settings[id] = input.value;
    });

    document.querySelectorAll(
        "#settings input[type='checkbox']"
    ).forEach(input => {
        if (input.id) settings[input.id] = input.checked;
    });

    localStorage.setItem(
        "smcSniperAPASettings",
        JSON.stringify(settings)
    );

    tradingState.settings = settings;

    setStatus("settingsStatus", "Settings saved on this device.");
}

function loadSettings() {
    const saved = localStorage.getItem("smcSniperAPASettings");
    if (!saved) return;

    try {
        const settings = JSON.parse(saved);
        tradingState.settings = settings;

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
        console.error("Settings loading error:", error);
    }
}

/* DEMO SAFETY */

function enforceDemoOnly() {
    tradingState.demo = true;
    tradingState.liveLocked = true;

    const mode = el("executionMode");

    if (mode) {
        mode.value = "demo";
    }

    const live = document.querySelector(
        '#executionMode option[value="live"]'
    );

    if (live) live.disabled = true;

    setText("liveLock", "LIVE TRADING LOCKED - DEMO ONLY");
}

/* INITIALIZE */

function initializeApp() {
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", function() {
            if (this.dataset.page) {
                showSection(this.dataset.page);
            }
        });
    });

    const events = {
        connectDeriv: connectDeriv,
        disconnectDeriv: disconnectDeriv,
        selectAllPairs: selectAllPairs,
        clearPairs: clearPairs,
        startScanner: startScanner,
        stopScanner: stopScanner,
        saveSettings: saveSettings,
        connectMT5: connectMT5
    };

    Object.keys(events).forEach(id => {
        const button = el(id);

        if (button) {
            button.addEventListener("click", events[id]);
        }
    });

    if (el("tradingStyle")) {
        el("tradingStyle").addEventListener("change", updateMode);
    }

    if (el("brokerType")) {
        el("brokerType").addEventListener(
            "change",
            updateBrokerPanels
        );
    }

    if (el("scannerBroker")) {
        el("scannerBroker").addEventListener(
            "change",
            updateScannerBroker
        );
    }

    loadSettings();
    enforceDemoOnly();

    updateMode();
    updateBrokerPanels();
    updateScannerBroker();

    showSection("dashboard");

    checkCloudWorker();
    updateDashboard();

    console.log("SMC Sniper Pro APA started.");
}

/* START */

if (document.readyState === "loading") {
    document.addEventListener(
        "DOMContentLoaded",
        initializeApp
    );
} else {
    initializeApp();
}
