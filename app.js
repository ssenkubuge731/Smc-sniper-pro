
"use strict";

/* SMC SNIPER PRO APA
   Phase 1: Deriv public market data
   DEMO ONLY - LIVE TRADING LOCKED
*/

const DERIV_PUBLIC_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

const CLOUD_WORKER_URL =
    "https://smc-sniper-oauth.henryssenkubuge38.workers.dev/";

const DERIV_CLIENT_ID = "34PG0A117Y8MMt1O0h3IW";

const DERIV_REDIRECT_URI =
    "https://ssenkubuge731.github.io/Smc-sniper-pro/callback.html";

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
    settings: {}
};

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, value) {
    const element = getElement(id);
    if (element) element.textContent = value;
}

function setStatus(id, message) {
    setText(id, message);
}

/* PAGE NAVIGATION */

function showSection(sectionName) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.remove("active");
    });

    const section = getElement(sectionName);

    if (section) section.style.display = "block";

    const activeButton = document.querySelector(
        `.nav-btn[data-page="${sectionName}"]`
    );

    if (activeButton) activeButton.classList.add("active");
}

/* TRADING STYLES */

function updateMode() {
    const modeSelect = getElement("tradingStyle");
    const timeframeSelect = getElement("timeframe");

    if (!modeSelect) return;

    tradingState.mode = modeSelect.value;

    const timeframes = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    if (timeframeSelect) {
        const choices =
            timeframes[tradingState.mode] || timeframes.scalping;

        const previousValue = timeframeSelect.value;

        timeframeSelect.innerHTML = "";

        choices.forEach(timeframe => {
            const option = document.createElement("option");
            option.value = timeframe;
            option.textContent = timeframe;
            timeframeSelect.appendChild(option);
        });

        if (choices.includes(previousValue)) {
            timeframeSelect.value = previousValue;
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
        tradingState.running ? "Market scanning active" : "Scanner stopped"
    );

    setText("liveLock", "LIVE TRADING LOCKED - DEMO ONLY");
}

/* BROKER PANELS */

function updateBrokerPanels() {
    const brokerType = getElement("brokerType");
    const selectedBroker = brokerType ? brokerType.value : "deriv";

    const derivPanel = getElement("derivPanel");
    const mt5Panel = getElement("mt5Panel");

    if (derivPanel) {
        derivPanel.style.display =
            selectedBroker === "deriv" ? "block" : "none";
    }

    if (mt5Panel) {
        mt5Panel.style.display =
            selectedBroker === "mt5" ? "block" : "none";
    }
}

function updateScannerBroker() {
    const scannerBroker = getElement("scannerBroker");
    if (!scannerBroker) return;

    tradingState.broker = scannerBroker.value;

    setStatus(
        "scannerStatus",
        tradingState.broker === "mt5"
            ? "MT5 requires a connected MT5 bridge."
            : tradingState.derivConnected
                ? "Deriv market data ready"
                : "Connect Deriv market data first."
    );

    updateDashboard();
}

/* DERIV CONNECTION */

function connectDeriv() {
    if (
        tradingState.derivSocket &&
        tradingState.derivSocket.readyState === WebSocket.OPEN
    ) {
        setStatus(
            "derivConnectionStatus",
            "Deriv market data is already connected."
        );
        return;
    }

    if (typeof WebSocket === "undefined") {
        setStatus(
            "derivConnectionStatus",
            "WebSocket is not supported by this browser."
        );
        return;
    }

    setStatus(
        "derivConnectionStatus",
        "Connecting to Deriv market data..."
    );

    let socket;

    try {
        socket = new WebSocket(DERIV_PUBLIC_WS);
    } catch (error) {
        setStatus(
            "derivConnectionStatus",
            "Connection failed: " + error.message
        );
        return;
    }

    tradingState.derivSocket = socket;

    socket.onopen = function () {
        tradingState.derivConnected = true;

        setStatus(
            "derivConnectionStatus",
            "Connected. Loading Deriv markets..."
        );

        socket.send(JSON.stringify({
            active_symbols: "brief",
            req_id: 1
        }));

        updateDashboard();
    };

    socket.onmessage = function (event) {
        let data;

        try {
            data = JSON.parse(event.data);
        } catch (error) {
            console.error("Invalid Deriv message:", error);
            return;
        }

        handleDerivMessage(data);
    };

    socket.onerror = function () {
        setStatus(
            "derivConnectionStatus",
            "Connection error. Check your internet."
        );
    };

    socket.onclose = function () {
        tradingState.derivConnected = false;
        tradingState.derivSocket = null;
        tradingState.subscriptions = {};

        setStatus(
            "derivConnectionStatus",
            "Deriv market data disconnected."
        );

        updateDashboard();
    };
}

/* DERIV MESSAGES */

function handleDerivMessage(data) {
    if (data.error) {
        console.error("Deriv error:", data.error);

        setStatus(
            "derivConnectionStatus",
            data.error.message || "Deriv API error."
        );
        return;
    }

    if (data.msg_type === "active_symbols") {
        loadAvailableSymbols(data.active_symbols || []);
        return;
    }

    if (data.msg_type === "tick" && data.tick) {
        updateLivePrice(data.tick);
    }
}

/* MARKET LIST */

function loadAvailableSymbols(symbols) {
    tradingState.availableSymbols = symbols.filter(symbol => {
        return symbol.symbol && symbol.display_name;
    });

    renderPairs();

    setStatus(
        "derivConnectionStatus",
        "Connected. " +
        tradingState.availableSymbols.length +
        " markets loaded."
    );

    updateDashboard();
}

function renderPairs() {
    const container = getElement("pairList");
    if (!container) return;

    container.innerHTML = "";

    if (tradingState.availableSymbols.length === 0) {
        container.textContent = "No markets loaded yet.";
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

        checkbox.addEventListener("change", function () {
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
            symbol.display_name + " (" + symbol.symbol + ")";

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

/* SELECT AND CLEAR PAIRS */

function selectAllPairs() {
    if (tradingState.availableSymbols.length === 0) {
        setStatus("scannerStatus", "Connect Deriv and load markets first.");
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
    const symbol = tick.symbol;
    if (!symbol) return;

    tradingState.lastPrices[symbol] = tick.quote;

    const priceElement = getElement("price-" + symbol);

    if (priceElement) {
        priceElement.textContent = tick.quote;
    }

    if (
        tradingState.selectedSymbols.includes(symbol) &&
        tradingState.running
    ) {
        updateScannerResults(symbol, tick.quote);
    }
}

/* SUBSCRIPTIONS */

function sendDerivMessage(message) {
    const socket = tradingState.derivSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    socket.send(JSON.stringify(message));
    return true;
}

function subscribeSymbol(symbol) {
    if (tradingState.subscriptions[symbol]) return;

    const sent = sendDerivMessage({
        ticks: symbol,
        subscribe: 1
    });

    if (sent) {
        tradingState.subscriptions[symbol] = true;
    }
}

function unsubscribeSymbol(symbol) {
    const subscription = tradingState.subscriptions[symbol];

    if (!subscription) return;

    if (typeof subscription === "string") {
        sendDerivMessage({ forget: subscription });
    }

    delete tradingState.subscriptions[symbol];
}

/* SCANNER */

function startScanner() {
    if (tradingState.broker === "mt5") {
        setStatus("scannerStatus", "MT5 bridge is not connected yet.");
        return;
    }

    if (!tradingState.derivConnected) {
        setStatus("scannerStatus", "Connect Deriv market data first.");
        return;
    }

    if (tradingState.selectedSymbols.length === 0) {
        setStatus("scannerStatus", "Select at least one market first.");
        return;
    }

    tradingState.running = true;

    tradingState.selectedSymbols.forEach(symbol => {
        subscribeSymbol(symbol);
    });

    setStatus(
        "scannerStatus",
        "Live prices streaming. APA analysis engine is not yet active."
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
    const results = getElement("scannerResults");
    if (!results) return;

    let row = getElement("result-" + symbol);

    if (!row) {
        row = document.createElement("div");
        row.id = "result-" + symbol;
        row.className = "scanner-result";
        results.appendChild(row);
    }

    row.textContent =
        symbol + " | Live price: " + price +
        " | APA analysis pending";
}

/* DISCONNECT */

function disconnectDeriv() {
    stopScanner();

    const socket = tradingState.derivSocket;

    tradingState.derivConnected = false;
    tradingState.availableSymbols = [];
    tradingState.selectedSymbols = [];
    tradingState.subscriptions = {};
    tradingState.lastPrices = {};

    if (socket) {
        socket.onclose = null;
        socket.close();
    }

    tradingState.derivSocket = null;

    renderPairs();

    setStatus("derivConnectionStatus", "Disconnected from Deriv.");
    updateDashboard();
}

/* MT5 PLACEHOLDER */

function connectMT5() {
    tradingState.mt5Connected = false;

    setStatus(
        "mt5ConnectionStatus",
        "MT5 bridge or Expert Advisor is required."
    );
}

/* CLOUD WORKER */

async function checkCloudWorker() {
    try {
        const response = await fetch(CLOUD_WORKER_URL + "health");

        if (!response.ok) {
            throw new Error("Worker returned HTTP " + response.status);
        }

        const result = await response.json();

        setText(
            "cloudStatus",
            result.status || result.message || "Cloud Worker online"
        );
    } catch (error) {
        setText("cloudStatus", "Cloud Worker unavailable");
        console.error("Cloud Worker check:", error);
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
        const element = getElement(id);
        if (element) settings[id] = element.value;
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
            const element = getElement(id);
            if (!element) return;

            if (element.type === "checkbox") {
                element.checked = Boolean(settings[id]);
            } else {
                element.value = settings[id];
            }
        });
    } catch (error) {
        console.error("Could not load settings:", error);
    }
}

/* DEMO ONLY SAFETY */

function enforceDemoOnly() {
    tradingState.demo = true;
    tradingState.liveLocked = true;

    const executionMode = getElement("executionMode");

    if (executionMode) {
        executionMode.value = "demo";
    }

    const liveOption = document.querySelector(
        '#executionMode option[value="live"]'
    );

    if (liveOption) liveOption.disabled = true;

    setText("liveLock", "LIVE TRADING LOCKED - DEMO ONLY");
}

/* INITIALIZE */

function initializeApp() {
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", function () {
            const page = this.dataset.page;
            if (page) showSection(page);
        });
    });

    const mode = getElement("tradingStyle");

    if (mode) {
        mode.addEventListener("change", updateMode);
    }

    const buttons = {
        connectDeriv: connectDeriv,
        disconnectDeriv: disconnectDeriv,
        selectAllPairs: selectAllPairs,
        clearPairs: clearPairs,
        startScanner: startScanner,
        stopScanner: stopScanner,
        saveSettings: saveSettings,
        connectMT5: connectMT5
    };

    Object.keys(buttons).forEach(id => {
        const button = getElement(id);

        if (button) {
            button.addEventListener("click", buttons[id]);
        }
    });

    const brokerType = getElement("brokerType");

    if (brokerType) {
        brokerType.addEventListener("change", updateBrokerPanels);
    }

    const scannerBroker = getElement("scannerBroker");

    if (scannerBroker) {
        scannerBroker.addEventListener("change", updateScannerBroker);
    }

    loadSettings();
    enforceDemoOnly();

    if (mode) updateMode();

    updateBrokerPanels();
    updateScannerBroker();

    showSection("dashboard");

    checkCloudWorker();
    updateDashboard();

    console.log("SMC Sniper Pro APA initialized.");
}

/* START APP */

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}
