
"use strict";

// SMC Sniper Pro APA
// Demo only. Live trading remains locked.

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

// YOUR DERIV OAUTH APP ID
const DERIV_CLIENT_ID = "34PG0A117Y8MMt1O0h3IW";
const DERIV_REDIRECT_URI =
    "https://ssenkubuge731.github.io/Smc-sniper-pro/callback.html";

function getElement(id) {
    return document.getElementById(id);
}

function setText(id, message) {
    const element = getElement(id);
    if (element) element.textContent = message;
}

// NAVIGATION
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

// TIMEFRAMES
function updateMode() {
    const selector = getElement("tradingStyle");
    const timeframe = getElement("timeframe");

    if (!selector || !timeframe) return;

    const mode = selector.value;
    tradingState.mode = mode;

    const choices = {
        scalping: ["M1", "M5", "M15"],
        intraday: ["M30", "H1", "H4"],
        swing: ["H1", "H4", "D1"]
    };

    timeframe.replaceChildren();

    (choices[mode] || choices.scalping).forEach(tf => {
        const option = document.createElement("option");
        option.value = tf;
        option.textContent = tf;
        timeframe.appendChild(option);
    });
}

// DASHBOARD
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
            ? "Scanner request received"
            : "Scanner: Stopped"
    );

    setText("pairCount", String(tradingState.selectedSymbols.length));
    setText(
        "selectedPairCount",
        tradingState.selectedSymbols.length + " pairs selected"
    );
}

// BROKER PANELS
function updateBrokerPanels() {
    const selector = getElement("brokerType");
    const derivPanel = getElement("derivPanel");
    const mt5Panel = getElement("mt5Panel");

    if (!selector || !derivPanel || !mt5Panel) return;

    const isDeriv = selector.value === "deriv";

    derivPanel.classList.toggle("hidden", !isDeriv);
    mt5Panel.classList.toggle("hidden", isDeriv);
}

// SCANNER BROKER
function updateScannerBroker() {
    const selector = getElement("scannerBroker");
    if (!selector) return;

    tradingState.broker = selector.value;
    tradingState.selectedSymbols = [];

    renderPairs();

    setText(
        "scannerResults",
        tradingState.broker === "deriv"
            ? "Select Deriv instruments after connecting."
            : "MT5 instruments require a compatible MT5 bridge."
    );

    updateDashboard();
}

// PAIRS
function renderPairs() {
    const container = getElement("pairList");
    if (!container) return;

    container.replaceChildren();

    if (tradingState.broker !== "deriv") {
        container.textContent =
            "MT5 symbol discovery requires the MT5 bridge.";
        return;
    }

    if (!tradingState.availableSymbols.length) {
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

        label.append(checkbox, name);
        container.appendChild(label);
    });
}

function selectAllPairs() {
    if (tradingState.broker !== "deriv") {
        setText("scannerResults", "Connect the MT5 bridge first.");
        return;
    }

    tradingState.selectedSymbols =
        tradingState.availableSymbols.map(item => item.symbol);

    renderPairs();
    updateDashboard();
}

function clearPairs() {
    tradingState.selectedSymbols = [];
    renderPairs();
    updateDashboard();
}

