// Focused regression tests for the APA M15 setup -> M5 entry gate.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("app.js", "utf8");

function extract(startMarker, endMarker, exportName, sandbox = {}) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "could not locate " + exportName + " in app.js");
  vm.runInNewContext(source.slice(start, end) + ";" + exportName, sandbox);
  return sandbox[exportName];
}

const paired = extract(
  "function isAPAM5PairedTrigger(",
  "\nfunction isAPAEntryTrigger",
  "isAPAM5PairedTrigger",
  { Number, Boolean }
);
const aligned = extract(
  "function isAPATrendStackAligned(",
  "\nfunction isAPAM5PairedTrigger",
  "isAPATrendStackAligned",
  { Array, Boolean }
);

const structureUp = { bosUp: true };
const structureDown = { mssDown: true };
const setupBuy = { epoch: 1000, high: 105, low: 95 };
const setupSell = { epoch: 1000, high: 105, low: 95 };

assert.equal(aligned("BUY", ["Bullish", "Bullish", "Bullish"]), true);
assert.equal(aligned("SELL", ["Bearish", "Bearish", "Bearish"]), true);
assert.equal(aligned("BUY", ["Bullish", "Bearish", "Bullish"]), false);
assert.equal(aligned("BUY", ["Bullish", "Bullish"]), false);
assert.equal(aligned("NONE", ["Bullish", "Bullish", "Bullish"]), false);

assert.equal(paired("BUY", setupBuy,
  { epoch: 1900, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), true,
  "first M5 candle after the M15 setup closes may confirm");
assert.equal(paired("BUY", setupBuy,
  { epoch: 2800, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), true,
  "the exact 15-minute freshness boundary is inclusive");
assert.equal(paired("BUY", setupBuy,
  { epoch: 2801, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), false,
  "a trigger one second beyond the freshness window must be rejected");
assert.equal(paired("BUY", setupBuy,
  { epoch: 1899, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), false,
  "a trigger before the M15 setup candle closes must be rejected");
assert.equal(paired("BUY", setupBuy,
  { epoch: 1900, open: 105, high: 107, low: 104, close: 106 }, structureUp, false), false,
  "displacement is mandatory");
assert.equal(paired("BUY", setupBuy,
  { epoch: 1900, open: 105, high: 107, low: 104, close: 106 }, { bosUp: false }, true), false,
  "directional structure break is mandatory");
assert.equal(paired("BUY", setupBuy,
  { epoch: 1900, open: 106, high: 107, low: 104, close: 105 }, structureUp, true), false,
  "the M5 candle must agree with BUY direction");
assert.equal(paired("SELL", setupSell,
  { epoch: 1900, open: 95, high: 96, low: 93, close: 94 }, structureDown, true), true);
assert.equal(paired("SELL", setupSell,
  { epoch: 1900, open: 94, high: 96, low: 93, close: 95 }, structureDown, true), false,
  "the M5 candle must agree with SELL direction");
assert.equal(paired("BUY", { epoch: NaN, high: 105 },
  { epoch: 1900, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), false,
  "invalid setup timestamps must fail closed");
assert.equal(paired("BUY", setupBuy,
  { epoch: Infinity, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), false,
  "invalid entry timestamps must fail closed");
assert.equal(paired("HOLD", setupBuy,
  { epoch: 1900, open: 105, high: 107, low: 104, close: 106 }, structureUp, true), false);


assert.equal(paired("BUY", setupBuy,
  { epoch:1900, open:105, high:107, low:104, close:106 }, structureUp, true,
  { invalidated:true }), false, "explicit invalidation cancels the setup");
assert.equal(paired("BUY", setupBuy,
  { epoch:1900, open:105, high:107, low:104, close:106 }, structureUp, true,
  { level:96, currentPrice:95 }), false, "BUY invalidation level breach rejects entry");
assert.equal(paired("SELL", setupSell,
  { epoch:1900, open:95, high:96, low:93, close:94 }, structureDown, true,
  { level:104, currentPrice:105 }), false, "SELL invalidation level breach rejects entry");
assert.equal(paired("BUY", setupBuy,
  { epoch:1900, open:105, high:104, low:106, close:106 }, structureUp, true), false,
  "malformed M5 candle high/low fails closed");
assert.equal(paired("BUY", {epoch:1000,high:94,low:105},
  { epoch:1900, open:105, high:107, low:104, close:106 }, structureUp, true), false,
  "malformed M15 setup range fails closed");
console.log("APA top-down regression: 19 assertions passed");
