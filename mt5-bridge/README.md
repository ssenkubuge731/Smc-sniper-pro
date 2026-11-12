# SMC Sniper Pro — MT5 Bridge (Phase 1)

## Purpose
This folder contains the first, read-only MT5 terminal agent for the universal MT5 bridge. It is designed for MT5-compatible brokers, subject to testing each broker's terminal and server.

## Phase 1 scope
- MT5 Expert Advisor sends a periodic HTTPS heartbeat.
- Worker authenticates the bearer token and stores the latest connection status in Cloudflare KV.
- Reports terminal connectivity, terminal trade-allowed flag, broker company, server name, and terminal build.
- Does **not** send account login, password, investor password, balance, equity, positions, or order history.
- No trade-opening, trade-closing, or order-command endpoint exists.

## Deployment status
The Worker source is in `worker.js`, but it has **not** been deployed or connected yet. Deploy it as a **new, separate Cloudflare Worker**. Do not replace the existing Deriv OAuth Worker.

## Cloudflare setup
1. In Cloudflare Dashboard, open **Workers & Pages** and create a new Worker, for example `smc-sniper-mt5-bridge`.
2. Open the new Worker editor and replace its starter code with the complete contents of `worker.js`, then deploy.
3. In the Worker settings, add a secret named `MT5_BRIDGE_TOKEN`. Generate a long random token (at least 32 characters). Do not put the token in GitHub, the website, or chat.
4. Create a KV namespace, for example `SMC_MT5_HEARTBEATS`.
5. Bind that namespace to this Worker with the variable name `MT5_HEARTBEATS`.
6. Deploy again after adding the secret and KV binding.
7. The endpoint will be:
   `https://YOUR-NEW-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev/mt5/heartbeat`
   The protected status endpoint is `/mt5/status` and requires the same bearer token. It returns only the latest heartbeat.

The Worker accepts only authenticated POST heartbeats and authenticated GET status requests. It rejects oversized or malformed payloads. It stores no trading credentials and has no trading commands.

## MT5 setup (after Worker deployment)
1. Copy `SMC_Sniper_MT5_Bridge.mq5` into the MT5 terminal's `MQL5/Experts` folder.
2. Compile it in MetaEditor. This source has not yet been compiled against a live terminal.
3. In MT5, open **Tools → Options → Expert Advisors** and allow WebRequest for the exact Worker origin, e.g. `https://YOUR-NEW-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev` (without the path).
4. Attach the agent to a chart.
5. Set the full heartbeat URL and the same strong token in the EA inputs. Keep the token local to the VPS/MT5 terminal.
6. Confirm that the Worker accepts the heartbeat and the authenticated status endpoint shows the expected broker/server.

## Universal broker approach
The bridge communicates with the MT5 terminal, not with a broker-specific trading API. A broker is supported only after its MT5 terminal can log in and pass the read-only connection test. Server names are broker/account specific.

## Safety gates
- Demo testing only; live trading remains locked.
- This phase is connectivity monitoring only, not a trading bot execution bridge.
- Never put MT5 passwords, investor passwords, API secrets, or bearer tokens in this repository, GitHub Pages, screenshots, or chat.
- Before any demo execution is added, a separate reviewed design must authenticate terminals, validate commands, enforce demo-only mode, and record acknowledgements and errors.
