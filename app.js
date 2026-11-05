
"use strict";

// SMC Sniper Pro APA
// Dashboard and connection foundation.
// Live trading is deliberately disabled.

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
    selectedSymbols: []
};

const CLOUD_WORKER_URL =
    "https://smc-sniper-oauth.henryssenkubuge38.workers.dev/";

// HTML helper
function getElement(id) {
    return document.getElementById(id);
}

function setText(id, message) {
    const element = getElement(id);

    if (element) {
        element.textContent = message;
    }
}

// Navigation
function showSection(sectionId) {
    document.querySelectorAll(".page").forEach(page => {
        page.classList.remove("active");
        page.classList.add("hidden");
    });

    const section = getElement(sectionId);

    if (section) {
        section.classList.remove("hidden");
        section.classList.add("active");
    }

    document.querySelectorAll(".nav-btn").forEach(button => {
        button.classList.toggle(
            "active",
            button.dataset.page === sectionId
        );
    });
}

// Trading style and timeframes
function updateMode() {
    const selector = getElement("tradingStyle");

    if (!selector) return;

    const mode = selector.value;
    tradingState.mode = mode;

    const timeframe = getElement("timeframe");

    const choices = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    timeframe.innerHTML = "";

    (choices[mode] || choices.scalping).forEach(tf => {
        const option = document.createElement("option");

        option.value = tf;
        option.textContent = tf;

        timeframe.appendChild(option);
    });
}

// Dashboard status
function updateDashboard() {
    setText(
        "systemStatus",
        tradingState.derivConnected
            ? "Deriv market data connected"
            : "Not connected"
    );

    setText(
        "brokerStatus",
        tradingState.derivConnected
            ? "Broker: Deriv market data"
            : tradingState.mt5Connected
                ? "Broker: MT5 bridge"
                : "Broker: Not connected"
    );

    setText(
        "scannerStatus",
        tradingState.running
            ? "Scanner request received; APA engine not connected"
            : "Scanner: Stopped"
    );

    setText(
        "pairCount",
        tradingState.selectedSymbols.length
    );

    setText(
        "selectedPairCount",
        tradingState.selectedSymbols.length + " pairs selected"
    );
}

// Broker selection
function updateBrokerPanels() {
    const type = getElement("brokerType").value;

    getElement("derivPanel").classList.toggle(
        "hidden",
        type !== "deriv"
    );

    getElement("mt5Panel").classList.toggle(
        "hidden",
        type !== "mt5"
    );
}

// Scanner broker selection
function updateScannerBroker() {
    const broker = getElement("scannerBroker").value;

    tradingState.broker = broker;

    tradingState.selectedSymbols = [];

    renderPairs();

    if (broker === "deriv") {
        setText(
            "scannerResults",
            "Select Deriv instruments after connecting to Deriv."
        );
    } else {
        setText(
            "scannerResults",
            "MT5 instruments will appear after a compatible MT5 bridge is configured."
        );
    }

    updateDashboard();
}

// Render available instruments
function renderPairs() {
    const container = getElement("pairList");

    container.innerHTML = "";

    if (tradingState.broker === "deriv") {
        if (tradingState.availableSymbols.length === 0) {
            container.textContent =
                "Connect Deriv to discover available instruments.";

            return;
        }

        tradingState.availableSymbols.forEach(symbol => {
            const label = document.createElement("label");

            const checkbox = document.createElement("input");

            checkbox.type = "checkbox";
            checkbox.value = symbol.symbol;

            checkbox.checked =
                tradingState.selectedSymbols.includes(symbol.symbol);

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    if (!tradingState.selectedSymbols.includes(symbol.symbol)) {
                        tradingState.selectedSymbols.push(symbol.symbol);
                    }
                } else {
                    tradingState.selectedSymbols =
                        tradingState.selectedSymbols.filter(
                            item => item !== symbol.symbol
                        );
                }

                updateDashboard();
            });

            const name = document.createElement("span");

            name.textContent =
                symbol.display_name + " (" + symbol.symbol + ")";

            label.appendChild(checkbox);
            label.appendChild(name);

            container.appendChild(label);
        });

    } else {
        container.textContent =
            "MT5 symbol discovery requires the MT5 execution bridge.";
    }
}

