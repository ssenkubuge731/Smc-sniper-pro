"use strict";

/* =========================================================
   SMC SNIPER PRO APA
   Advanced Price Action
   PUBLIC MARKET DATA / DEMO MONITORING ONLY
   LIVE TRADING IS PERMANENTLY LOCKED IN THIS VERSION
========================================================= */

const DERIV_PUBLIC_WS =
    "wss://api.derivws.com/trading/v1/options/ws/public";

const CLOUD_WORKER_URL =
    "https://smc-sniper-oauth.henryssenkubuge38.workers.dev/";

/* -------------------- APP STATE -------------------- */

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
    lastPrices: {},
    subscriptions: {},

    nextRequestId: 1,
    connectionTimer: null
};

/* -------------------- HELPERS -------------------- */

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

function sendDerivRequest(request) {
    const socket = tradingState.derivSocket;

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        return false;
    }

    socket.send(JSON.stringify(request));
    return true;
}

function nextRequestId() {
    return tradingState.nextRequestId++;
}

function enforceDemoOnly() {
    tradingState.demo = true;
    tradingState.liveLocked = true;

    setText("liveLock", "DEMO ONLY — LIVE TRADING LOCKED");
}

/* -------------------- NAVIGATION -------------------- */

function showSection(name) {
    document.querySelectorAll(".page").forEach(page => {
        page.style.display = "none";
    });

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.remove("active");
    });

    const page = el(name);

    if (page) {
        page.style.display = "block";
    }

    const navButton = document.querySelector(
        '.nav-btn[data-page="' + name + '"]'
    );

    if (navButton) {
        navButton.classList.add("active");
    }
}

/* -------------------- TRADING STYLE -------------------- */

function updateMode() {
    const styleElement = el("tradingStyle");

    if (!styleElement) return;

    tradingState.mode = styleElement.value;

    const timeframeElement = el("timeframe");

    if (!timeframeElement) return;

    const timeframes = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    const allowed = timeframes[tradingState.mode] ||
        timeframes.scalping;

    const previousValue = timeframeElement.value;

    timeframeElement.innerHTML = "";

    allowed.forEach(timeframe => {
        const option = document.createElement("option");
        option.value = timeframe;
        option.textContent = timeframe;
        timeframeElement.appendChild(option);
    });

    if (allowed.includes(previousValue)) {
        timeframeElement.value = previousValue;
    } else {
        timeframeElement.value = allowed[0];
    }
}

/* -------------------- BROKER DISPLAY -------------------- */

function updateBrokerPanels() {
    const brokerElement = el("brokerType");

    if (brokerElement) {
        tradingState.broker = brokerElement.value;
    }
}

