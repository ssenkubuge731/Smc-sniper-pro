# SMC Sniper Pro — MT5 Bridge (Phase 1)

## Purpose
This folder contains the first, read-only MT5 terminal agent for the universal MT5 bridge. It is intended to work with MT5 terminals from different MT5-compatible brokers, subject to broker/server testing.

## Phase 1 scope
- Sends a periodic HTTPS heartbeat to the configured bridge endpoint.
- Reports terminal connectivity, terminal trade-allowed flag, broker company, server name, and terminal build.
- Uses a bearer token configured locally in MT5.
- Does **not** send account login, password, investor password, balance, equity, positions, or order history.
- Contains no trade-opening or trade-closing functions.

## Important: not deployable yet
The HTTPS bridge server/API endpoint is not included or deployed by this file. Until a secure server endpoint exists, the placeholder URL will not connect. Do not enter a real token into GitHub or the website's public frontend.

## MT5 setup (when the secure endpoint is deployed)
1. Copy `SMC_Sniper_MT5_Bridge.mq5` into the MT5 terminal's `MQL5/Experts` folder.
2. Compile it in MetaEditor.
3. In MT5, open **Tools → Options → Expert Advisors** and allow WebRequest only for the exact HTTPS bridge domain supplied by the project.
4. Attach the agent to a chart.
5. Set the bridge URL and a unique strong token in the EA inputs. Keep the token local to the VPS/MT5 terminal.
6. Confirm that the bridge dashboard receives a heartbeat and shows the correct broker/server.

## Universal broker approach
The bridge communicates with the MT5 terminal, not with a broker-specific trading API. A broker is supported only after its MT5 terminal can log in and pass the read-only connection test. Server names are broker/account specific.

## Safety gates
- Demo testing only.
- Live trading remains locked.
- No order execution is implemented in Phase 1.
- Never put MT5 passwords, investor passwords, API secrets, or bearer tokens in this repository, GitHub Pages, screenshots, or chat.
- Before any demo execution is added, the server must authenticate the terminal, validate commands, enforce demo-only mode, and record acknowledgements and errors.
