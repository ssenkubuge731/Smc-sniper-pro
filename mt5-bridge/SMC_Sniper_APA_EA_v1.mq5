//+------------------------------------------------------------------+
//| SMC Sniper APA EA v1.00                                          |
//| APA multi-timeframe signal scanner - DEMO validation build       |
//| This version is signal-only. It does NOT send trade orders.       |
//+------------------------------------------------------------------+
#property strict
#property version   "1.00"
#property description "APA trend -> reaction POI -> lower-timeframe confirmation scanner"

enum APA_STYLE
{
   APA_SCALPING = 0,
   APA_INTRADAY = 1,
   APA_SWING = 2
};

input APA_STYLE InpStyle = APA_SCALPING;
input ENUM_TIMEFRAMES InpScalpEntryTF = PERIOD_M1;
input ENUM_TIMEFRAMES InpIntradayEntryTF = PERIOD_M5;
input ENUM_TIMEFRAMES InpSwingEntryTF = PERIOD_M5;
input int    InpScanBars = 80;
input double InpDisplacementFactor = 1.20;
input int    InpZoneATRBufferPoints = 150;
input bool   InpPopupAlerts = true;
input bool   InpPushNotifications = false;

// Risk controls are displayed/configured for the later demo execution stage.
// They do not cause orders in this signal-only build.
input double InpRiskPercent = 0.50;
input int    InpMaxOpenTrades = 2;
input double InpDailyLossLimitPercent = 2.0;
input int    InpPauseAfterConsecutiveLosses = 3;

datetime g_lastEntryBar = 0;
datetime g_lastSignalBar = 0;

struct APAZone
{
   double low;
   double high;
   ENUM_TIMEFRAMES timeframe;
   string kind;
   bool valid;
};

bool LoadRates(ENUM_TIMEFRAMES tf, int count, MqlRates &rates[])
{
   ArraySetAsSeries(rates, true);
   int copied = CopyRates(_Symbol, tf, 0, count, rates);
   return (copied >= count / 2 && copied >= 20);
}

double CalculateEMA(const MqlRates &rates[], int period)
{
   int n = ArraySize(rates);
   if(n < period + 2) return 0.0;

   double alpha = 2.0 / (period + 1.0);
   double ema = rates[n - 1].close; // oldest bar; arrays are series
   for(int i = n - 2; i >= 1; --i)
      ema = alpha * rates[i].close + (1.0 - alpha) * ema;
   return ema;
}

int GetTrendBias(ENUM_TIMEFRAMES tf)
{
   MqlRates r[];
   if(!LoadRates(tf, 100, r)) return 0;

   double fast = CalculateEMA(r, 20);
   double slow = CalculateEMA(r, 50);
   double lastClose = r[1].close;

   if(fast > slow && lastClose > fast) return 1;
   if(fast < slow && lastClose < fast) return -1;
   return 0;
}

double RecentSwingHigh(const MqlRates &r[], int from, int to)
{
   double value = -DBL_MAX;
   int last = MathMin(to, ArraySize(r) - 1);
   for(int i = from; i <= last; ++i)
      if(r[i].high > value) value = r[i].high;
   return value;
}

double RecentSwingLow(const MqlRates &r[], int from, int to)
{
   double value = DBL_MAX;
   int last = MathMin(to, ArraySize(r) - 1);
   for(int i = from; i <= last; ++i)
      if(r[i].low < value) value = r[i].low;
   return value;
}