function updateScannerBroker() {
    const brokerElement = el("scannerBroker");

    if (!brokerElement) return;

    tradingState.broker = brokerElement.value;

    if (tradingState.broker === "mt5") {
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

/* -------------------- CLOUD WORKER -------------------- */

async function checkCloudWorker() {
    setStatus("cloudStatus", "Checking cloud worker...");

    try {
        const response = await fetch(CLOUD_WORKER_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (response.ok) {
            setStatus("cloudStatus", "Cloud worker is reachable.");
        } else {
            setStatus(
                "cloudStatus",
                "Cloud worker responded with HTTP " + response.status +
                ". Market data can still work separately."
            );
        }
    } catch (error) {
        setStatus(
            "cloudStatus",
            "Cloud worker could not be reached. Market data can still work separately."
        );
    }
}

/* -------------------- DERIV CONNECTION -------------------- */

function connectDeriv() {
    if (
        tradingState.derivSocket &&
        (
            tradingState.derivSocket.readyState === WebSocket.OPEN ||
            tradingState.derivSocket.readyState === WebSocket.CONNECTING
        )
    ) {
        setStatus("derivStatus", "Deriv connection is already open or connecting.");
        return;
    }

    if (typeof WebSocket === "undefined") {
        setStatus("derivStatus", "This browser does not support WebSocket.");
        return;
    }

    setStatus("derivStatus", "Connecting to Deriv public market data...");
    setStatus("brokerStatus", "Connecting to Deriv...");

    try {
        const socket = new WebSocket(DERIV_PUBLIC_WS);
        tradingState.derivSocket = socket;

        tradingState.connectionTimer = setTimeout(() => {
            if (socket.readyState === WebSocket.CONNECTING) {
                setStatus(
                    "derivStatus",
                    "Connection is taking too long. Check your internet and try again."
                );
                socket.close();
            }
        }, 15000);

        socket.onopen = function() {
            clearTimeout(tradingState.connectionTimer);

            tradingState.derivConnected = true;

            setStatus("derivStatus", "Connected. Loading Deriv markets...");
            setStatus("brokerStatus", "Deriv market data connected");

            socket.send(JSON.stringify({
                active_symbols: "brief",
                req_id: nextRequestId()
            }));

            updateDashboard();
        };

        socket.onmessage = function(event) {
            let data;

            try {
                data = JSON.parse(event.data);
            } catch (error) {
                console.error("Invalid Deriv message:", error);
                return;
            }

            handleDerivMessage(data);
        };

        socket.onerror = function() {
            setStatus(
                "derivStatus",
                "Deriv connection error. Check your internet or try again."
            );
        };

        socket.onclose = function() {
            clearTimeout(tradingState.connectionTimer);

            tradingState.derivConnected = false;
            tradingState.running = false;
            tradingState.derivSocket = null;
            tradingState.subscriptions = {};

            setStatus("derivStatus", "Deriv disconnected.");
            setStatus("brokerStatus", "Not connected");
            setStatus("scannerStatus", "Scanner stopped");

            updateDashboard();
        };

    } catch (error) {
        console.error(error);
        setStatus("derivStatus", "Could not create Deriv connection.");
    }
}

function disconnectDeriv() {
    stopScanner();

    const socket = tradingState.derivSocket;

    if (socket) {
        socket.close();
    } else {
        tradingState.derivConnected = false;
        setStatus("derivStatus", "Deriv disconnected.");
        setStatus("brokerStatus", "Not connected");
        updateDashboard();
    }
}

/* -------------------- DERIV MESSAGE HANDLER -------------------- */

function handleDerivMessage(data) {
    if (data.error) {
        console.error("Deriv API error:", data.error);

        setStatus(
            "derivStatus",
            "Deriv error: " + (
                data.error.message || "Unknown API error"
            )
        );

        return;
    }

    if (data.msg_type === "active_symbols" && Array.isArray(data.active_symbols)) {
        loadMarkets(data.active_symbols);
        return;
    }

    if (data.msg_type === "tick" && data.tick) {
        updateLivePrice(data.tick, data.subscription);
        return;
    }
}

/* -------------------- MARKET LOADING -------------------- */

function loadMarkets(markets) {
    tradingState.availableSymbols = markets.filter(market => {
        return market && market.symbol;
    });

    renderMarkets();

    setStatus(
        "derivStatus",
        "Connected. " + tradingState.availableSymbols.length +
        " markets loaded successfully."
    );

    updateDashboard();
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
    ) {
        return "Forex";
    }

    if (
        name.includes("gold") ||
        name.includes("xau") ||
        name.includes("metal")
    ) {
        return "Gold";
    }

    if (
        name.includes("index") ||
        name.includes("volatility") ||
        name.includes("crash") ||
        name.includes("boom") ||
        name.includes("step") ||
        name.includes("jump") ||
        name.includes("range")
    ) {
        return "Deriv Indices";
    }

    return "Other";
}

function renderMarkets() {
    const container = el("marketList");

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
        const category = getMarketCategory(market);
        groups[category].push(market);
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

            checkbox.checked = tradingState.selectedSymbols.includes(
                market.symbol
            );

            checkbox.addEventListener("change", function() {
                updateSelectedMarkets();
            });

            const name = document.createElement("span");
            name.textContent =
                (market.display_name || market.symbol) +
                " (" + market.symbol + ")";

            const price = document.createElement("span");
            price.id = "price-" + market.symbol;
            price.className = "market-price";

            if (tradingState.lastPrices[market.symbol] !== undefined) {
                price.textContent = tradingState.lastPrices[market.symbol];
            } else {
                price.textContent = "--";
            }

            label.appendChild(checkbox);
            label.appendChild(name);
            label.appendChild(price);

            container.appendChild(label);
        });
    });
}

function updateSelectedMarkets() {
    const checkboxes = document.querySelectorAll(
        "#marketList input[data-market-symbol]"
    );

    tradingState.selectedSymbols = [];

    checkboxes.forEach(checkbox => {
        if (checkbox.checked) {
            tradingState.selectedSymbols.push(checkbox.value);
        }
    });

    updateDashboard();
}

function selectAllPairs() {
    tradingState.selectedSymbols = tradingState.availableSymbols.map(
        market => market.symbol
    );

    renderMarkets();
    updateDashboard();
}

function clearPairs() {
    tradingState.selectedSymbols = [];

    renderMarkets();
    updateDashboard();
}

/* -------------------- LIVE PRICE STREAM -------------------- */

function subscribeSymbol(symbol) {
    if (!tradingState.derivConnected) return;

    if (tradingState.subscriptions[symbol]) return;

    const requestId = nextRequestId();

    const sent = sendDerivRequest({
        ticks: symbol,
        subscribe: 1,
        req_id: requestId
    });

    if (sent) {
        tradingState.subscriptions[symbol] = {
            requestId: requestId,
            subscriptionId: null
        };
    }
}

