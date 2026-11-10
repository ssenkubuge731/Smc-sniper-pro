

'use strict';

/* SMC SNIPER PRO APA
   DEMO MARKET MONITORING ONLY
   NO ORDER EXECUTION
   LIVE TRADING LOCKED
*/

(() => {
  const WS_URL =
    'wss://api.derivws.com/trading/v1/options/ws/public';

  const FRAMES = {
    scalping: ['1m', '5m', '15m'],
    intraday: ['30m', '1h', '4h'],
    swing: ['1h', '4h', '1d']
  };

  const SECONDS = {
    '1m': 60, '5m': 300, '15m': 900,
    '30m': 1800, '1h': 3600, '4h': 14400,
    '1d': 86400
  };

  const $ = id => document.getElementById(id);
  const text = (id, value) => {
    if ($(id)) $(id).textContent = String(value);
  };
  const val = id => $(id)?.value || '';

  const state = {
    socket: null,
    connected: false,
    markets: [],
    selected: new Set(),
    mode: 'scalping',
    strategy: 'apa',
    running: false,
    queue: [],
    timer: null,
    reqId: 1,
    requests: new Map(),
    candles: new Map()
  };

  const key = (symbol, frame) => symbol + '|' + frame;
  const safe = s => String(s).replace(/[^a-zA-Z0-9_-]/g, '_');

  function status(message) {
    text('derivConnectionStatus', message);
    text('brokerStatus', state.connected
      ? 'Broker: Deriv market data connected'
      : 'Broker: Not connected');
    text('systemStatus', state.connected ? 'Connected' : 'Not connected');
  }

  function log(message, target = 'scannerResults') {
    const box = $(target);
    if (!box) return;

    if (box.textContent.trim() === 'Scanner has not started.') {
      box.textContent = '';
    }

    const item = document.createElement('div');
    item.className = 'result-item';
    item.textContent = message;
    box.prepend(item);

    while (box.children.length > 25) {
      box.lastChild.remove();
    }
  }

  function isOpen() {
    return state.socket &&
      state.socket.readyState === WebSocket.OPEN;
  }

  function send(payload, context) {
    if (!isOpen()) return false;

    const id = state.reqId++;

    if (context) state.requests.set(id, context);

    try {
      state.socket.send(JSON.stringify({
        ...payload,
        req_id: id
      }));
      return true;
    } catch (error) {
      state.requests.delete(id);
      log('Request error: ' + error.message);
      return false;
    }
  }

  function connect() {
    if (state.socket &&
        [WebSocket.OPEN, WebSocket.CONNECTING]
          .includes(state.socket.readyState)) {
      status('Deriv connection already active.');
      return;
    }

    status('Connecting to Deriv public market data...');

    let ws;

    try {
      ws = new WebSocket(WS_URL);
    } catch (error) {
      status('Connection error: ' + error.message);
      return;
    }

    state.socket = ws;

    ws.onopen = () => {
      if (state.socket !== ws) return;

      state.connected = true;
      status('Connected. Requesting markets...');
      send({ active_symbols: 'brief' });
    };

    ws.onmessage = event => {
      if (state.socket !== ws) return;

      try {
        handle(JSON.parse(event.data));
      } catch (error) {
        log('Message error: ' + error.message);
      }
    };

    ws.onerror = () => {
      if (state.socket === ws) {
        status('WebSocket error. Check internet connection.');
      }
    };

    ws.onclose = event => {
      if (state.socket !== ws) return;

      state.socket = null;
      state.connected = false;
      stop(false);
      status('Disconnected. Code: ' + event.code);
    };
  }

  function disconnect() {
    stop(false);

    const ws = state.socket;
    state.socket = null;
    state.connected = false;

    if (ws && ws.readyState < WebSocket.CLOSING) {
      ws.close();
    }

    status('Disconnected from Deriv.');
  }

  function handle(data) {
    if (data.error) {
      status('Deriv error: ' + data.error.message);
      log('API error: ' + data.error.message);
      return;
    }

    if (data.msg_type === 'active_symbols' &&
        Array.isArray(data.active_symbols)) {
      loadMarkets(data.active_symbols);
      return;
    }

    if (data.msg_type === 'candles' &&
        Array.isArray(data.candles)) {
      const context = state.requests.get(data.req_id);
      state.requests.delete(data.req_id);

      if (!context) return;

      const candles = data.candles
        .map(normalize)
        .filter(valid)
        .slice(-150);

      state.candles.set(
        key(context.symbol, context.frame),
        candles
      );

      renderAnalysis(context.symbol, context.frame);
      mainAnalysis(context.symbol);
    }
  }

  function loadMarkets(list) {
    state.markets = list.map(item => {
      if (!item || typeof item !== 'object') return null;

      const symbol = item.symbol || item.underlying_symbol;
      if (!symbol) return null;

      return {
        symbol: String(symbol),
        name: item.display_name || String(symbol),
        market: item.market_display_name || item.market || '',
        submarket: item.submarket_display_name || ''
      };
    }).filter(Boolean);

    if (!state.markets.length) {
      status('Connected, but no readable markets returned.');
      console.log('Deriv response:', list);
      return;
    }

    renderMarkets();

    status('Connected. ' + state.markets.length + ' markets loaded.');
    log(state.markets.length + ' markets loaded.');
  }

  function category(item) {
    const s = (
      item.market + ' ' +
      item.submarket + ' ' +
      item.name
    ).toLowerCase();

    if (/forex|major pairs|minor pairs/.test(s)) return 'Forex';
    if (/gold|metal|silver|xau|xag/.test(s)) return 'Gold';
    if (/derived|synthetic|indices|index|volatility|boom|crash|step/.test(s)) {
      return 'Deriv Indices';
    }
    return 'Other';
  }

  function renderMarkets() {
    const box = $('pairList');
    if (!box) return;

    box.replaceChildren();

    if (!state.markets.length) {
      box.textContent = 'No markets loaded yet.';
      return;
    }

    ['Deriv Indices', 'Forex', 'Gold', 'Other'].forEach(group => {
      const items = state.markets.filter(x => category(x) === group);
      if (!items.length) return;

      const heading = document.createElement('div');
      heading.textContent = group + ' (' + items.length + ')';
      heading.style.gridColumn = '1 / -1';
      heading.style.color = '#20d69b';
      box.append(heading);

      items.forEach(item => {
        const label = document.createElement('label');
        label.className = 'market-option';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = item.symbol;
        checkbox.checked = state.selected.has(item.symbol);

        checkbox.onchange = () => {
          checkbox.checked
            ? state.selected.add(item.symbol)
            : state.selected.delete(item.symbol);
          counts();
        };

        const name = document.createElement('span');
        name.textContent = item.name;

        label.append(checkbox, name);
        box.append(label);
      });
    });

    counts();
  }

  function counts() {
    text('pairCount', state.selected.size);
    text('selectedPairCount', state.selected.size + ' pairs selected');
  }

  function selectAll() {
    state.markets.forEach(item => state.selected.add(item.symbol));
    renderMarkets();
  }

  function clearPairs() {
    state.selected.clear();
    renderMarkets();
  }

  function mode() {
    state.mode = FRAMES[val('tradingStyle')]
      ? val('tradingStyle')
      : 'scalping';

    const frames = FRAMES[state.mode];
    const tf = $('timeframe');

    if (tf) {
      const previous = tf.value;
      tf.replaceChildren();

      frames.forEach(frame => {
        const option = document.createElement('option');
        option.value = frame;
        option.textContent = frame.toUpperCase();
        tf.append(option);
      });

      tf.value = frames.includes(previous) ? previous : frames[0];
    }

    text('timeframeInfo',
      state.mode.toUpperCase() + ': ' + frames.join(', '));
  }

  function normalize(c) {
    return {
      epoch: Number(c.epoch),
      open: Number(c.open),
      high: Number(c.high),
      low: Number(c.low),
      close: Number(c.close)
    };
  }

  function valid(c) {
    return Object.values(c).every(Number.isFinite);
  }

  function average(a) {
    return a.length
      ? a.reduce((sum, value) => sum + value, 0) / a.length
      : 0;
  }

  function analyze(candles) {
    if (!candles || candles.length < 50) {
      return { ready: false, reason: 'Waiting for 50 candles.' };
    }

    const closes = candles.map(c => c.close);
    const last = candles.at(-1);
    const previous = candles.at(-2);

    const ema20 = average(closes.slice(-20));
    const ema50 = average(closes.slice(-50));

    const recent = candles.slice(-11, -1);
    const high = Math.max(...recent.map(c => c.high));
    const low = Math.min(...recent.map(c => c.low));

    const bullishTrend = ema20 > ema50 && last.close > ema20;
    const bearishTrend = ema20 < ema50 && last.close < ema20;

    const bullish = last.close > last.open &&
      last.close > previous.close;
    const bearish = last.close < last.open &&
      last.close < previous.close;

    const breakUp = last.close > high;
    const breakDown = last.close < low;

    const sweepLow = last.low < low && last.close > low;
    const sweepHigh = last.high > high && last.close < high;

    let signal = 'WAIT';
    let structure = 'No confirmed breakout';
    let liquidity = 'No sweep detected';

    if (sweepLow) liquidity = 'Possible sell-side sweep';
    if (sweepHigh) liquidity = 'Possible buy-side sweep';

    if (state.strategy === 'apa') {
      if (bullishTrend && bullish && breakUp) {
        signal = 'BUY CANDIDATE';
        structure = 'Bullish range breakout';
      } else if (bearishTrend && bearish && breakDown) {
        signal = 'SELL CANDIDATE';
        structure = 'Bearish range breakout';
      }
    } else {
      if (bullishTrend && bullish && (breakUp || sweepLow)) {
        signal = 'BUY CANDIDATE';
        structure = breakUp ? 'Possible bullish BOS' : 'Liquidity reclaim';
      } else if (bearishTrend && bearish && (breakDown || sweepHigh)) {
        signal = 'SELL CANDIDATE';
        structure = breakDown ? 'Possible bearish BOS' : 'Liquidity reclaim';
      }
    }

    const atr = average(
      candles.slice(-14).map(c => c.high - c.low)
    );

    const entry = last.close;
    const buy = signal.startsWith('BUY');
    const sell = signal.startsWith('SELL');

    return {
      ready: true,
      signal,
      trend: bullishTrend ? 'Bullish' :
        bearishTrend ? 'Bearish' : 'Neutral',
      structure,
      liquidity,
      entry: buy || sell ? entry : null,
      sl: buy ? entry - atr * 1.5 :
        sell ? entry + atr * 1.5 : null,
      tp: buy ? entry + atr * 2 :
        sell ? entry - atr * 2 : null
    };
  }

  function renderAnalysis(symbol, frame) {
    const resultData = analyze(state.candles.get(key(symbol, frame)));
    const box = $('timeframeResults');
    if (!box) return;

    const row = document.createElement('div');
    row.className = 'result-item';

    row.textContent = symbol + ' ' + frame.toUpperCase() + ': ' +
      (resultData.ready
        ? resultData.trend + ' | ' + resultData.signal
        : resultData.reason);

    box.prepend(row);
  }

  function format(n) {
    return Number.isFinite(n) ? n.toFixed(5) : '--';
  }

  function mainAnalysis(symbol) {
    const frame = val('timeframe') || FRAMES[state.mode][0];
    const r = analyze(state.candles.get(key(symbol, frame)));
    if (!r.ready) return;

    text('marketTrend', r.trend + ' (' + symbol + ')');
    text('apaStructure', r.structure);
    text('liquidityStatus', r.liquidity);
    text('entrySignal', r.signal);
    text('signalEntry', format(r.entry));
    text('signalSL', format(r.sl));
    text('signalTP', format(r.tp));
    text('signalInvalidation', 'Confirm on chart');

    const box = $('strategyChecklist');
    if (box) {
      box.replaceChildren();

      [r.trend, r.structure, r.liquidity].forEach(item => {
        const row = document.createElement('div');
        row.className = 'result-item';
        row.textContent = item;
        box.append(row);
      });

      const warning = document.createElement('p');
      warning.textContent =
        'Preliminary analysis only. No order placed.';
      box.append(warning);
    }
  }

  function startScanner() {
    if (!state.connected) {
      text('scannerStatus', 'Connect Deriv first.');
      return;
    }

    if (!state.selected.size) {
      log('Select at least one market.');
      return;
    }

    stop(false);
    state.running = true;
    state.queue = [];

    state.selected.forEach(symbol => {
      FRAMES[state.mode].forEach(frame => {
        state.queue.push({ symbol, frame });
      });
    });

    text('scannerStatus', 'Scanner running...');
    text('scannerResults', 'Scanner started.');
    processQueue();
  }

  function processQueue() {
    if (!state.running || !state.queue.length) return;

    if (!isOpen()) {
      stop(false);
      return;
    }

    const task = state.queue.shift();

    send({
      ticks_history: task.symbol,
      adjust_start_time: 1,
      count: 100,
      end: 'latest',
      style: 'candles',
      granularity: SECONDS[task.frame]
    }, task);

    state.timer = setTimeout(processQueue, 500);
  }

  function stop(show = true) {
    state.running = false;
    state.queue = [];

    if (state.timer) clearTimeout(state.timer);
    state.timer = null;

    text('scannerStatus', 'Scanner stopped.');

    if (show) log('Scanner stopped. No trades placed.');
  }

  function nav(page) {
    document.querySelectorAll('.page').forEach(p => {
      p.classList.toggle('active', p.id === page);
    });

    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.page === page);
    });
  }

  function init() {
    if (window.smcSniperFreshInitialized) return;
    window.smcSniperFreshInitialized = true;

    document.querySelectorAll('.nav-btn[data-page]').forEach(button => {
      button.addEventListener('click', () => nav(button.dataset.page));
    });

    $('connectDeriv')?.addEventListener('click', connect);
    $('disconnectDeriv')?.addEventListener('click', disconnect);
    $('selectAllPairs')?.addEventListener('click', selectAll);
    $('clearPairs')?.addEventListener('click', clearPairs);
    $('startScanner')?.addEventListener('click', startScanner);
    $('stopScanner')?.addEventListener('click', () => stop());

    $('tradingStyle')?.addEventListener('change', mode);
    $('timeframe')?.addEventListener('change', () => {
      state.selected.forEach(mainAnalysis);
    });

    $('strategySelect')?.addEventListener('change', e => {
      state.strategy = e.target.value;
    });

    mode();

    status('Not connected. Connect Deriv to load markets.');
    text('scannerStatus', 'Scanner stopped.');
    text('scannerResults', 'Scanner has not started.');
    text('positionsList', 'No positions. Order execution disabled.');
    text('tradeHistory', 'No completed trades.');
    text('openTrades', '0');

    console.log('SMC Sniper Pro APA fresh script loaded.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();


  