// DERIV OAUTH CONNECTION
function connectDeriv() {
    const clientId = DERIV_CLIENT_ID;
    const redirectUri = DERIV_REDIRECT_URI;

    if (!window.crypto || !crypto.subtle) {
        setText(
            "derivConnectionStatus",
            "Secure OAuth requires HTTPS and a supported browser."
        );
        return;
    }

    const bytes = crypto.getRandomValues(new Uint8Array(64));

    const chars =
        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

    const verifier = Array.from(
        bytes,
        byte => chars[byte % chars.length]
    ).join("");

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

        const state = Array.from(
            stateBytes,
            byte => byte.toString(16).padStart(2, "0")
        ).join("");

        sessionStorage.setItem("deriv_pkce_verifier", verifier);
        sessionStorage.setItem("deriv_oauth_state", state);

        const params = new URLSearchParams({
            response_type: "code",
            client_id: clientId,
            redirect_uri: redirectUri,
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

async function handleDerivCallback() {
    const params = new URLSearchParams(window.location.search);

    const code = params.get("code");
    const returnedState = params.get("state");
    const oauthError = params.get("error");

    if (oauthError) {
        setText(
            "derivConnectionStatus",
            "Deriv authorization failed: " + oauthError
        );
        return;
    }

    if (!code) {
    setText(
        "derivConnectionStatus",
        "Callback received no authorization code. Check redirect URL."
    );
    return;
}

showSection("brokers");

    const savedState = sessionStorage.getItem("deriv_oauth_state");
    const verifier = sessionStorage.getItem("deriv_pkce_verifier");

    if (!savedState || returnedState !== savedState) {
        setText(
            "derivConnectionStatus",
            "OAuth state validation failed. Please reconnect."
        );
        return;
    }

    if (!verifier) {
        setText(
            "derivConnectionStatus",
            "PKCE verifier missing. Please reconnect."
        );
        return;
    }

    setText(
        "derivConnectionStatus",
        "Completing secure Deriv connection..."
    );

    try {
        const response = await fetch(
            CLOUD_WORKER_URL + "oauth/token",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    code: code,
                    code_verifier: verifier
                })
            }
        );

        const result = await response.json();

        if (!response.ok || !result.success ||
            !result.access_token) {
            throw new Error(
                result.details ||
                result.error ||
                "Token exchange failed."
            );
        }

        sessionStorage.setItem(
            "deriv_access_token",
            result.access_token
        );

        sessionStorage.setItem(
            "deriv_token_expiry",
            String(Date.now() + (result.expires_in || 0) * 1000)
        );

        sessionStorage.removeItem("deriv_pkce_verifier");
        sessionStorage.removeItem("deriv_oauth_state");

        tradingState.derivConnected = true;
showSection("brokers");
        setText(
            "derivConnectionStatus",
            "OAuth completed. Demo connection token received."
        );

        updateDashboard();

        // Remove the authorization code from the browser address.
        window.history.replaceState(
            {},
            document.title,
            DERIV_REDIRECT_URI
        );

    } catch (error) {
        console.error("Deriv OAuth callback error:", error);

        setText(
            "derivConnectionStatus",
            "Connection failed: " + error.message
        );
    }
}

// DISCONNECT DERIV
function disconnectDeriv(updateStatus = true) {
    const socket = tradingState.derivSocket;

    tradingState.derivSocket = null;
    tradingState.derivConnected = false;
    tradingState.availableSymbols = [];
    tradingState.selectedSymbols = [];

    if (socket) {
        socket.onclose = null;
        socket.close();
    }

    if (updateStatus) {
        setText("derivConnectionStatus", "Disconnected.");
        renderPairs();
        updateDashboard();
    }
}

// CLOUD WORKER
async function checkCloudWorker() {
    setText("cloudStatus", "Checking Cloudflare Worker...");

    try {
    const response = await fetch(CLOUD_WORKER_URL + "health", {
            method: "GET",
            cache: "no-store"
        });

        if (!response.ok) {
            throw new Error("HTTP " + response.status);
        }

        setText(
            "cloudStatus",
          "Cloud Worker Online. Health check successful."  
        );

    } catch (error) {
        setText(
            "cloudStatus",
            "Worker could not be verified."
        );
    }
}

// MT5 BRIDGE PLACEHOLDER
function connectMT5() {
    const brokerField = getElement("mt5Broker");
    const serverField = getElement("mt5Server");

    if (!brokerField || !serverField) return;

    const broker = brokerField.value;
    const server = serverField.value.trim();

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
        "Details entered locally. MT5 bridge and running terminal are still required."
    );

    updateDashboard();
}

// SCANNER
function startScanner() {
    if (!tradingState.selectedSymbols.length) {
        setText(
            "scannerResults",
            "Connect a broker and select at least one instrument."
        );
        return;
    }

    if (
        tradingState.broker === "deriv" &&
        !tradingState.derivConnected
    ) {
        setText("scannerResults", "Deriv is not connected.");
        return;
    }

    if (tradingState.broker === "mt5") {
        setText("scannerResults", "MT5 bridge is not connected.");
        return;
    }

    tradingState.running = false;

    setText(
        "scannerResults",
        "Instruments selected. APA strategy engine is not connected; no signals are generated."
    );

    setText("entrySignal", "Strategy engine not connected");
    updateDashboard();
}

