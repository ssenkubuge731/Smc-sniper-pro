// Daily source-level health checks for SMC Sniper Pro.
// These checks validate repository invariants; they do not claim live broker connectivity.
const assert = require("node:assert/strict");
const fs = require("node:fs");

const app = fs.readFileSync("app.js", "utf8");
const smc = fs.readFileSync("smc-intraday.js", "utf8");
const worker = fs.readFileSync("mt5-bridge/worker.js", "utf8");

const checks = [
  ["Scalping is restricted to M1 and M5", /scalping:\s*\["1m",\s*"5m"\]/.test(app)],
  ["Intraday is restricted to M1, M5, M15, M30 and H1", /intraday:\s*\["1m",\s*"5m",\s*"15m",\s*"30m",\s*"1h"\]/.test(app)],
  ["APA retains D1/H4 context and M1 entry frames", /APA_REQUIRED_FRAMES\s*=\s*\["1d",\s*"4h",\s*"1h",\s*"30m",\s*"15m",\s*"5m",\s*"1m"\]/.test(app)],
  ["Application starts in demo mode with live trading locked", /demo:\s*true,\s*liveLocked:\s*true/.test(app)],
  ["SMC engine exposes its public analysis interface", /SMCIntradayEngine/.test(smc)],
  ["MT5 Worker source contains heartbeat handling", /heartbeat/i.test(worker)]
];

let failed = 0;
for (const [name, passed] of checks) {
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  if (!passed) failed++;
}
console.log(`Daily source health: ${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exitCode = 1;
