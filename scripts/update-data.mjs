// TQQQ 일별 종가(수정주가) 데이터를 Yahoo Finance에서 받아 src/data/tqqq.json 갱신
// GitHub Actions 스케줄러(.github/workflows/update-data.yml)에서 매일 실행됨
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, '..', 'src', 'data', 'tqqq.json');

const period1 = Math.floor(new Date('2010-01-01T00:00:00Z').getTime() / 1000);
const period2 = Math.floor(Date.now() / 1000);
const url = `https://query1.finance.yahoo.com/v8/finance/chart/TQQQ?period1=${period1}&period2=${period2}&interval=1d`;

const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`Yahoo Finance 요청 실패: ${res.status}`);
const json = await res.json();
const result = json?.chart?.result?.[0];
if (!result) throw new Error('Yahoo Finance 응답에 데이터가 없습니다: ' + JSON.stringify(json).slice(0, 300));

const timestamps = result.timestamp;
const adjclose = result.indicators.adjclose[0].adjclose;

const rows = [];
for (let i = 0; i < timestamps.length; i++) {
  const price = adjclose[i];
  if (price == null) continue;
  const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
  rows.push([date, Math.round(price * 10000) / 10000]);
}

if (rows.length < 3000) {
  throw new Error(`데이터 행 수가 비정상적으로 적습니다 (${rows.length}행) — 갱신 중단`);
}

const existing = fs.existsSync(OUT_PATH) ? fs.readFileSync(OUT_PATH, 'utf-8') : '';
const next = JSON.stringify(rows);

if (existing.trim() === next.trim()) {
  console.log(`변경 없음. 최신일: ${rows[rows.length - 1][0]}`);
  process.exit(0);
}

fs.writeFileSync(OUT_PATH, next);
console.log(`갱신 완료: ${rows.length}행, ${rows[0][0]} ~ ${rows[rows.length - 1][0]}`);
