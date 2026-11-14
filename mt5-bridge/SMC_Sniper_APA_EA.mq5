#property strict
#property version   "0.20"
#property description "SMC Sniper Pro APA - DEMO ONLY safety-first prototype"

#include <Trade/Trade.mqh>
CTrade trade;

enum APA_STYLE { APA_SCALPING=0, APA_INTRADAY=1, APA_SWING=2 };
input APA_STYLE InpStyle = APA_SCALPING;

// Trading stays OFF until the signal logic has been compiled and demo-tested.
input bool InpEnableTrading = false;
input double InpRiskPercent = 0.5;       // set to 0 to use fixed lot
input double InpFixedLot = 0.01;
input int InpMaxOpenTrades = 2;
input double InpDailyLossLimitPercent = 2.0;
input int InpPauseAfterLosses = 3;
input double InpScalpCloseProfitMoney = 1.0; // account currency
input int InpEmergencySLPoints = 300;
input int InpIntradayTPPoints = 600;
input int InpSwingTPPoints = 1200;
input int InpLookback = 12;
input int InpFastEMA = 9;
input int InpSlowEMA = 21;
input ulong InpMagic = 26111401;

int hFast=INVALID_HANDLE, hSlow=INVALID_HANDLE;
datetime lastBar=0, dayStart=0;
double dayStartEquity=0.0;
int consecutiveLosses=0;
bool pausedToday=false;

ENUM_TIMEFRAMES SignalTF()
{
   if(InpStyle==APA_SCALPING) return PERIOD_M5;
   if(InpStyle==APA_INTRADAY) return PERIOD_M30;
   return PERIOD_H1;
}

bool IsDemoAccount()
{
   return ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE)==ACCOUNT_TRADE_MODE_DEMO);
}

int CountPositions()
{
   int count=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic) count++;
   }
   return count;
}

int VolumeDigits(double step)
{
   if(step>=1.0) return 0;
   if(step>=0.1) return 1;
   if(step>=0.01) return 2;
   if(step>=0.001) return 3;
   return 4;
}

// Returns zero rather than forcing the broker minimum when that would exceed the risk budget.
double LotForRisk(double slPoints)
{
   double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   if(minLot<=0.0 || maxLot<minLot || step<=0.0 || slPoints<=0.0) return 0.0;

   double requested=0.0;
   if(InpRiskPercent<=0.0)
      requested=InpFixedLot;
   else
   {
      if(InpRiskPercent>5.0) return 0.0; // safety cap; user can choose up to 5%
      double equity=AccountInfoDouble(ACCOUNT_EQUITY);
      double tickValue=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE_LOSS);
      double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
      if(equity<=0.0 || tickValue<=0.0 || tickSize<=0.0) return 0.0;
      double riskMoney=equity*InpRiskPercent/100.0;
      double lossPerLot=(slPoints*_Point/tickSize)*tickValue;
      if(lossPerLot<=0.0) return 0.0;
      requested=riskMoney/lossPerLot;
   }

   if(requested<minLot) return 0.0;
   requested=MathMin(requested,maxLot);
   double lots=MathFloor(requested/step+1e-8)*step;
   lots=NormalizeDouble(lots,VolumeDigits(step));
   if(lots<minLot) return 0.0;
   return lots;
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

void CheckDailyGuard()
{
   MqlDateTime parts;
   TimeToStruct(TimeCurrent(),parts);
   parts.hour=0;
   parts.min=0;
   parts.sec=0;
   datetime today=StructToTime(parts);

   if(today!=dayStart)
   {
      dayStart=today;
      dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
      consecutiveLosses=0;
      pausedToday=false;
   }

   if(dayStartEquity>0.0 && InpDailyLossLimitPercent>0.0)
   {
      double lossPercent=(dayStartEquity-AccountInfoDouble(ACCOUNT_EQUITY))/dayStartEquity*100.0;
      if(lossPercent>=InpDailyLossLimitPercent) pausedToday=true;
   }
   if(InpPauseAfterLosses>0 && consecutiveLosses>=InpPauseAfterLosses)
      pausedToday=true;
}