// Select all available pairs
function selectAllPairs() {
    if (tradingState.broker !== "deriv") {
        setText(
            "scannerResults",
            "Connect the MT5 bridge before selecting MT5 instruments."
        );

        return;
    }

    tradingState.selectedSymbols =
        tradingState.availableSymbols.map(item => item.symbol);

    renderPairs();
    updateDashboard();
}

// Clear selected pairs
function clearPairs() {
    tradingState.selectedSymbols = [];

    renderPairs();
    updateDashboard();
}

// Deriv public market-data connection

function connectDeriv() {
    const CLIENT_ID = "34PG0A117Y8MMt1O0h3IW";
    const REDIRECT_URI =
        "https://ssenkubuge731.github.io/Smc-sniper-pro/";

    const verifierBytes = crypto.getRandomValues(
        new Uint8Array(64)
    );

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const verifier = Array.from(verifierBytes)
        .map(b => chars[b % chars.length])
        .join("");

    crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier)
    ).then(hash => {
        const challenge = btoa(
            String.fromCharCode(...new Uint8Array(hash))
        )
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

        const stateBytes = crypto.getRandomValues(
            new Uint8Array(16)
        );

        const state = Array.from(stateBytes)
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");

        sessionStorage.setItem("deriv_pkce_verifier", verifier);
        sessionStorage.setItem("deriv_oauth_state", state);

        const params = new URLSearchParams({
            response_type: "code",
            client_id: CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            scope: "trade",
            state: state,
            code_challenge: challenge,
            code_challenge_method: "S256"
        });

        window.location.href =
            "https://auth.deriv.com/oauth2/auth?" +
            params.toString();
    }).catch(error => {
        console.error(error);
        setText(
            "derivConnectionStatus",
            "Could not start Deriv OAuth."
        );
    });
}


    if (!appId) {
        setText("derivConnectionStatus","Enter your Deriv App ID."
        return;
    }

    disconnectDeriv(false);

    setText(
        "derivConnectionStatus",
        "Connecting to Deriv market data..."
    );

    let socket;

    try {
        socket = new WebSocket(
            "wss://ws.derivws.com/websockets/v3?app_id=" + appId
        );

        tradingState.derivSocket = socket;

        socket.onopen = () => {
            setText(
                "derivConnectionStatus",
                "Connected. Requesting available instruments..."
            );

            socket.send(JSON.stringify({
                active_symbols: "brief",
                product_type: "basic"
            }));
        };

        socket.onmessage = event => {
            let data;

            try {
                data = JSON.parse(event.data);
            } catch (error) {
                return;
            }

            if (data.error) {
                setText(
                    "derivConnectionStatus",
                    "Deriv error: " + data.error.message
                );

                return;
            }

            if (data.msg_type === "active_symbols") {
                tradingState.availableSymbols =
                    (data.active_symbols || []).map(item => ({
                        symbol: item.symbol,
                        display_name:
                            item.display_name || item.symbol
                    }));

                tradingState.derivConnected = true;

                setText(
                    "derivConnectionStatus",
                    "Connected. " +
                    tradingState.availableSymbols.length +
                    " instruments discovered."
                );

                setText(
                    "marketTrend",
                    "Market data connection available"
                );

                renderPairs();
                updateDashboard();
            }
        };

        socket.onerror = () => {
            setText(
                "derivConnectionStatus",
                "Connection error. Check your internet and App ID."
            );
        };

        socket.onclose = () => {
            tradingState.derivConnected = false;
            tradingState.derivSocket = null;

            setText(
                "derivConnectionStatus",
                "Deriv connection closed."
            );

            updateDashboard();
        };

    } catch (error) {
        setText(
            "derivConnectionStatus",
            "Could not create Deriv connection."
        );
    }
}

