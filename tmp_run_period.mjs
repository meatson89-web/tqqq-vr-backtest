import { runFinalBacktest, DATA_START, DATA_END } from './src/lib/backtest.js';

console.log('data range:', DATA_START, '~', DATA_END);

const { stats } = runFinalBacktest('2019-05-05', '2024-05-05');
console.log(JSON.stringify(stats, null, 2));
