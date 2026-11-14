#property strict
#property version   "0.10"
#property description "SMC Sniper Pro APA - DEMO ONLY prototype EA"

#include <Trade/Trade.mqh>
CTrade trade;

// SAFETY: This prototype refuses real-money accounts. Live trading is intentionally locked.
enum APA_STYLE { APA_SCALPING=0, APA_INTRADAY=1, APA_SWING=2 };
input APA_STYLE InpStyle = APA_SCALPING;
input bool InpDemoOnly = true;
input bool InpLiveTradingLocked = true;
input double InpRiskPercent = 0.5;       // manual risk setting
input double InpFixedLot = 0.01;         // used if risk percent is 0
input int InpMaxOpenTrades = 2;
input double InpDailyLossLimitPercent = 2.0;
input int InpPauseAfterLosses = 3;
input int InpScalpCloseProfitMoney = 1;  // account currency; scalp closes once this profit is reached
input int InpEmergencySLPoints = 300;
input int InpIntradayTPPoints = 600;
input int InpSwingTPPoints = 1200;
input int InpLookback = 12;
input int InpFastEMA = 9;
input int InpSlowEMA = 21;
input ulong InpMagic = 26111401;

int hFast=INVALID_HANDLE, hSlow=INVALID_HANDLE;
datetime lastBar=0, dayStart=0;
double dayStartEquity=0;
int consecutiveLosses=0;
bool pausedToday=false;

