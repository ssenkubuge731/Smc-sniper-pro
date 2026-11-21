#property strict
#property version   "0.20"
#property description "SMC Sniper Pro APA - DEMO ONLY safety-first prototype"


enum APA_STYLE { APA_SCALPING=0, APA_INTRADAY=1 };
input APA_STYLE InpStyle = APA_SCALPING;

// This legacy EA is permanently signal-only: no trade inputs or order execution.
input int InpLookback = 12;
input int InpFastEMA = 9;
input int InpSlowEMA = 21;

int hFast=INVALID_HANDLE, hSlow=INVALID_HANDLE;
datetime lastBar=0;

ENUM_TIMEFRAMES SignalTF()
{
   if(InpStyle==APA_SCALPING) return PERIOD_M5;
   if(InpStyle==APA_INTRADAY) return PERIOD_M30;
   return PERIOD_M30;
}

bool IsDemoAccount()
{
   return ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO);
}

bool NewBar()
{
   datetime barTime=iTime(_Symbol,SignalTF(),0);
   if(barTime==0 || barTime==lastBar) return false;
   lastBar=barTime;
   return true;
}

// Closed-candle sequence: candle 2 sweeps prior liquidity; candle 1 confirms displacement/BOS.
bool APASetup(bool &buy,bool &sell)
{
   buy=false;
   sell=false;

   if(InpLookback<5 || InpLookback>100) return false;

   MqlRates rates[];
   ArraySetAsSeries(rates,true);
   int needed=InpLookback+8;
   if(CopyRates(_Symbol,SignalTF(),0,needed,rates)<needed) return false;

   double fast[],slow[];
   ArraySetAsSeries(fast,true);
   ArraySetAsSeries(slow,true);
   if(CopyBuffer(hFast,0,0,3,fast)<3 || CopyBuffer(hSlow,0,0,3,slow)<3) return false;

   double priorHigh=rates[3].high;
   double priorLow=rates[3].low;
   for(int k=4;k<InpLookback+3;k++)
   {
      priorHigh=MathMax(priorHigh,rates[k].high);
      priorLow=MathMin(priorLow,rates[k].low);
   }

   double body=MathAbs(rates[1].close-rates[1].open);
   double averageRange=0.0;
   for(int k=3;k<8;k++) averageRange+=(rates[k].high-rates[k].low);
   averageRange/=5.0;

   bool bullishTrend=(fast[1]>slow[1]);
   bool bearishTrend=(fast[1]<slow[1]);
   bool bullishSweep=(rates[2].low<priorLow && rates[2].close>priorLow);
   bool bearishSweep=(rates[2].high>priorHigh && rates[2].close<priorHigh);
   bool bullishBOS=(rates[1].close>priorHigh);
   bool bearishBOS=(rates[1].close<priorLow);
   bool bullishDisplacement=(rates[1].close>rates[1].open && averageRange>0.0 && body>=averageRange*0.60);
   bool bearishDisplacement=(rates[1].close<rates[1].open && averageRange>0.0 && body>=averageRange*0.60);
   bool bullishFVG=(rates[1].low>rates[3].high);
   bool bearishFVG=(rates[1].high<rates[3].low);
   bool bullishOB=(rates[2].close<rates[2].open);
   bool bearishOB=(rates[2].close>rates[2].open);

   buy=bullishTrend && bullishSweep && bullishBOS && bullishDisplacement && bullishFVG && bullishOB;
   sell=bearishTrend && bearishSweep && bearishBOS && bearishDisplacement && bearishFVG && bearishOB;
   return true;
}

int OnInit()
{
   // Hard block on every non-demo account. No input can override this check.
   if(!IsDemoAccount())
   {
      Print("APA EA BLOCKED: this build only runs on an MT5 DEMO account.");
      return INIT_FAILED;
   }

   if(InpLookback<5 || InpLookback>100 || InpFastEMA<1 || InpSlowEMA<2 || InpFastEMA>=InpSlowEMA)
   {
      Print("APA EA BLOCKED: invalid signal inputs.");
      return INIT_PARAMETERS_INCORRECT;
   }

   hFast=iMA(_Symbol,SignalTF(),InpFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(_Symbol,SignalTF(),InpSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   if(hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE)
   {
      Print("APA EA ERROR: could not create EMA indicators.");
      return INIT_FAILED;
   }

   Print("SMC Sniper Pro APA signal-only EA initialized on DEMO. ORDER EXECUTION DISABLED.");
   Print("Selected style: ",EnumToString(InpStyle),
         " | Signal timeframe: ",EnumToString(SignalTF()));
   return INIT_SUCCEEDED;
}

void OnTick()
{
   if(!NewBar()) return;

   bool buy=false,sell=false;
   if(!APASetup(buy,sell)) return;

   if(buy) Print("APA BUY SETUP detected on ",_Symbol," / ",EnumToString(SignalTF()));
   if(sell) Print("APA SELL SETUP detected on ",_Symbol," / ",EnumToString(SignalTF()));
   if(!buy && !sell) Print("APA WAIT — no confirmed setup on ",_Symbol," / ",EnumToString(SignalTF()));
}

void OnDeinit(const int reason)
{
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
}
