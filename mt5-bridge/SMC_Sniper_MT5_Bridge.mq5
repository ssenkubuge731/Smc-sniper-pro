#property strict
#property version   "1.00"
#property description "SMC Sniper Pro MT5 read-only connectivity agent"

input string InpBridgeURL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/heartbeat";
input string InpConfigURL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/config";
input string InpMarketDataURL = "https://smc-sniper-mt5-bridge.henryssenkubuge38.workers.dev/mt5/market-data";
input int InpCandlesToSend = 80;
input string InpBridgeToken = ""; // Enter locally in MT5; never commit a real token.
input int    InpHeartbeatSeconds = 30;
input int    InpRequestTimeoutMs = 8000;

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
   if(StringLen(InpBridgeToken) < 24)
   {
      Print("SMC bridge token is missing. Enter it locally in the EA inputs.");
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
   if(count > 0) ArrayResize(data, count - 1);

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
            ". Allow the bridge HTTPS origin in MT5 Tools > Options > Expert Advisors.");
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

string GetJsonString(const string json,const string key)
{
   string quote=CharToString(34);
   string needle=quote+key+quote+":";
   int pos=StringFind(json,needle);
   if(pos<0)return "";
   pos+=StringLen(needle);
   while(pos<StringLen(json)&&StringGetCharacter(json,pos)==' ')pos++;
   if(pos>=StringLen(json)||StringGetCharacter(json,pos)!=34)return "";
   pos++;
   int end=StringFind(json,quote,pos);
   if(end<0)return "";
   return StringSubstr(json,pos,end-pos);
}
bool FetchConfigurationRaw(string &response)
{
   if(StringLen(InpBridgeToken)<24)return false;
   char data[],result[];
   string resultHeaders,headers="Authorization: Bearer "+InpBridgeToken+"\r\n";
   ResetLastError();
   int status=WebRequest("GET",InpConfigURL,headers,InpRequestTimeoutMs,data,result,resultHeaders);
   if(status==-1){Print("SMC bridge config fetch failed. WebRequest error ",GetLastError());return false;}
   response=CharArrayToString(result,0,-1,CP_UTF8);
   if(status<200||status>=300){Print("SMC bridge config returned HTTP ",status);return false;}
   return true;
}
bool FetchConfiguration()
{
   string response;
   if(!FetchConfigurationRaw(response))return false;
   string mode=GetJsonString(response,"mode"),strategy=GetJsonString(response,"strategy"),updated=GetJsonString(response,"updatedAt");
   if(mode==""){Print("SMC bridge config: no saved configuration yet.");return true;}
   Print("SMC bridge config received (read-only): mode=",mode,", strategy=",strategy,", updatedAt=",updated,", demoOnly=true, liveLocked=true.");
   return true;
}
string GetJsonArray(const string json,const string key)
{
   string needle=CharToString(34)+key+CharToString(34)+":";
   int pos=StringFind(json,needle);if(pos<0)return "";
   pos=StringFind(json,"[",pos);if(pos<0)return "";
   int end=StringFind(json,"]",pos);if(end<0)return "";
   return StringSubstr(json,pos,end-pos+1);
}
void ParseStringArray(const string raw,string &items[])
{
   ArrayResize(items,0);int pos=0;
   while(pos<StringLen(raw))
   {
      int q1=StringFind(raw,CharToString(34),pos);if(q1<0)break;
      int q2=StringFind(raw,CharToString(34),q1+1);if(q2<0)break;
      string v=StringSubstr(raw,q1+1,q2-q1-1);
      int n=ArraySize(items);ArrayResize(items,n+1);items[n]=v;pos=q2+1;
   }
}
ENUM_TIMEFRAMES FrameFromText(const string text)
{
   if(text=="1m")return PERIOD_M1;if(text=="5m")return PERIOD_M5;
   if(text=="15m")return PERIOD_M15;if(text=="30m")return PERIOD_M30;
   if(text=="1h")return PERIOD_H1;if(text=="4h")return PERIOD_H4;
   if(text=="1d")return PERIOD_D1;return PERIOD_CURRENT;
}
bool SendMarketData(const string symbol,const string timeframe,const ENUM_TIMEFRAMES tf)
{
   int count=MathMax(30,MathMin(150,InpCandlesToSend));
   MqlRates rates[];ArraySetAsSeries(rates,false);
   int copied=CopyRates(symbol,tf,0,count,rates);
   if(copied<30){Print("MT5 candle publish: insufficient history ",symbol," ",timeframe," count=",copied);return false;}
   int digits=(int)SymbolInfoInteger(symbol,SYMBOL_DIGITS);
   string payload="{"+CharToString(34)+"symbol"+CharToString(34)+":"+CharToString(34)+JsonEscape(symbol)+CharToString(34)+","+CharToString(34)+"timeframe"+CharToString(34)+":"+CharToString(34)+timeframe+CharToString(34)+","+CharToString(34)+"candles"+CharToString(34)+":[";
   for(int i=0;i<copied;i++)
   {
      if(i>0)payload+=",";
      payload+="{"+CharToString(34)+"epoch"+CharToString(34)+":"+IntegerToString((long)rates[i].time)+","+CharToString(34)+"open"+CharToString(34)+":"+DoubleToString(rates[i].open,digits)+","+CharToString(34)+"high"+CharToString(34)+":"+DoubleToString(rates[i].high,digits)+","+CharToString(34)+"low"+CharToString(34)+":"+DoubleToString(rates[i].low,digits)+","+CharToString(34)+"close"+CharToString(34)+":"+DoubleToString(rates[i].close,digits)+"}";
   }
   payload+="]}";
   char data[],result[];int n=StringToCharArray(payload,data,0,WHOLE_ARRAY,CP_UTF8);if(n>0)ArrayResize(data,n-1);
   string resultHeaders,headers="Content-Type: application/json\r\nAuthorization: Bearer "+InpBridgeToken+"\r\n";
   ResetLastError();int status=WebRequest("POST",InpMarketDataURL,headers,InpRequestTimeoutMs,data,result,resultHeaders);
   if(status==-1){Print("MT5 candle publish failed ",symbol," ",timeframe," err=",GetLastError());return false;}
   if(status<200||status>=300){Print("MT5 candle publish HTTP ",status," ",CharArrayToString(result,0,-1,CP_UTF8));return false;}
   return true;
}
void PublishConfiguredMarketData()
{
   string response;if(!FetchConfigurationRaw(response))return;
   string symbolsRaw=GetJsonArray(response,"symbols"),framesRaw=GetJsonArray(response,"timeframes");
   string symbols[],frames[];ParseStringArray(symbolsRaw,symbols);ParseStringArray(framesRaw,frames);
   if(ArraySize(symbols)==0||ArraySize(frames)==0)return;
   for(int i=0;i<ArraySize(symbols)&&i<10;i++)
   {
      if(!SymbolSelect(symbols[i],true)){Print("MT5 symbol not available: ",symbols[i]);continue;}
      for(int j=0;j<ArraySize(frames)&&j<7;j++)
      {
         ENUM_TIMEFRAMES tf=FrameFromText(frames[j]);if(tf==PERIOD_CURRENT)continue;
         SendMarketData(symbols[i],frames[j],tf);
      }
   }
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
   FetchConfiguration();
   PublishConfiguredMarketData();
   return INIT_SUCCEEDED;
}

void OnTimer()
{
   SendHeartbeat();
   FetchConfiguration();
   PublishConfiguredMarketData();
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("SMC Sniper Pro MT5 agent stopped.");
}

// SAFETY: No OrderSend, CTrade, position-open, position-close,
// or pending-order functions exist in this first-phase agent.
