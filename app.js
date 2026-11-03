
"use strict";

// SMC Sniper Pro APA Dashboard

const tradingState = {
    mode: "Scalping",
    demo: true,
    liveLocked: true,
    running: false
};

// Navigation
function showSection(sectionId) {
    document.querySelectorAll(".panel").forEach(panel => {
        panel.classList.add("hidden");
    });

    const section = document.getElementById(sectionId);

    if (section) {
        section.classList.remove("hidden");
    }
}

// Trading mode
function updateMode() {
    const mode = document.getElementById("mode").value;

    tradingState.mode = mode;

    document.getElementById("currentMode").textContent = mode;

    const timeframe = document.getElementById("timeframe");

    timeframe.innerHTML = "";

    let timeframes = [];

    if (mode === "Scalping") {
        timeframes = ["M1", "M5", "M15"];
    } else if (mode === "Intraday") {
        timeframes = ["M30", "H1", "H4"];
    } else {
        timeframes = ["H1", "H4", "D1"];
    }

    timeframes.forEach(tf => {
        const option = document.createElement("option");
        option.value = tf;
        option.textContent = tf;
        timeframe.appendChild(option);
    });
}

// Scanner placeholder
function scanMarket() {
    document.getElementById("scanResult").textContent =
        "Scanner waiting for cloud market data connection.";
}

// Demo trading controls
function startDemo() {
    if (tradingState.liveLocked !== true) {
        return;
    }

    tradingState.running = true;

    document.getElementById("tradingStatus").textContent =
        "Demo mode selected. Cloud execution connection required.";
}

function stopDemo() {
    tradingState.running = false;

    document.getElementById("tradingStatus").textContent =
        "Trading stopped locally. Cloud positions must be managed separately.";
}

// Risk settings
function saveRisk() {
    const risk = Number(document.getElementById("riskPercent").value);
    const maxTrades = Number(document.getElementById("maxTrades").value);

    if (!Number.isFinite(risk) || risk <= 0 || risk > 5) {
        document.getElementById("riskStatus").textContent =
            "Risk must be greater than 0 and no more than 5%.";
        return;
    }

    if (!Number.isInteger(maxTrades) || maxTrades < 1) {
        document.getElementById("riskStatus").textContent =
            "Maximum trades must be at least 1.";
        return;
    }

    document.getElementById("riskStatus").textContent =
        "Settings validated locally. Cloud risk configuration not connected.";
}

// Initialize dashboard
document.addEventListener("DOMContentLoaded", () => {
    updateMode();
    showSection("dashboard");
});
