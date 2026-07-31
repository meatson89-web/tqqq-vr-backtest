import { getRollingWindows } from './src/lib/backtest.js';
const windows = getRollingWindows();
console.log('total windows:', windows.length);
for (const w of windows) {
  console.log(w.id, w.startDate, '~', w.endDate, 'ret', w.stats.returnPct.toFixed(1), 'cagr', w.stats.cagr.toFixed(1), 'mdd', w.stats.mdd.toFixed(1), 'totalIn', w.stats.totalIn);
}