ENUM_TIMEFRAMES SignalTF()
{
   if(InpStyle==APA_SCALPING) return PERIOD_M5;
   if(InpStyle==APA_INTRADAY) return PERIOD_M30;
   return PERIOD_H1;
}
bool DemoAccount()
{
   string s=AccountInfoString(ACCOUNT_SERVER);
   string c=AccountInfoString(ACCOUNT_COMPANY);
   string x=s+" "+c;
   StringToLower(x);
   return (StringFind(x,"demo")>=0 || StringFind(x,"practice")>=0);
}
int CountPositions()
{
   int n=0;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(t>0 && PositionGetString(POSITION_SYMBOL)==_Symbol &&
         (ulong)PositionGetInteger(POSITION_MAGIC)==InpMagic) n++;
   }
   return n;
}
double LotForRisk(double slPoints)
{
   if(InpRiskPercent<=0) return InpFixedLot;
   double risk=AccountInfoDouble(ACCOUNT_EQUITY)*InpRiskPercent/100.0;
   double tickVal=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_VALUE);
   double tickSize=SymbolInfoDouble(_Symbol,SYMBOL_TRADE_TICK_SIZE);
   if(tickVal<=0 || tickSize<=0 || slPoints<=0) return InpFixedLot;
   double lossPerLot=(slPoints*_Point/tickSize)*tickVal;
   if(lossPerLot<=0) return InpFixedLot;
   double lot=risk/lossPerLot;
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double minLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double maxLot=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   lot=MathFloor(lot/step)*step;
   return MathMax(minLot,MathMin(maxLot,lot));
}
bool NewBar()
{
   datetime t=iTime(_Symbol,SignalTF(),0);
   if(t==0 || t==lastBar) return false;
   lastBar=t; return true;
}
bool APASetup(bool &buy,bool &sell)
{
   buy=false; sell=false;
   MqlRates r[];
   ArraySetAsSeries(r,true);
   int need=InpLookback+5;
   if(CopyRates(_Symbol,SignalTF(),0,need,r)<need) return false;
   double f[],s[];
   ArraySetAsSeries(f,true); ArraySetAsSeries(s,true);
   if(CopyBuffer(hFast,0,0,3,f)<3 || CopyBuffer(hSlow,0,0,3,s)<3) return false;

   // Trend + BOS + displacement + liquidity sweep + simple FVG proxy.
   double hi=r[2].high, lo=r[2].low;
   for(int k=3;k<InpLookback+3;k++){ hi=MathMax(hi,r[k].high); lo=MathMin(lo,r[k].low); }
   double body=MathAbs(r[1].close-r[1].open);
   double avgRange=0;
   for(int k=2;k<7;k++) avgRange+=(r[k].high-r[k].low);
   avgRange/=5.0;
   bool bullTrend=f[1]>s[1], bearTrend=f[1]<s[1];
   bool bullBOS=r[1].close>hi, bearBOS=r[1].close<lo;
   bool bullDisp=r[1].close>r[1].open && body>avgRange*0.55;
   bool bearDisp=r[1].close<r[1].open && body>avgRange*0.55;
   bool sweepLow=r[1].low<r[2].low && r[1].close>r[2].low;
   bool sweepHigh=r[1].high>r[2].high && r[1].close<r[2].high;
   bool bullFVG=r[1].low>r[3].high;
   bool bearFVG=r[1].high<r[3].low;
   // OB proxy: prior candle opposite to the displacement candle.
   bool bullOB=r[2].close<r[2].open;
   bool bearOB=r[2].close>r[2].open;
   buy=bullTrend && bullBOS && bullDisp && sweepLow && bullFVG && bullOB;
   sell=bearTrend && bearBOS && bearDisp && sweepHigh && bearFVG && bearOB;
   return true;
}
void CheckDailyGuard()
{
   MqlDateTime d; TimeToStruct(TimeCurrent(),d); d.hour=0; d.min=0; d.sec=0;
   datetime today=StructToTime(d);
   if(today!=dayStart){dayStart=today; dayStartEquity=AccountInfoDouble(ACCOUNT_EQUITY); consecutiveLosses=0; pausedToday=false;}
   if(dayStartEquity>0 && (dayStartEquity-AccountInfoDouble(ACCOUNT_EQUITY))/dayStartEquity*100.0>=InpDailyLossLimitPercent) pausedToday=true;
   if(consecutiveLosses>=InpPauseAfterLosses) pausedToday=true;
}
void ManageScalp()
{
   if(InpStyle!=APA_SCALPING) return;
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(t==0 || PositionGetString(POSITION_SYMBOL)!=_Symbol || (ulong)PositionGetInteger(POSITION_MAGIC)!=InpMagic) continue;
      if(PositionGetDouble(POSITION_PROFIT)>=InpScalpCloseProfitMoney) trade.PositionClose(t);
   }
}
int OnInit()
{
   if(InpDemoOnly && !DemoAccount()){Print("APA EA BLOCKED: demo/practice account required."); return INIT_FAILED;}
   if(InpLiveTradingLocked && !DemoAccount()){Print("LIVE TRADING LOCKED."); return INIT_FAILED;}
   hFast=iMA(_Symbol,SignalTF(),InpFastEMA,0,MODE_EMA,PRICE_CLOSE);
   hSlow=iMA(_Symbol,SignalTF(),InpSlowEMA,0,MODE_EMA,PRICE_CLOSE);
   if(hFast==INVALID_HANDLE || hSlow==INVALID_HANDLE) return INIT_FAILED;
   trade.SetExpertMagicNumber(InpMagic);
   Print("SMC Sniper Pro APA prototype started. DEMO ONLY; live locked.");
   return INIT_SUCCEEDED;
}
void OnTick()
{
   ManageScalp();
   CheckDailyGuard();
   if(pausedToday || !NewBar() || CountPositions()>=InpMaxOpenTrades) return;
   bool buy=false,sell=false;
   if(!APASetup(buy,sell) || (!buy && !sell)) return;
   double slPts=InpEmergencySLPoints;
   double lot=LotForRisk(slPts);
   double ask=SymbolInfoDouble(_Symbol,SYMBOL_ASK), bid=SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double sl=0,tp=0;
   if(buy){sl=ask-slPts*_Point; if(InpStyle!=APA_SCALPING) tp=ask+(InpStyle==APA_INTRADAY?InpIntradayTPPoints:InpSwingTPPoints)*_Point; trade.Buy(lot,_Symbol,ask,sl,tp,"APA BUY");}
   if(sell){sl=bid+slPts*_Point; if(InpStyle!=APA_SCALPING) tp=bid-(InpStyle==APA_INTRADAY?InpIntradayTPPoints:InpSwingTPPoints)*_Point; trade.Sell(lot,_Symbol,bid,sl,tp,"APA SELL");}
}
void OnTradeTransaction(const MqlTradeTransaction& trans,const MqlTradeRequest& req,const MqlTradeResult& res)
{
   if(trans.type!=TRADE_TRANSACTION_DEAL_ADD || trans.deal==0) return;
   if(!HistoryDealSelect(trans.deal)) return;
   if((ulong)HistoryDealGetInteger(trans.deal,DEAL_MAGIC)!=InpMagic) return;
   if(HistoryDealGetInteger(trans.deal,DEAL_ENTRY)==DEAL_ENTRY_OUT)
   {
      double p=HistoryDealGetDouble(trans.deal,DEAL_PROFIT)+HistoryDealGetDouble(trans.deal,DEAL_SWAP)+HistoryDealGetDouble(trans.deal,DEAL_COMMISSION);
      if(p<0) consecutiveLosses++; else if(p>0) consecutiveLosses=0;
   }
}
void OnDeinit(const int reason){if(hFast!=INVALID_HANDLE)IndicatorRelease(hFast); if(hSlow!=INVALID_HANDLE)IndicatorRelease(hSlow);}
