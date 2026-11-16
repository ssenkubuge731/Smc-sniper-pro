/* SMC INTRADAY ENGINE — independent from APA; signal-only, no order execution */
(function () {
  "use strict";
  const FRAMES = ["1m", "5m", "15m", "30m", "1h", "4h"];
  const state = { latest: new Map(), lastPublished: new Map() };

  function detect(candles) {
    if (!Array.isArray(candles) || candles.length < 30) return { ready:false, status:"Need 30+ candles" };
    const c = candles[candles.length - 1], prev = candles.slice(-21, -1);
    const hi = Math.max(...prev.map(x => x.high)), lo = Math.min(...prev.map(x => x.low));
    const range = Math.max(c.high - c.low, 1e-12), body = Math.abs(c.close - c.open);
    const bullSweep = c.low < lo && c.close > lo;
    const bearSweep = c.high > hi && c.close < hi;
    const bullDisp = c.close > c.open && body / range >= .65;
    const bearDisp = c.close < c.open && body / range >= .65;
    const bullBreak = c.close > hi, bearBreak = c.close < lo;
    const a = candles[candles.length - 3], b = candles[candles.length - 2];
    const bullFvg = b.low > a.high, bearFvg = b.high < a.low;
    const bullish = [bullSweep, bullBreak, bullDisp, bullFvg].filter(Boolean).length;
    const bearish = [bearSweep, bearBreak, bearDisp, bearFvg].filter(Boolean).length;
    const side = bullish > bearish ? "BUY" : bearish > bullish ? "SELL" : "NONE";
    const confirmations = side === "BUY"
      ? { sweep:bullSweep, structure:bullBreak, displacement:bullDisp, fvg:bullFvg }
      : side === "SELL"
        ? { sweep:bearSweep, structure:bearBreak, displacement:bearDisp, fvg:bearFvg }
        : {};
    const count = Object.values(confirmations).filter(Boolean).length;
    // Strict gate: at least 2 confirmations, structure break and displacement.
    const confirmed = side !== "NONE" && count >= 2 && confirmations.structure && confirmations.displacement;
    return { ready:true, side, confirmations, count, confirmed, price:c.close,
      score: Math.min(100, count * 20 + (confirmations.structure ? 15 : 0) + (confirmations.displacement ? 15 : 0)) };
  }

  function evaluate(symbol, timeframe, candles) {
    if (!FRAMES.includes(timeframe)) return null;
    const result = detect(candles);
    const key = symbol + "|" + timeframe;
    const record = Object.assign({ symbol, timeframe, time:Date.now() }, result);
    state.latest.set(key, record);
    if (record.confirmed) {
      const signature = key + "|" + record.side + "|" + record.price;
      if (state.lastPublished.get(key) !== signature) {
        state.lastPublished.set(key, signature);
        window.dispatchEvent(new CustomEvent("smc:signal", { detail:record }));
      }
    }
    return record;
  }

  function best(symbol) {
    return FRAMES.map(tf => state.latest.get(symbol + "|" + tf))
      .filter(x => x && x.confirmed)
      .sort((a,b) => b.score - a.score)[0] || null;
  }

  window.SMCIntradayEngine = { frames:FRAMES.slice(), evaluate, best, state };
})();
