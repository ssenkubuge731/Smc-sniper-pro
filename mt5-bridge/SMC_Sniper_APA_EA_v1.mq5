//+------------------------------------------------------------------+
//| SMC Sniper APA EA v1.00                                          |
//| APA multi-timeframe signal scanner - DEMO validation build       |
//| This version is signal-only. It does NOT send trade orders.       |
//+------------------------------------------------------------------+
#property strict
#property version   "1.04"
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
input double InpMinimumRewardRisk = 1.50;
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
   datetime createdAt;
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

bool IsPivotHigh(const MqlRates &r[], int index, int wing);
bool IsPivotLow(const MqlRates &r[], int index, int wing);

int GetTrendBias(ENUM_TIMEFRAMES tf)
{
   MqlRates r[];
   if(!LoadRates(tf, 120, r)) return 0;

   // Higher-timeframe direction comes from confirmed swing structure.
   int high1=-1, high2=-1, low1=-1, low2=-1;
   double h1=0.0, h2=0.0, l1=0.0, l2=0.0;

   for(int i=3; i<ArraySize(r)-3; ++i)
   {
      if(high1<0 && IsPivotHigh(r,i,2))
      {
         high1=i; h1=r[i].high;
      }
      else if(high1>=0 && high2<0 && IsPivotHigh(r,i,2))
      {
         high2=i; h2=r[i].high;
      }

      if(low1<0 && IsPivotLow(r,i,2))
      {
         low1=i; l1=r[i].low;
      }
      else if(low1>=0 && low2<0 && IsPivotLow(r,i,2))
      {
         low2=i; l2=r[i].low;
      }

      if(high2>=0 && low2>=0) break;
   }

   if(high2<0 || low2<0) return 0;

   bool bullishStructure = (h1>h2 && l1>l2);
   bool bearishStructure = (h1<h2 && l1<l2);

   // Trend follows confirmed swing structure; the latest candle may be a pullback.
   if(bullishStructure) return 1;
   if(bearishStructure) return -1;
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

bool HasRecentLiquiditySweep(const MqlRates &r[], int bias, const APAZone &zone,
                              double &sweepExtreme, int &sweepBarIndex);

bool FindReactionZone(ENUM_TIMEFRAMES tf, int bias, const MqlRates &entryRates[], APAZone &zone)
{
   MqlRates r[];
   if(!LoadRates(tf, InpScanBars, r)) return false;

   double atr = 0.0;
   for(int a = 1; a <= 14 && a < ArraySize(r); ++a)
      atr += (r[a].high - r[a].low);
   atr /= 14.0;
   if(atr <= 0.0) return false;

   double price = (bias > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                             : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double buffer = MathMax(atr * 0.35, InpZoneATRBufferPoints * _Point);

   // Search from the newest completed structures toward older ones.
   // Only select a zone if current price is actually near it.
   for(int i = 3; i < MathMin(35, ArraySize(r) - 2); ++i)
   {
      double candidateLow = 0.0;
      double candidateHigh = 0.0;
      string candidateKind = "";
      datetime candidateCreatedAt = 0;

      if(bias > 0)
      {
         if(r[i-1].low > r[i+1].high)
         {
            candidateLow = r[i+1].high;
            candidateHigh = r[i-1].low;
            candidateKind = "Bullish FVG";
            candidateCreatedAt = r[i-1].time;
         }
         else
         {
            double body = MathAbs(r[i-1].close - r[i-1].open);
            double range = r[i-1].high - r[i-1].low;
            if(r[i].close < r[i].open && r[i-1].close > r[i-1].open &&
               range > 0.0 && body >= range * 0.55 &&
               r[i-1].close > r[i].high)
            {
               candidateLow = r[i].low;
               candidateHigh = r[i].open;
               candidateKind = "Bullish Order Block";
               candidateCreatedAt = r[i-1].time;
            }
         }
      }
      else if(bias < 0)
      {
         if(r[i-1].high < r[i+1].low)
         {
            candidateLow = r[i-1].high;
            candidateHigh = r[i+1].low;
            candidateKind = "Bearish FVG";
            candidateCreatedAt = r[i-1].time;
         }
         else
         {
            double body = MathAbs(r[i-1].close - r[i-1].open);
            double range = r[i-1].high - r[i-1].low;
            if(r[i].close > r[i].open && r[i-1].close < r[i-1].open &&
               range > 0.0 && body >= range * 0.55 &&
               r[i-1].close < r[i].low)
            {
               candidateLow = r[i].open;
               candidateHigh = r[i].high;
               candidateKind = "Bearish Order Block";
               candidateCreatedAt = r[i-1].time;
            }
         }
      }

      if(candidateKind == "") continue;
      if(candidateLow > candidateHigh)
      {
         double swap = candidateLow;
         candidateLow = candidateHigh;
         candidateHigh = swap;
      }

      bool invalidated = false;
      for(int j = 1; j < i-1; ++j)
      {
         if((bias > 0 && r[j].close < candidateLow) ||
            (bias < 0 && r[j].close > candidateHigh))
         {
            invalidated = true;
            break;
         }
      }
      if(invalidated) continue;

      APAZone candidate;
      candidate.low = candidateLow;
      candidate.high = candidateHigh;
      candidate.timeframe = tf;
      candidate.createdAt = candidateCreatedAt;
      candidate.kind = candidateKind;
      candidate.valid = true;

      bool nearZone = (price >= candidateLow - buffer && price <= candidateHigh + buffer);
      double priorSweepExtreme = 0.0;
      int priorSweepIndex = -1;
      bool sweptAtZone = HasRecentLiquiditySweep(entryRates, bias, candidate,
                                                  priorSweepExtreme, priorSweepIndex);
      if(!nearZone && !sweptAtZone) continue;

      zone = candidate;
      return true;
   }

   zone.valid = false;
   return false;
}

bool FindAutomaticReaction(int bias, const MqlRates &entryRates[], APAZone &selected)
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
      if(FindReactionZone(candidates[i], bias, entryRates, selected))
         return true;

   return false;
}

bool HasRecentLiquiditySweep(const MqlRates &r[], int bias, const APAZone &zone,
                              double &sweepExtreme, int &sweepBarIndex)
{
   if(ArraySize(r) < 15 || !zone.valid) return false;
   sweepBarIndex = -1;

   // Require the sweep candle to trade inside/through the selected reaction POI.
   for(int i = 2; i <= 8; ++i)
   {
      if(r[i].time < zone.createdAt) continue;
      double priorLow = RecentSwingLow(r, i + 1, i + 6);
      double priorHigh = RecentSwingHigh(r, i + 1, i + 6);

      if(bias > 0)
      {
         bool swept = (r[i].low < priorLow && r[i].close > priorLow);
         bool atPOI = (r[i].low <= zone.high && r[i].high >= zone.low);
         if(swept && atPOI)
         {
            sweepExtreme = r[i].low;
            sweepBarIndex = i;
            return true;
         }
      }
      else if(bias < 0)
      {
         bool swept = (r[i].high > priorHigh && r[i].close < priorHigh);
         bool atPOI = (r[i].high >= zone.low && r[i].low <= zone.high);
         if(swept && atPOI)
         {
            sweepExtreme = r[i].high;
            sweepBarIndex = i;
            return true;
         }
      }
   }
   return false;
}

bool IsPivotHigh(const MqlRates &r[], int index, int wing)
{
   if(index - wing < 1 || index + wing >= ArraySize(r)) return false;
   for(int k = 1; k <= wing; ++k)
      if(r[index].high <= r[index-k].high || r[index].high <= r[index+k].high)
         return false;
   return true;
}

bool IsPivotLow(const MqlRates &r[], int index, int wing)
{
   if(index - wing < 1 || index + wing >= ArraySize(r)) return false;
   for(int k = 1; k <= wing; ++k)
      if(r[index].low >= r[index-k].low || r[index].low >= r[index+k].low)
         return false;
   return true;
}

bool FindPivotBeforeSweep(const MqlRates &r[], bool wantHigh, int sweepBarIndex,
                           int &pivotIndex, double &pivotPrice)
{
   // Series arrays: a larger index is older. The broken structure level
   // must already exist before the sweep candle forms.
   // Both pivot-confirmation candles must have completed before the sweep.
   for(int i = sweepBarIndex + 3; i < ArraySize(r) - 3; ++i)
   {
      bool found = wantHigh ? IsPivotHigh(r, i, 2) : IsPivotLow(r, i, 2);
      if(found)
      {
         pivotIndex = i;
         pivotPrice = wantHigh ? r[i].high : r[i].low;
         return true;
      }
   }
   return false;
}

int GetLocalStructureBiasBeforeSweep(const MqlRates &r[], int sweepBarIndex)
{
   int high1=-1, high2=-1, low1=-1, low2=-1;
   double h1=0.0, h2=0.0, l1=0.0, l2=0.0;

   // Use only pivots fully confirmed before the sweep candle.
   for(int i=sweepBarIndex+3; i<ArraySize(r)-3; ++i)
   {
      if(high1<0 && IsPivotHigh(r,i,2)) { high1=i; h1=r[i].high; }
      else if(high1>=0 && high2<0 && IsPivotHigh(r,i,2)) { high2=i; h2=r[i].high; }

      if(low1<0 && IsPivotLow(r,i,2)) { low1=i; l1=r[i].low; }
      else if(low1>=0 && low2<0 && IsPivotLow(r,i,2)) { low2=i; l2=r[i].low; }

      if(high2>=0 && low2>=0) break;
   }

   if(high2<0 || low2<0) return 0;
   bool higherHigh = (h1 > h2);
   bool higherLow  = (l1 > l2);
   bool lowerHigh  = (h1 < h2);
   bool lowerLow   = (l1 < l2);

   if(higherHigh && higherLow) return 1;
   if(lowerHigh && lowerLow) return -1;
   return 0;
}

bool HasStructureBreakAndDisplacement(const MqlRates &r[], int bias, int sweepBarIndex,
                                      string &structureType, double &brokenLevel)
{
   if(ArraySize(r) < 25) return false;

   int pivotIndex = -1;
   double pivotPrice = 0.0;
   bool bullish = (bias > 0);
   if(!FindPivotBeforeSweep(r, bullish, sweepBarIndex, pivotIndex, pivotPrice)) return false;
   if(pivotIndex - sweepBarIndex > 24) return false;

   double body = MathAbs(r[1].close - r[1].open);
   double averageBody = 0.0;
   for(int i = 2; i <= 11; ++i)
      averageBody += MathAbs(r[i].close - r[i].open);
   averageBody /= 10.0;

   if(averageBody <= 0.0 || body < averageBody * InpDisplacementFactor)
      return false;

   double candleRange = r[1].high - r[1].low;
   if(candleRange <= 0.0 || body / candleRange < 0.60)
      return false;

   // A close beyond a confirmed swing is required; a wick alone is insufficient.
   if(bullish)
   {
      if(r[1].close <= pivotPrice || r[1].close <= r[1].open) return false;
      if((r[1].high - r[1].close) / candleRange > 0.25) return false;
      int priorBias = GetLocalStructureBiasBeforeSweep(r, sweepBarIndex);
      structureType = (priorBias < 0) ? "Bullish MSS/CHoCH" : "Bullish BOS";
      brokenLevel = pivotPrice;
      return true;
   }

   if(r[1].close >= pivotPrice || r[1].close >= r[1].open) return false;
   if((r[1].close - r[1].low) / candleRange > 0.25) return false;
   int priorBias = GetLocalStructureBiasBeforeSweep(r, sweepBarIndex);
   structureType = (priorBias > 0) ? "Bearish MSS/CHoCH" : "Bearish BOS";
   brokenLevel = pivotPrice;
   return true;
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
   if(!FindAutomaticReaction(bias, entryRates, zone))
   {
      Print("APA scan: trend found, waiting for price at a reaction POI.");
      return;
   }

   double sweepExtreme = 0.0;
   int sweepBarIndex = -1;
   if(!HasRecentLiquiditySweep(entryRates, bias, zone, sweepExtreme, sweepBarIndex))
   {
      Print("APA scan: POI found (", zone.kind, "), waiting for a liquidity sweep at that POI.");
      return;
   }

   string structureType = "";
   double brokenLevel = 0.0;
   if(!HasStructureBreakAndDisplacement(entryRates, bias, sweepBarIndex, structureType, brokenLevel))
   {
      Print("APA scan: sweep found; waiting for a later close beyond pre-sweep structure with displacement.");
      return;
   }

   if(entryRates[1].time == g_lastSignalBar) return;
   g_lastSignalBar = entryRates[1].time;

   string direction = (bias > 0) ? "BUY" : "SELL";
   double entryPrice = (bias > 0) ? SymbolInfoDouble(_Symbol, SYMBOL_ASK)
                                  : SymbolInfoDouble(_Symbol, SYMBOL_BID);
   double atrEntry = 0.0;
   for(int a=1; a<=14; ++a) atrEntry += entryRates[a].high-entryRates[a].low;
   atrEntry /= 14.0;
   double slBuffer = MathMax(atrEntry * 0.15, 3.0 * _Point);
   double stopLoss = (bias > 0) ? MathMin(sweepExtreme, zone.low)-slBuffer
                                : MathMax(sweepExtreme, zone.high)+slBuffer;
   double target = (bias > 0) ? RecentSwingHigh(entryRates, 2, 30)
                              : RecentSwingLow(entryRates, 2, 30);
   double riskDistance = MathAbs(entryPrice-stopLoss);
   double rewardDistance = (bias > 0) ? target-entryPrice : entryPrice-target;
   if(riskDistance <= 0.0 || rewardDistance <= 0.0 ||
      rewardDistance/riskDistance < InpMinimumRewardRisk)
   {
      Print("APA scan: setup rejected; opposing liquidity target does not offer the minimum reward/risk.");
      return;
   }

   string message = "APA " + direction + " signal | " + _Symbol +
                    " | " + StyleName() +
                    " | Trend TF: " + EnumToString(TrendTimeframe()) +
                    " | Reaction: " + EnumToString(zone.timeframe) +
                    " " + zone.kind +
                    " | Entry TF: " + EnumToString(entryTF) +
                    " | Structure: " + structureType +
                    " | Break level: " + DoubleToString(brokenLevel, _Digits) +
                    " | Invalidation SL: " + DoubleToString(stopLoss, _Digits) +
                    " | Liquidity TP: " + DoubleToString(target, _Digits) +
                    " | R:R: " + DoubleToString(rewardDistance/riskDistance, 2);

   Print(message);
   if(InpPopupAlerts) Alert(message);
   if(InpPushNotifications) SendNotification(message);
}

int OnInit()
{
   if(InpRiskPercent <= 0.0 || InpRiskPercent > 5.0 ||
      InpMaxOpenTrades < 1 || InpDailyLossLimitPercent <= 0.0 ||
      InpPauseAfterConsecutiveLosses < 1 || InpMinimumRewardRisk < 0.5 ||
      InpDisplacementFactor <= 0.0 || InpScanBars < 40 ||
      InpZoneATRBufferPoints < 0)
   {
      Print("APA: invalid risk-control input. Check settings.");
      return INIT_PARAMETERS_INCORRECT;
   }

   Print("SMC Sniper APA v1.04 initialized in SIGNAL-ONLY mode. No orders will be placed.");
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
   Print("SMC Sniper APA v1.04 stopped. Reason: ", reason);
}
//+------------------------------------------------------------------+