bool FindReactionZone(ENUM_TIMEFRAMES tf, int bias, APAZone &zone)
{
   MqlRates r[];
   if(!LoadRates(tf, InpScanBars, r)) return false;

   zone.valid = false;
   zone.timeframe = tf;
   double atr = 0.0;
   for(int i = 1; i <= 14 && i < ArraySize(r); ++i)
      atr += (r[i].high - r[i].low);
   atr /= 14.0;
   if(atr <= 0.0) return false;

   // Search recent order blocks and fair-value gaps.
   for(int i = 3; i < MathMin(35, ArraySize(r) - 2); ++i)
   {
      if(bias > 0)
      {
         // Bullish FVG: candle low is above the high two candles older.
         if(r[i-1].low > r[i+1].high)
         {
            zone.low = r[i+1].high;
            zone.high = r[i-1].low;
            zone.kind = "Bullish FVG";
            zone.valid = true;
            break;
         }

         // Bullish order block: bearish candle before bullish displacement.
         double body = MathAbs(r[i-1].close - r[i-1].open);
         double range = r[i-1].high - r[i-1].low;
         if(r[i].close < r[i].open && r[i-1].close > r[i-1].open &&
            body >= range * 0.55 && r[i-1].close > r[i].high)
         {
            zone.low = r[i].low;
            zone.high = r[i].open;
            zone.kind = "Bullish Order Block";
            zone.valid = true;
            break;
         }
      }
      else if(bias < 0)
      {
         // Bearish FVG.
         if(r[i-1].high < r[i+1].low)
         {
            zone.low = r[i-1].high;
            zone.high = r[i+1].low;
            zone.kind = "Bearish FVG";
            zone.valid = true;
            break;
         }

         // Bearish order block: bullish candle before bearish displacement.
         double body = MathAbs(r[i-1].close - r[i-1].open);
         double range = r[i-1].high - r[i-1].low;
         if(r[i].close > r[i].open && r[i-1].close < r[i-1].open &&
            body >= range * 0.55 && r[i-1].close < r[i].low)
         {
            zone.low = r[i].open;
            zone.high = r[i].high;
            zone.kind = "Bearish Order Block";
            zone.valid = true;
            break;
         }
      }
   }

   if(!zone.valid) return false;
   if(zone.low > zone.high)
   {
      double temp = zone.low;
      zone.low = zone.high;
      zone.high = temp;
   }

   double price = (bias > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                             : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double buffer = MathMax(atr * 0.35, InpZoneATRBufferPoints * _Point);
   return (price >= zone.low - buffer && price <= zone.high + buffer);
}

bool FindAutomaticReaction(int bias, APAZone &selected)
{
   ENUM_TIMEFRAMES candidates[3];
   if(InpStyle == APA_SCALPING)
   {
      candidates[0] = PERIOD_M15;
      candidates[1] = PERIOD_M5;
      candidates[2] = PERIOD_M30;
   }
   else if(InpStyle == APA_INTRADAY)
   {
      candidates[0] = PERIOD_H1;
      candidates[1] = PERIOD_M30;
      candidates[2] = PERIOD_M15;
   }
   else
   {
      candidates[0] = PERIOD_H4;
      candidates[1] = PERIOD_H1;
      candidates[2] = PERIOD_D1;
   }

   for(int i = 0; i < 3; ++i)
      if(FindReactionZone(candidates[i], bias, selected))
         return true;

   return false;
}

bool HasRecentLiquiditySweep(const MqlRates &r[], int bias)
{
   if(ArraySize(r) < 15) return false;

   for(int i = 2; i <= 8; ++i)
   {
      double priorLow = RecentSwingLow(r, i + 1, i + 6);
      double priorHigh = RecentSwingHigh(r, i + 1, i + 6);

      if(bias > 0 && r[i].low < priorLow && r[i].close > priorLow)
         return true;
      if(bias < 0 && r[i].high > priorHigh && r[i].close < priorHigh)
         return true;
   }
   return false;
}

bool HasStructureBreakAndDisplacement(const MqlRates &r[], int bias)
{
   if(ArraySize(r) < 25) return false;

   double swingHigh = RecentSwingHigh(r, 2, 12);
   double swingLow  = RecentSwingLow(r, 2, 12);
   double body = MathAbs(r[1].close - r[1].open);
   double averageBody = 0.0;

   for(int i = 2; i <= 11; ++i)
      averageBody += MathAbs(r[i].close - r[i].open);
   averageBody /= 10.0;

   if(averageBody <= 0.0 || body < averageBody * InpDisplacementFactor)
      return false;

   if(bias > 0)
      return (r[1].close > swingHigh && r[1].close > r[1].open);
   if(bias < 0)
      return (r[1].close < swingLow && r[1].close < r[1].open);

   return false;
}

ENUM_TIMEFRAMES EntryTimeframe()
{
   if(InpStyle == APA_SCALPING) return InpScalpEntryTF;
   if(InpStyle == APA_INTRADAY) return InpIntradayEntryTF;
   return InpSwingEntryTF;
}

ENUM_TIMEFRAMES TrendTimeframe()
{
   if(InpStyle == APA_SCALPING) return PERIOD_H1;
   if(InpStyle == APA_INTRADAY) return PERIOD_H4;
   return PERIOD_D1;
}

string StyleName()
{
   if(InpStyle == APA_SCALPING) return "SCALPING";
   if(InpStyle == APA_INTRADAY) return "INTRADAY";
   return "SWING";
}

void ScanAPA()
{
   ENUM_TIMEFRAMES entryTF = EntryTimeframe();
   MqlRates entryRates[];
   if(!LoadRates(entryTF, 60, entryRates)) return;

   if(entryRates[0].time == g_lastEntryBar) return;
   g_lastEntryBar = entryRates[0].time;

   int bias = GetTrendBias(TrendTimeframe());
   if(bias == 0)
   {
      Print("APA scan: no clear higher-timeframe trend.");
      return;
   }

   APAZone zone;
   if(!FindAutomaticReaction(bias, zone))
   {
      Print("APA scan: trend found, waiting for price at a reaction POI.");
      return;
   }

   if(!HasRecentLiquiditySweep(entryRates, bias))
   {
      Print("APA scan: POI found (", zone.kind, "), waiting for liquidity sweep.");
      return;
   }

   if(!HasStructureBreakAndDisplacement(entryRates, bias))
   {
      Print("APA scan: liquidity sweep found, waiting for structure break and displacement.");
      return;
   }

   if(entryRates[1].time == g_lastSignalBar) return;
   g_lastSignalBar = entryRates[1].time;

   string direction = (bias > 0) ? "BUY" : "SELL";
   string message = "APA " + direction + " signal | " + _Symbol +
                    " | " + StyleName() +
                    " | Trend TF: " + EnumToString(TrendTimeframe()) +
                    " | Reaction: " + EnumToString(zone.timeframe) +
                    " " + zone.kind +
                    " | Entry TF: " + EnumToString(entryTF);

   Print(message);
   if(InpPopupAlerts) Alert(message);
   if(InpPushNotifications) SendNotification(message);
}

int OnInit()
{
   if(InpRiskPercent <= 0.0 || InpRiskPercent > 5.0 ||
      InpMaxOpenTrades < 1 || InpDailyLossLimitPercent <= 0.0 ||
      InpPauseAfterConsecutiveLosses < 1)
   {
      Print("APA: invalid risk-control input. Check settings.");
      return INIT_PARAMETERS_INCORRECT;
   }

   Print("SMC Sniper APA v1.00 initialized in SIGNAL-ONLY mode. No orders will be placed.");
   Print("Style: ", StyleName(), " | Trend TF: ", EnumToString(TrendTimeframe()),
         " | Entry TF: ", EnumToString(EntryTimeframe()));
   return INIT_SUCCEEDED;
}

void OnTick()
{
   ScanAPA();
}

void OnDeinit(const int reason)
{
   Print("SMC Sniper APA v1.00 stopped. Reason: ", reason);
}
//+------------------------------------------------------------------+
