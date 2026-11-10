// QQQ로 TQQQ를 1999년까지 역산해 합성한다.  →  src/data/tqqq_sim.json
//   node scripts/build-sim-tqqq.mjs
// (예전 build-sim-tqqq.py를 Node로 옮긴 것. 파이썬·yfinance 없이 돌고, 데이터 자동 갱신
//  워크플로에서 update-data.mjs 다음에 실행된다. 입력은 방금 갱신된 qqq.json·tqqq.json과
//  야후의 13주 국채 수익률 ^IRX다.)
//
// 실제 TQQQ 데이터는 2010-02부터라 닷컴버블(2000-2002)과 금융위기(2008)가 없다.
// 이 두 구간은 전략 검증에 결정적이므로 QQQ로 합성해 채운다.
//
// 3배 단순곱은 쓰지 않는다. 3배 ETF는 자산의 2배를 빌려 굴리므로 차입비용이 붙고,
// 2000년 기준금리는 6.5%였다. 이를 빼먹으면 2000년대가 실제보다 크게 좋게 나온다.
//
//     일간수익 = 3 × QQQ일간수익 − (운용보수 + 2 × (단기금리 + 스프레드)) / 252
//
// 스프레드는 실제 TQQQ(2010~)의 누적수익률과 일치하도록 보정한다. 그래서 누적수익이 맞는 것은
// 검증이 아니다. 보정 대상이 아닌 최대낙폭·일간 상관·연도별 수익률로 신뢰성을 본다.
// ※ 스프레드 하나로는 시기별 비용 차이를 못 담는다 — 연도별 오차가 2010~2017년은 실제가
//   +0.5~1.8%p 높고 2020~2025년은 0.8~2.2%p 낮은 쪽으로 흐른다(2026-11 감사).
//   2010년 이전에 어느 쪽인지는 확인할 방법이 없다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'data');
const ER = 0.0095;      // TQQQ 운용보수 (상장 초기 기준)
const LEVERAGE = 3;
const OVERLAP_FROM = '2010-02-11';

const readSeries = name => JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf-8'));

// 13주 국채 수익률(연율 %). 날짜 → 값
async function fetchIrx() {
  const period1 = Math.floor(Date.UTC(1999, 0, 1) / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/%5EIRX?period1=${period1}&period2=${period2}&interval=1d`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`^IRX 요청 실패: ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0];
  if (!r?.timestamp) throw new Error('^IRX 응답에 데이터 없음');
  const close = r.indicators.quote[0].close;
  const rows = [];
  r.timestamp.forEach((ts, i) => {
    if (close[i] != null) rows.push([new Date((ts + r.meta.gmtoffset) * 1000).toISOString().slice(0, 10), close[i]]);
  });
  if (rows.length < 6000) throw new Error(`^IRX 행 수 비정상 (${rows.length}) — 갱신 중단`);
  return rows;
}

const qqq = readSeries('qqq.json');
const tqqq = readSeries('tqqq.json');
const irx = await fetchIrx();

// QQQ 일간수익과, 그 날짜에 맞춘 단기금리(없는 날은 직전 값, 맨 앞은 첫 값)
const dates = [], qret = [];
for (let i = 1; i < qqq.length; i++) { dates.push(qqq[i][0]); qret.push(qqq[i][1] / qqq[i - 1][1] - 1); }
const rate = new Array(dates.length);
{
  let k = 0, last = irx[0][1] / 100;
  for (let i = 0; i < dates.length; i++) {
    while (k < irx.length && irx[k][0] <= dates[i]) { last = irx[k][1] / 100; k++; }
    rate[i] = last;
  }
}

function simulate(spread) {
  const out = new Array(dates.length);
  let v = 1;
  for (let i = 0; i < dates.length; i++) {
    const drag = (ER + 2 * (rate[i] + spread)) / 252;
    v *= 1 + Math.max(-0.99, LEVERAGE * qret[i] - drag);
    out[i] = v;
  }
  return out;
}

// ── 스프레드 보정: 겹치는 구간의 누적수익을 실제 TQQQ와 맞춘다 ──
const idxOf = new Map(dates.map((d, i) => [d, i]));
const ov = tqqq.filter(([d]) => d >= OVERLAP_FROM && idxOf.has(d));
if (ov.length < 3000) throw new Error(`겹치는 구간이 너무 짧다 (${ov.length}일) — 갱신 중단`);
const i0 = idxOf.get(ov[0][0]), i1 = idxOf.get(ov.at(-1)[0]);
const target = ov.at(-1)[1] / ov[0][1];
let lo = -0.02, hi = 0.05;
for (let k = 0; k < 80; k++) {
  const mid = (lo + hi) / 2;
  const g = simulate(mid);
  if (g[i1] / g[i0] > target) lo = mid; else hi = mid;
}
const spread = (lo + hi) / 2;
const sim = simulate(spread);
if (!(spread > -0.02 && spread < 0.05)) throw new Error(`스프레드 보정값 비정상 (${spread}) — 갱신 중단`);

// ── 검증 (보정하지 않은 항목으로 확인) ──
const mddOf = a => { let p = -Infinity, m = 0; for (const v of a) { if (v > p) p = v; m = Math.min(m, v / p - 1); } return m * 100; };
const a = ov.map(r => r[1]), b = ov.map(([d]) => sim[idxOf.get(d)]);
const ra = [], rb = [];
for (let i = 1; i < a.length; i++) { ra.push(a[i] / a[i - 1] - 1); rb.push(b[i] / b[i - 1] - 1); }
const mean = x => x.reduce((s, v) => s + v, 0) / x.length;
const sd = x => { const m = mean(x); return Math.sqrt(mean(x.map(v => (v - m) ** 2))); };
const ma = mean(ra), mb = mean(rb);
const corr = mean(ra.map((v, i) => (v - ma) * (rb[i] - mb))) / (sd(ra) * sd(rb));
console.log(`차입 스프레드 보정값: ${(spread * 100).toFixed(2)}%p`);
console.log(`[검증] 실제 TQQQ vs 합성, ${ov[0][0]} ~ ${ov.at(-1)[0]} (${ov.length}일)`);
console.log(`  누적수익   ${target.toFixed(1)}배 vs ${(b.at(-1) / b[0]).toFixed(1)}배   (보정 대상)`);
console.log(`  일간 상관  ${corr.toFixed(4)}`);
console.log(`  추적오차   ${(sd(ra.map((v, i) => v - rb[i])) * 100).toFixed(3)}%p/일`);
console.log(`  최대낙폭   ${mddOf(a).toFixed(1)}% vs ${mddOf(b).toFixed(1)}%   (독립 검증)`);
if (corr < 0.99) throw new Error(`일간 상관이 너무 낮다 (${corr.toFixed(4)}) — 갱신 중단`);

const rows = dates.map((d, i) => [d, Math.round(sim[i] * 1e6) / 1e6]);
const out = path.join(DATA_DIR, 'tqqq_sim.json');
const next = JSON.stringify(rows);
if (fs.existsSync(out) && fs.readFileSync(out, 'utf-8').trim() === next) {
  console.log(`tqqq_sim.json: 변경 없음 (최신일 ${rows.at(-1)[0]})`);
} else {
  fs.writeFileSync(out, next);
  console.log(`tqqq_sim.json: 갱신 ${rows.length}행, ${rows[0][0]} ~ ${rows.at(-1)[0]}`);
}
