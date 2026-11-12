#property strict
#property version   "1.00"
#property description "SMC Sniper Pro MT5 read-only connectivity agent"

input string InpBridgeURL = "https://YOUR-BRIDGE-DOMAIN/mt5/heartbeat";
input string InpBridgeToken = ""; // Set locally in MT5; never commit a real token.
input int    InpHeartbeatSeconds = 30;
input int    InpRequestTimeoutMs = 8000;

datetime g_lastHeartbeat = 0;

string JsonEscape(const string value)
{
   string out = value;
   StringReplace(out, "\\", "\\\\");
   StringReplace(out, "\"", "\\\"");
   StringReplace(out, "\r", "");
   StringReplace(out, "\n", " ");
   return out;
}

bool SendHeartbeat()
{
   if(StringFind(InpBridgeURL, "YOUR-BRIDGE-DOMAIN") >= 0 ||
      StringLen(InpBridgeToken) < 24)
   {
      Print("SMC bridge is not configured. Set the HTTPS URL and a strong local token.");
      return false;
   }

   string server = AccountInfoString(ACCOUNT_SERVER);
   string company = AccountInfoString(ACCOUNT_COMPANY);
   string payload = "{"
      "\"service\":\"SMC Sniper Pro APA\","
      "\"agentVersion\":\"1.00\","
      "\"terminalConnected\":" + (TerminalInfoInteger(TERMINAL_CONNECTED) ? "true" : "false") + ","
      "\"tradeAllowed\":" + (TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ? "true" : "false") + ","
      "\"brokerCompany\":\"" + JsonEscape(company) + "\","
      "\"server\":\"" + JsonEscape(server) + "\","
      "\"terminalBuild\":" + IntegerToString((int)TerminalInfoInteger(TERMINAL_BUILD)) +
      "}";

   char data[];
   int count = StringToCharArray(payload, data, 0, WHOLE_ARRAY, CP_UTF8);
   if(count > 0)
      ArrayResize(data, count - 1);

   char result[];
   string resultHeaders;
   string headers = "Content-Type: application/json\r\n"
                    "Authorization: Bearer " + InpBridgeToken + "\r\n";

   ResetLastError();
   int status = WebRequest("POST", InpBridgeURL, headers,
                           InpRequestTimeoutMs, data, result, resultHeaders);

   if(status == -1)
   {
      Print("SMC bridge heartbeat failed. WebRequest error: ", GetLastError(),
            ". Add the bridge HTTPS domain to MT5 Tools > Options > Expert Advisors > Allow WebRequest.");
      return false;
   }

   string response = CharArrayToString(result, 0, -1, CP_UTF8);
   if(status < 200 || status >= 300)
   {
      Print("SMC bridge rejected heartbeat. HTTP ", status, ": ", response);
      return false;
   }

   Print("SMC bridge heartbeat accepted. HTTP ", status);
   return true;
}

int OnInit()
{
   if(InpHeartbeatSeconds < 10)
   {
      Print("Heartbeat interval must be at least 10 seconds.");
      return INIT_PARAMETERS_INCORRECT;
   }

   EventSetTimer(InpHeartbeatSeconds);
   Print("SMC Sniper Pro MT5 agent started in READ-ONLY mode. No order functions are included.");
   SendHeartbeat();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   SendHeartbeat();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("SMC Sniper Pro MT5 agent stopped.");
}

// SAFETY: This first-phase agent has no OrderSend, CTrade, position-open,
// position-close, or pending-order functions. It cannot place trades.