void ManageScalp()
{
   if(InpStyle!=APA_SCALPING || InpScalpCloseProfitMoney<=0.0) return;

   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong ticket=PositionGetTicket(i);
      if(ticket==0) continue;
      if(PositionGetString(POSITION_SYMBOL)!=_Symbol ||
         (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;

      if(PositionGetDouble(POSITION_PROFIT)>=InpScalpCloseProfitMoney)
      {
         if(!trade.PositionClose(ticket))
            Print("APA scalp close failed. Retcode: ",trade.ResultRetcode());
      }
   }
}

int OnInit()
{
   // Hard block on every non-demo account. No input can override this check.
   if(!IsDemoAccount())
   {
      Print("APA EA BLOCKED: this build only runs on an MT5 DEMO account.");
      return INIT_FAILED;
   }

   if(InpMaxOpenTrades<1 || InpEmergencySLPoints<1 ||
      InpFastEMA<1 || InpSlowEMA<2 || InpFastEMA>=InpSlowEMA ||
      InpDailyLossLimitPercent<0.0 || InpPauseAfterLosses<0)
   {
      Print("APA EA BLOCKED: one or more input settings are invalid.");
      return INIT_PARAMETERS_INCORRECT;
   }

   hFast=iMA(_Symbol,SignalTF(),InpFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(_Symbol,SignalTF(),InpSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   if(hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE)
   {
      Print("APA EA ERROR: could not create EMA indicators.");
      return INIT_FAILED;
   }

   trade.SetExpertMagicNumber(InpMagic);
   dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY);
   Print("SMC Sniper Pro APA v0.20 initialized on DEMO. Trading enabled: ",
         (InpEnableTrading ? "YES" : "NO - SIGNAL TEST ONLY"));
   Print("Selected style: ",EnumToString(InpStyle),
         " | Signal timeframe: ",EnumToString(SignalTF()));
   return INIT_SUCCEEDED;
}

void OnTick()
{
   ManageScalp();
   CheckDailyGuard();

   if(!NewBar()) return;

   bool buy=false,sell=false;
   if(!APASetup(buy,sell)) return;

   if(buy) Print("APA BUY SETUP detected on ",_Symbol," / ",EnumToString(SignalTF()));
   if(sell) Print("APA SELL SETUP detected on ",_Symbol," / ",EnumToString(SignalTF()));

   // Signal-only by default. Orders require explicit input change after demo validation.
   if(!InpEnableTrading || pausedToday || (!buy && !sell)) return;
   if(buy && sell) return;
   if(CountPositions()>=InpMaxOpenTrades) return;
   if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) ||
      !MQLInfoInteger(MQL_TRADE_ALLOWED) ||
      !AccountInfoInteger(ACCOUNT_TRADE_ALLOWED)) return;

   double stopPoints=(double)InpEmergencySLPoints;
   long brokerStopLevel=SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL);
   if(stopPoints<brokerStopLevel+2) stopPoints=brokerStopLevel+2;

   double lots=LotForRisk(stopPoints);
   if(lots<=0.0)
   {
      Print("APA order skipped: calculated volume is below broker minimum or risk data is unavailable.");
      return;
   }

   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   if(ask<=0.0 || bid<=0.0) return;

   double sl=0.0,tp=0.0;
   bool sent=false;
   if(buy)
   {
      sl=NormalizeDouble(ask-stopPoints*_Point,_Digits);
      if(InpStyle!=APA_SCALPING)
      {
         int tpPoints=(InpStyle==APA_INTRADAY ? InpIntradayTPPoints : InpSwingTPPoints);
         if(tpPoints<=0) return;
         tp=NormalizeDouble(ask+tpPoints*_Point,_Digits);
      }
      sent=trade.Buy(lots,_Symbol,0.0,sl,tp,"APA BUY");
   }
   else if(sell)
   {
      sl=NormalizeDouble(bid+stopPoints*_Point,_Digits);
      if(InpStyle!=APA_SCALPING)
      {
         int tpPoints=(InpStyle==APA_INTRADAY ? InpIntradayTPPoints : InpSwingTPPoints);
         if(tpPoints<=0) return;
         tp=NormalizeDouble(bid-tpPoints*_Point,_Digits);
      }
      sent=trade.Sell(lots,_Symbol,0.0,sl,tp,"APA SELL");
   }

   if(!sent)
      Print("APA order failed. Retcode: ",trade.ResultRetcode()," / ",trade.ResultRetcodeDescription());
}

void OnTradeTransaction(const MqlTradeTransaction& trans,
                        const MqlTradeRequest& request,
                        const MqlTradeResult& result)
{
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if((ulong)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_ENTRY)!=DEAL_ENTRY_OUT) return;

   double netProfit=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)
                   +HistoryDealGetDouble(trans.deal,DEAL_SWAP)
                   +HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
   if(netProfit<0.0) consecutiveLosses++;
   else if(netProfit>0.0) consecutiveLosses=0;
}

void OnDeinit(const int reason)
{
   if(hFast!=INVALID_HANDLE) IndicatorRelease(hFast);
   if(hSlow!=INVALID_HANDLE) IndicatorRelease(hSlow);
}
