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
The separate Cloudflare Worker has been deployed as `smc-sniper-mt5-bridge`. Its `/mt5/status` route was tested in a browser and returned `401 Unauthorized` without credentials, which is the expected protected response. This confirms the route is responding; it does not yet prove an MT5 terminal heartbeat has been received.

The existing Deriv OAuth Worker remains separate and must not be replaced.

## Cloudflare configuration
- Worker endpoint: `https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev`
- Heartbeat URL: `https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/heartbeat`
- Protected status route: `/mt5/status`
- Secret binding: `MT5_BRIDGE_TOKEN`
- KV namespace binding variable: `MT5_HEARTBEATS` (namespace created as `SMC_MT5_HEARTBEATS`)

The Worker accepts only authenticated POST heartbeats and authenticated GET status requests. It rejects oversized or malformed payloads. It stores no trading credentials and has no trading commands.

## MT5 setup (requires a Windows VPS or Windows computer)
1. Copy `SMC_Sniper_MT5_Bridge.mq5` into the MT5 terminal's `MQL5/Experts` folder.
2. Compile it in MetaEditor. This source has not yet been compiled against a live terminal.
3. In MT5, open **Tools → Options → Expert Advisors** and allow WebRequest for this exact origin: `https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev` (without the path).
4. Attach the agent to a chart.
5. Set the full heartbeat URL and the same private token in the EA inputs. Keep the token local to the VPS/MT5 terminal; never send it in chat or commit it to GitHub.
6. Confirm that the Worker accepts the heartbeat. The authenticated status route should then show the expected broker/server.

## Universal broker approach
The bridge communicates with the MT5 terminal, not with a broker-specific trading API. A broker is supported only after its MT5 terminal can log in and pass the read-only connection test. Server names are broker/account specific. Deriv MT5 Demo is the first planned test.

## Safety gates
- Demo testing only; live trading remains locked.
- This phase is connectivity monitoring only, not a trading bot execution bridge.
- Never put MT5 passwords, investor passwords, API secrets, or bearer tokens in this repository, GitHub Pages, screenshots, or chat.
- Before any demo execution is added, a separate reviewed design must authenticate terminals, validate commands, enforce demo-only mode, and record acknowledgements and errors.
