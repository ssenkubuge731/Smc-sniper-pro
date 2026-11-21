// Daily source-level health checks for SMC Sniper Pro.
// These checks validate repository invariants; they do not claim live broker connectivity.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const smc = fs.readFileSync("smc-intraday.js", "utf8");
const worker = fs.readFileSync("mt5-bridge/worker.js", "utf8");
const mt5EA = fs.readFileSync("mt5-bridge/SMC_Sniper_APA_EA.mq5", "utf8");
const html = fs.readFileSync("index.html", "utf8");

const checks = [
  ["Scalping is restricted to M1 and M5", /scalping:\s*\["1m",\s*"5m"\]/.test(app)],
  ["Intraday is restricted to M1, M5, M15, M30 and H1", /intraday:\s*\["1m",\s*"5m",\s*"15m",\s*"30m",\s*"1h"\]/.test(app)],
  ["APA uses D1/H4/H1 context with M15 setup and M5 entry frames", /APA_REQUIRED_FRAMES\s*=\s*\["1d",\s*"4h",\s*"1h",\s*"15m",\s*"5m"\]/.test(app)],
  ["Application starts in demo mode with live trading locked", /demo:\s*true,\s*liveLocked:\s*true/.test(app)],
  ["Runtime health monitor reports broker, data, scanner and safety state", /function updateRuntimeHealth\(\)/.test(app) && /runtimeBrokerHealth/.test(app) && /runtimeDataHealth/.test(app) && /runtimeScannerHealth/.test(app)],
  ["Scanner stall detection uses completed cycles, not scan-start timestamps", /SCANNER STALLED/.test(app) && /no completed scan cycle/.test(app) && /scanAge > 180/.test(app) && /if \(!job\)\s*\{[\s\S]*?commitCompletedScanBatch\(tradingState\)[\s\S]*?tradingState\.lastScanAt = Date\.now\(\)/.test(app)],
  ["Market-data freshness updates only after valid candle data", /lastAnalysisAt=tradingState.lastMarketDataAt/.test(app) && !/lastMarketDataAt=tradingState\.mt5LastScanAt/.test(app)],
  ["Dashboard contains the runtime health monitor", /id="runtimeHealthPanel"/.test(fs.readFileSync("index.html", "utf8"))],
  ["SMC engine exposes its public analysis interface", /SMCIntradayEngine/.test(smc)],
  ["MT5 Worker source contains heartbeat handling", /heartbeat/i.test(worker)],
  ["Legacy MT5 EA is demo-only and permanently signal-only", /IsDemoAccount\(\)/.test(mt5EA) && /ORDER EXECUTION DISABLED/.test(mt5EA) && !/InpEnableTrading/.test(mt5EA)],
  ["Legacy MT5 EA has no order execution or position-close API calls", !/\btrade\.(Buy|Sell|PositionClose|PositionModify|PositionOpen)\s*\(/.test(mt5EA) && !/#include\s*<Trade\/Trade\.mqh>/.test(mt5EA)],
  ["MT5 scanner health has a matching DOM display target", /id="mt5FeedHealthStatus"/.test(html) && /setText\("mt5FeedHealthStatus"/.test(app)],
  ["News calendar currency filter follows full intraday scanner universe", app.includes("tradingState.availableSymbols.map(item => item.symbol)") && app.includes("[...tradingState.selectedSymbols]")]
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed++;
}
console.log(`Daily source health: ${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exitCode = 1;