// Disconnect Deriv
function disconnectDeriv(updateStatus = true) {
    const socket = tradingState.derivSocket;

    tradingState.derivConnected = false;
    tradingState.availableSymbols = [];
    tradingState.selectedSymbols = [];

    if (socket) {
        tradingState.derivSocket = null;
        socket.close();
    }

    if (updateStatus) {
        setText("derivConnectionStatus", "Disconnected.");

        renderPairs();
        updateDashboard();
    }
}

// Cloud Worker health check
async function checkCloudWorker() {
    setText("cloudStatus", "Checking Cloudflare Worker...");

    try {
        const response = await fetch(CLOUD_WORKER_URL, {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        setText(
            "cloudStatus",
            "Cloudflare Worker responded successfully. Trading services not yet verified."
        );

    } catch (error) {
        setText(
            "cloudStatus",
            "Worker could not be verified. Check its existing endpoint and settings."
        );
    }
}

// MT5 bridge placeholder
function connectMT5() {
    const broker = getElement("mt5Broker").value;
    const server = getElement("mt5Server").value.trim();

    if (!broker || !server) {
        setText(
            "mt5ConnectionStatus",
            "Choose a broker and enter its server name."
        );

        return;
    }

    tradingState.mt5Connected = false;

    setText(
        "mt5ConnectionStatus",
        "Details saved locally. A secure MT5 bridge endpoint and running MT5 terminal are still required."
    );

    updateDashboard();
}

// Scanner controls
function startScanner() {
    if (tradingState.selectedSymbols.length === 0) {
        setText(
            "scannerResults",
            "Please connect a broker and select at least one instrument."
        );

        return;
    }

    if (
        tradingState.broker === "deriv" &&
        !tradingState.derivConnected
    ) {
        setText(
            "scannerResults",
            "Deriv market data is not connected."
        );

        return;
    }

    if (tradingState.broker === "mt5") {
        setText(
            "scannerResults",
            "MT5 bridge is not connected."
        );

        return;
    }

    tradingState.running = false;

    setText(
        "scannerResults",
        "Your " +
        tradingState.selectedSymbols.length +
        " selected instruments are ready. The APA strategy engine is not yet connected, so no trading signals are being generated."
    );

    setText(
        "entrySignal",
        "Strategy engine not connected"
    );

    updateDashboard();
}

function stopScanner() {
    tradingState.running = false;

    setText(
        "scannerResults",
        "Scanner stopped."
    );

    updateDashboard();
}

// Save and validate manual risk settings
function saveSettings() {
    const risk = Number(getElement("riskPercent").value);
    const lot = Number(getElement("lotSize").value);
    const stopLoss = Number(getElement("stopLoss").value);
    const takeProfit = Number(getElement("takeProfit").value);
    const maxTrades = Number(getElement("maxTrades").value);
    const dailyLimit = Number(getElement("dailyLossLimit").value);

    if (!Number.isFinite(risk) || risk <= 0 || risk > 1) {
        setText(
            "settingsStatus",
            "Risk must be greater than 0 and no more than 1%."
        );

        return;
    }

    if (!Number.isFinite(lot) || lot <= 0) {
        setText("settingsStatus", "Enter a valid lot size.");
        return;
    }

    if (!Number.isFinite(stopLoss) || stopLoss <= 0) {
        setText("settingsStatus", "Enter a valid stop-loss.");
        return;
    }

    if (!Number.isFinite(takeProfit) || takeProfit <= 0) {
        setText("settingsStatus", "Enter a valid take-profit.");
        return;
    }

    if (
        !Number.isInteger(maxTrades) ||
        maxTrades < 1 ||
        maxTrades > 20
    ) {
        setText(
            "settingsStatus",
            "Maximum open trades must be between 1 and 20."
        );

        return;
    }

    if (
        !Number.isFinite(dailyLimit) ||
        dailyLimit <= 0 ||
        dailyLimit > 10
    ) {
        setText(
            "settingsStatus",
            "Daily loss limit must be greater than 0 and no more than 10%."
        );

        return;
    }

    const settings = {
        risk,
        lot,
        stopLoss,
        takeProfit,
        maxTrades,
        dailyLimit,
        useAPA: getElement("useAPA").checked,
        useSMC: getElement("useSMC").checked,
        useEMA: getElement("useEMA").checked,
        useRSI: getElement("useRSI").checked,
        useATR: getElement("useATR").checked,
        useBOS: getElement("useBOS").checked,
        useMSS: getElement("useMSS").checked,
        useCHoCH: getElement("useCHoCH").checked,
        useLiquidity: getElement("useLiquidity").checked,
        useOB: getElement("useOB").checked,
        useFVG: getElement("useFVG").checked,
        useBreaker: getElement("useBreaker").checked,
        useSupplyDemand: getElement("useSupplyDemand").checked
    };

    try {
        localStorage.setItem(
            "smcSniperSettings",
            JSON.stringify(settings)
        );

        setText(
            "settingsStatus",
            "Settings saved in this browser. Cloud risk engine not yet connected."
        );

    } catch (error) {
        setText(
            "settingsStatus",
            "Could not save settings in this browser."
        );
    }
}

// Restore saved settings
function loadSettings() {
    try {
        const saved = localStorage.getItem("smcSniperSettings");

        if (!saved) return;

        const settings = JSON.parse(saved);

        const fields = {
            riskPercent: settings.risk,
            lotSize: settings.lot,
            stopLoss: settings.stopLoss,
            takeProfit: settings.takeProfit,
            maxTrades: settings.maxTrades,
            dailyLossLimit: settings.dailyLimit
        };

        Object.entries(fields).forEach(([id, value]) => {
            if (value !== undefined && getElement(id)) {
                getElement(id).value = value;
            }
        });

        const checkboxes = [
            "useAPA", "useSMC", "useEMA", "useRSI",
            "useATR", "useBOS", "useMSS", "useCHoCH",
            "useLiquidity", "useOB", "useFVG",
            "useBreaker", "useSupplyDemand"
        ];

        checkboxes.forEach(id => {
            if (typeof settings[id] === "boolean") {
                getElement(id).checked = settings[id];
            }
        });

    } catch (error) {
        setText("settingsStatus", "Saved settings could not be restored.");
    }
}

// Application initialization
document.addEventListener("DOMContentLoaded", () => {

    // Navigation
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", () => {
            showSection(button.dataset.page);
        });
    });

    // Trading style
    getElement("tradingStyle").addEventListener(
        "change",
        updateMode
    );

    // Broker controls
    getElement("brokerType").addEventListener(
        "change",
        updateBrokerPanels
    );

    getElement("scannerBroker").addEventListener(
        "change",
        updateScannerBroker
    );

    getElement("connectDeriv").addEventListener(
        "click",
        connectDeriv
    );

    getElement("disconnectDeriv").addEventListener(
        "click",
        () => disconnectDeriv()
    );

    getElement("connectMT5").addEventListener(
        "click",
        connectMT5
    );

    // Pair controls
    getElement("selectAllPairs").addEventListener(
        "click",
        selectAllPairs
    );

    getElement("clearPairs").addEventListener(
        "click",
        clearPairs
    );

    // Scanner controls
    getElement("startScanner").addEventListener(
        "click",
        startScanner
    );

    getElement("stopScanner").addEventListener(
        "click",
        stopScanner
    );

    // Settings
    getElement("saveSettings").addEventListener(
        "click",
        saveSettings
    );

    // Initialize
    updateMode();
    updateBrokerPanels();
    updateScannerBroker();
    loadSettings();

    showSection("dashboard");

    checkCloudWorker();

    updateDashboard();

    setText(
        "positionsList",
        "No live execution connection. No positions are being managed."
    );

    setText(
        "tradeHistory",
        "No completed trades available."
    );

});

