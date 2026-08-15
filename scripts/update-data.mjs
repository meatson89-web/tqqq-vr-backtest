// TQQQ / QQQ 일별 종가(수정주가)를 Yahoo Finance에서 받아 src/data/*.json 갱신
// GitHub Actions 스케줄러(.github/workflows/update-data.yml)에서 실행됨
//   - tqqq.json : 백테스트 대시보드용 (2010~)
//   - qqq.json  : TQQQ 모니터링용 이격도·3배 시뮬 기준 (1999~)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'src', 'data');

async function fetchSeries(symbol, fromISO, minRows) {
  const period1 = Math.floor(new Date(fromISO + 'T00:00:00Z').getTime() / 1000);
  const period2 = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`
    + `?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${symbol} 요청 실패: ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`${symbol} 응답에 데이터 없음: ` + JSON.stringify(json).slice(0, 300));

  const timestamps = result.timestamp;
  const adjclose = result.indicators.adjclose[0].adjclose;
  const rows = [];
  for (let i = 0; i < timestamps.length; i++) {
    const price = adjclose[i];
    if (price == null) continue;
    rows.push([
      new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      Math.round(price * 10000) / 10000,
    ]);
  }
  // 방어: 응답이 깨졌을 때 멀쩡한 파일을 덮어쓰지 않는다
  if (rows.length < minRows) {
    throw new Error(`${symbol} 행 수 비정상 (${rows.length} < ${minRows}) — 갱신 중단`);
  }
  return rows;
}

function writeIfChanged(name, rows) {
  const out = path.join(DATA_DIR, name);
  const next = JSON.stringify(rows);
  const prev = fs.existsSync(out) ? fs.readFileSync(out, 'utf-8') : '';
  if (prev.trim() === next.trim()) {
    console.log(`${name}: 변경 없음 (최신일 ${rows[rows.length - 1][0]})`);
    return false;
  }
  fs.writeFileSync(out, next);
  console.log(`${name}: 갱신 ${rows.length}행, ${rows[0][0]} ~ ${rows[rows.length - 1][0]}`);
  return true;
}

const tqqq = await fetchSeries('TQQQ', '2010-01-01', 3000);
const qqq = await fetchSeries('QQQ', '1999-03-01', 6000);

// 두 계열의 최신일이 어긋나면 지표(이격도)가 잘못 계산되므로 확인만 남긴다
const lastT = tqqq[tqqq.length - 1][0];
const lastQ = qqq[qqq.length - 1][0];
if (lastT !== lastQ) console.warn(`주의: 최신일 불일치 TQQQ ${lastT} / QQQ ${lastQ}`);

const a = writeIfChanged('tqqq.json', tqqq);
const b = writeIfChanged('qqq.json', qqq);
if (!a && !b) console.log('전체 변경 없음.');
