import tqqqRaw from './src/data/tqqq.json' with { type: 'json' };

function calcRSI(closes, period) {
  const rsi = new Array(closes.length).fill(NaN);
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i-1]; if (d>0) gainSum+=d; else lossSum-=d; }
  let avgGain = gainSum/period, avgLoss = lossSum/period;
  rsi[period] = avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  for (let i=period+1;i<closes.length;i++) {
    const d=closes[i]-closes[i-1]; const g=d>0?d:0, l=d<0?-d:0;
    avgGain=(avgGain*(period-1)+g)/period; avgLoss=(avgLoss*(period-1)+l)/period;
    rsi[i]=avgLoss===0?100:100-100/(1+avgGain/avgLoss);
  }
  return rsi;
}
function calcDisparity(closes, period) {
  const disp = new Array(closes.length).fill(NaN); let sum=0;
  for (let i=0;i<closes.length;i++){ sum+=closes[i]; if(i>=period) sum-=closes[i-period];
    if(i>=period-1){ const ma=sum/period; disp[i]=ma>0?((closes[i]-ma)/ma)*100:NaN; } }
  return disp;
}
function calcSMA(closes, period) {
  const sma = new Array(closes.length).fill(NaN); let sum=0;
  for (let i=0;i<closes.length;i++){ sum+=closes[i]; if(i>=period) sum-=closes[i-period];
    if(i>=period-1) sma[i]=sum/period; }
  return sma;
}
function calcMDD(series){ let peak=-Infinity,mdd=0; for(const v of series){ if(v>peak)peak=v; if(peak>0){const dd=(v-peak)/peak*100; if(dd<mdd)mdd=dd;} } return mdd; }

const TQQQ_DATA = tqqqRaw;
const _closes = TQQQ_DATA.map(([,c])=>c);
const _rsi = calcRSI(_closes,14);
const _disp = calcDisparity(_closes,180);

function isWednesday(d){ return new Date(d+'T00:00:00Z').getUTCDay()===3; }

function run(startDate, endDate, { smaPeriod, deriskFrac, trendCooldownDays }) {
  const _sma = calcSMA(_closes, smaPeriod);
  const startIdx = TQQQ_DATA.findIndex(([d])=>d>=startDate);
  const endIdxRaw = TQQQ_DATA.findIndex(([d])=>d>endDate);
  const sliceEnd = endIdxRaw===-1?TQQQ_DATA.length:endIdxRaw;
  let shares=0, avgCost=0, pool=0, totalIn=0, cooldown=0, started=false, deRisked=false, trendCooldown=0;
  const dailyTotal=[];
  for (let i=startIdx;i<sliceEnd;i++){
    const [date, priceUSD] = TQQQ_DATA[i];
    const price = priceUSD*1350;
    const rsi=_rsi[i], disp=_disp[i], sma=_sma[i];
    const prevClose = i>0?_closes[i-1]:NaN;
    const prevSma = i>0?_sma[i-1]:NaN;
    if (!started){ shares=100_000_000/price; avgCost=price; totalIn=100_000_000; started=true; }
    else {
      const ret = avgCost>0?(price-avgCost)/avgCost:0;
      if (cooldown>0) cooldown--;
      else if (!isNaN(rsi)&&rsi>=70&&!isNaN(disp)&&disp>40&&ret>=0.25){
        const sellShares=shares*0.70; const sellValue=sellShares*price;
        shares-=sellShares; pool+=sellValue; cooldown=10;
      }
      if (isWednesday(date)){
        const boost=pool*0.05; const buyAmt=850_000+boost;
        const newShares=buyAmt/price; avgCost=(avgCost*shares+buyAmt)/(shares+newShares);
        shares+=newShares; pool-=boost; totalIn+=850_000;
      }
      if (trendCooldown>0) trendCooldown--;
      if (trendCooldown===0 && !isNaN(sma) && !isNaN(prevSma) && !isNaN(prevClose)){
        const belowNow = priceUSD < sma;
        const aboveBefore = prevClose >= prevSma;
        const aboveNow = priceUSD >= sma;
        const belowBefore = prevClose < prevSma;
        if (!deRisked && belowNow && aboveBefore){
          const sellShares=shares*deriskFrac; const sellValue=sellShares*price;
          shares-=sellShares; pool+=sellValue; deRisked=true; trendCooldown=trendCooldownDays;
        } else if (deRisked && aboveNow && belowBefore){
          const buyAmt=pool; const newShares=buyAmt/price;
          avgCost=(avgCost*shares+buyAmt)/(shares+newShares);
          shares+=newShares; pool-=buyAmt; deRisked=false; trendCooldown=trendCooldownDays;
        }
      }
      const total = shares*price+pool;
      if (total<=200_000_000 && pool>total*0.10){
        const excess=pool-total*0.10; const extraShares=excess/price;
        avgCost=(avgCost*shares+excess)/(shares+extraShares); shares+=extraShares; pool-=excess;
      }
    }
    dailyTotal.push(shares*price+pool);
  }
  const finalTotal = dailyTotal[dailyTotal.length-1];
  const days = dailyTotal.length;
  const years = days/252;
  const cagr = (Math.pow(finalTotal/totalIn,1/years)-1)*100;
  const mdd = calcMDD(dailyTotal);
  return { cagr, mdd, totalIn, finalTotal };
}

const periods = [
  ['2010-05-13','2015-05-14'],
  ['2011-05-12','2016-05-13'],
  ['2012-05-11','2017-05-15'],
  ['2013-05-15','2018-05-15'],
  ['2014-05-15','2019-05-16'],
  ['2015-05-15','2020-05-15'],
  ['2016-05-16','2021-05-17'],
  ['2017-05-16','2022-05-16'],
  ['2018-05-16','2023-05-17'],
  ['2019-05-17','2024-05-17'],
  ['2020-05-18','2025-05-21'],
  ['2021-05-18','2026-05-22'],
];
const configs = [
  { name: 'sma200_derisk40', smaPeriod:200, deriskFrac:0.40, trendCooldownDays:15 },
];
for (const cfg of configs) {
  console.log('=== ' + cfg.name + ' ===');
  for (const [s,e] of periods) {
    const r = run(s,e,cfg);
    console.log(' ', s,'~',e,'| cagr', r.cagr.toFixed(1), '| mdd', r.mdd.toFixed(1));
  }
}