function unsubscribeSymbol(symbol) {
    const subscription = tradingState.subscriptions[symbol];

    if (
        subscription &&
        subscription.subscriptionId
    ) {
        sendDerivRequest({
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

/* -------------------- SCANNER -------------------- */

function startScanner() {
    if (tradingState.broker === "mt5") {
        setStatus(
            "scannerStatus",
            "MT5 bridge is not connected. Select Deriv for public market scanning."
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
            "Select at least one market before starting."
        );
        return;
    }

    tradingState.running = true;

    const results = el("scannerResults");

    if (results) {
        results.textContent =
            "Scanner started. Waiting for live prices...";
    }

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

    const rowId = "scanner-result-" + symbol;
    let row = el(rowId);

    if (!row) {
        row = document.createElement("p");
        row.id = rowId;
        container.appendChild(row);
    }

    row.textContent =
        symbol + " | Price: " + price +
        " | APA analysis pending";
}

/* -------------------- SETTINGS -------------------- */

function saveSettings() {
    const settings = {
        riskPercent: el("riskPercent")
            ? el("riskPercent").value
            : "0.5",

        maxTrades: el("maxTrades")
            ? el("maxTrades").value
            : "2",

        dailyLossLimit: el("dailyLossLimit")
            ? el("dailyLossLimit").value
            : "2",

        pauseLosses: el("pauseLosses")
            ? el("pauseLosses").value
            : "3",

        tradingStyle: el("tradingStyle")
            ? el("tradingStyle").value
            : "scalping",

        timeframe: el("timeframe")
            ? el("timeframe").value
            : "M1",

        derivAppId: el("derivAppId")
            ? el("derivAppId").value.trim()
            : ""
    };

    if (
        Number(settings.riskPercent) <= 0 ||
        Number(settings.riskPercent) > 5 ||
        Number(settings.maxTrades) < 1 ||
        Number(settings.dailyLossLimit) <= 0 ||
        Number(settings.pauseLosses) < 1
    ) {
        setStatus(
            "settingsStatus",
            "Check your risk settings. Values are outside the allowed limits."
        );
        return;
    }

    try {
        localStorage.setItem(
            "smcSniperAPASettings",
            JSON.stringify(settings)
        );

        setStatus("settingsStatus", "Settings saved on this device.");
        setStatus("scannerStatus", tradingState.running
            ? "Scanner running"
            : "Scanner stopped"
        );

    } catch (error) {
        setStatus(
            "settingsStatus",
            "Could not save settings in this browser."
        );
    }
}

function loadSettings() {
    try {
        const saved = localStorage.getItem("smcSniperAPASettings");

        if (!saved) return;

        const settings = JSON.parse(saved);

        const fields = [
            "riskPercent",
            "maxTrades",
            "dailyLossLimit",
            "pauseLosses",
            "derivAppId"
        ];

        fields.forEach(id => {
            if (el(id) && settings[id] !== undefined) {
                el(id).value = settings[id];
            }
        });

        if (el("tradingStyle") && settings.tradingStyle) {
            el("tradingStyle").value = settings.tradingStyle;
        }

        updateMode();

        if (
            el("timeframe") &&
            settings.timeframe &&
            Array.from(el("timeframe").options).some(
                option => option.value === settings.timeframe
            )
        ) {
            el("timeframe").value = settings.timeframe;
        }

    } catch (error) {
        console.error("Settings could not be loaded:", error);
    }
}

/* -------------------- MT5 PLACEHOLDER -------------------- */

function connectMT5() {
    tradingState.mt5Connected = false;

    setStatus(
        "mt5Status",
        "MT5 bridge is not configured yet. A separate MT5 Expert Advisor or bridge is required."
    );
}

/* -------------------- DASHBOARD -------------------- */

function updateDashboard() {
    setText(
        "systemStatus",
        tradingState.running ? "Scanner Running" : "System Ready"
    );

    setText(
        "pairCount",
        tradingState.availableSymbols.length
    );

    setText(
        "openTrades",
        "0"
    );

    setText(
        "brokerStatus",
        tradingState.derivConnected
            ? "Deriv market data connected"
            : "Not connected"
    );

    setText(
        "scannerStatus",
        tradingState.running
            ? "Scanner active"
            : "Scanner stopped"
    );

    enforceDemoOnly();
}

/* -------------------- INITIALIZATION -------------------- */

function initializeApp() {
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", function() {
            const page = this.dataset.page;

            if (page) {
                showSection(page);
            }
        });
    });

    const buttonEvents = {
        connectDeriv: connectDeriv,
        disconnectDeriv: 