function stopScanner() {
    tradingState.running = false;
    setText("scannerResults", "Scanner stopped.");
    updateDashboard();
}

// SAVE SETTINGS
function saveSettings() {
    const risk = Number(getElement("riskPercent")?.value);
    const lot = Number(getElement("lotSize")?.value);
    const stopLoss = Number(getElement("stopLoss")?.value);
    const takeProfit = Number(getElement("takeProfit")?.value);
    const maxTrades = Number(getElement("maxTrades")?.value);
    const dailyLimit = Number(getElement("dailyLossLimit")?.value);

    if (!Number.isFinite(risk) || risk <= 0 || risk > 1) {
        setText("settingsStatus", "Risk must be above 0 and at most 1%.");
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

    if (!Number.isInteger(maxTrades) || maxTrades < 1 || maxTrades > 20) {
        setText("settingsStatus", "Maximum trades must be between 1 and 20.");
        return;
    }

    if (!Number.isFinite(dailyLimit) || dailyLimit <= 0 || dailyLimit > 10) {
        setText("settingsStatus", "Daily loss limit must be above 0 and at most 10%.");
        return;
    }

    const checkboxIds = [
        "useAPA", "useSMC", "useEMA", "useRSI", "useATR",
        "useBOS", "useMSS", "useCHoCH", "useLiquidity",
        "useOB", "useFVG", "useBreaker", "useSupplyDemand"
    ];

    const settings = {
        risk,
        lot,
        stopLoss,
        takeProfit,
        maxTrades,
        dailyLimit
    };

    checkboxIds.forEach(id => {
        const field = getElement(id);
        if (field) settings[id] = field.checked;
    });

    try {
        localStorage.setItem(
            "smcSniperSettings",
            JSON.stringify(settings)
        );

        setText(
            "settingsStatus",
            "Settings saved in this browser."
        );

    } catch (error) {
        setText("settingsStatus", "Could not save settings.");
    }
}

// LOAD SETTINGS
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
            const field = getElement(id);
            if (field && value !== undefined) {
                field.value = value;
            }
        });

        [
            "useAPA", "useSMC", "useEMA", "useRSI", "useATR",
            "useBOS", "useMSS", "useCHoCH", "useLiquidity",
            "useOB", "useFVG", "useBreaker", "useSupplyDemand"
        ].forEach(id => {
            const field = getElement(id);
            if (field && typeof settings[id] === "boolean") {
                field.checked = settings[id];
            }
        });

    } catch (error) {
        setText("settingsStatus", "Saved settings could not be restored.");
    }
}

// INITIALIZE APP
function initializeApp() {
    document.querySelectorAll(".nav-btn").forEach(button => {
        button.addEventListener("click", () => {
            showSection(button.dataset.page);
        });
    });

    const bind = (id, event, handler) => {
        const element = getElement(id);
        if (element) element.addEventListener(event, handler);
    };

    bind("tradingStyle", "change", updateMode);
    bind("brokerType", "change", updateBrokerPanels);
    bind("scannerBroker", "change", updateScannerBroker);
    bind("connectDeriv", "click", connectDeriv);
    bind("disconnectDeriv", "click", () => disconnectDeriv());
    bind("connectMT5", "click", connectMT5);
    bind("selectAllPairs", "click", selectAllPairs);
    bind("clearPairs", "click", clearPairs);
    bind("startScanner", "click", startScanner);
    bind("stopScanner", "click", stopScanner);
    bind("saveSettings", "click", saveSettings);

    updateMode();
    updateBrokerPanels();
    updateScannerBroker();
loadSettings();
showSection("dashboard");
handleDerivCallback();
checkCloudWorker();
updateDashboard();
    setText(
        "positionsList",
        "No live execution connection. No positions are being managed."
    );

    setText("tradeHistory", "No completed trades available.");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initializeApp);
} else {
    initializeApp();
}


