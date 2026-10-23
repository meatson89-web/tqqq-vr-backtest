// TQQQ / QQQ 일별 종가(수정주가)를 Yahoo Finance에서 받아 src/data/*.json 갱신
// GitHub Actions 스케줄러(.github/workflows/update-data.yml)에서 실행됨
//   - tqqq.json : 백테스트 대시보드용 (2010~)
//   - qqq.json  : TQQQ 모니터링용 이격도·3배 시뮬 기준 (1999~)
//   - soxl_1h.json : SOXL 현황판용 정규장 1시간봉 종가 (야후는 최근 730일만 주므로 기존 파일에 이어 붙인다)
//   - sox.json  : SOXL 현황판 추세 필터용 ^SOX 일봉 (2009~)
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
  // 장 마감 후 몇 시간 동안은 마지막 거래일 일봉이 빠지거나 adjclose가 null로 와서
  // 하루씩 밀린다 → 정규장 마감(뉴욕 16시) 이후 확정된 meta 종가로 보충.
  // 다음 실행에서 전체를 다시 받으므로 Yahoo 일봉이 생기면 그 값으로 덮어써진다.
  const meta = result.meta;
  const ny = new Date((meta.regularMarketTime + meta.gmtoffset) * 1000);
  const nyDate = ny.toISOString().slice(0, 10);
  if (ny.getUTCHours() >= 16 && meta.regularMarketPrice != null
      && rows.length && rows[rows.length - 1][0] < nyDate) {
    rows.push([nyDate, Math.round(meta.regularMarketPrice * 10000) / 10000]);
    console.log(`${symbol}: ${nyDate} 일봉 미반영 → meta 종가 ${meta.regularMarketPrice}로 보충`);
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

// 정규장 1시간봉 (뉴욕 09:30 앵커). 16:00에 붙는 장 마감 시점 값은 봉이 아니라 빼고, 기존 파일과 시각 기준으로 합친다.
async function fetchHourly(symbol, name) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=730d&interval=60m`
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${symbol} 1시간봉 요청 실패: ${res.status}`);
  const result = (await res.json())?.chart?.result?.[0];
  if (!result?.timestamp) throw new Error(`${symbol} 1시간봉 응답에 데이터 없음`);
  const off = result.meta.gmtoffset;
  const close = result.indicators.quote[0].close;
  const merged = new Map();
  const out = path.join(DATA_DIR, name);
  if (fs.existsSync(out)) for (const [t, c] of JSON.parse(fs.readFileSync(out, 'utf-8'))) merged.set(t, c);
  let n = 0;
  result.timestamp.forEach((ts, i) => {
    if (close[i] == null) return;
    const ny = new Date((ts + off) * 1000);
    if (ny.getUTCHours() >= 16) return;
    merged.set(new Date(ts * 1000).toISOString().slice(0, 16) + 'Z', Math.round(close[i] * 10000) / 10000);
    n++;
  });
  if (n < 1000) throw new Error(`${symbol} 1시간봉 행 수 비정상 (${n}) — 갱신 중단`);
  return [...merged].sort((a, b) => a[0] < b[0] ? -1 : 1);
}

const tqqq = await fetchSeries('TQQQ', '2010-01-01', 3000);
const qqq = await fetchSeries('QQQ', '1999-03-01', 6000);

// 두 계열의 최신일이 어긋나면 지표(이격도)가 잘못 계산되므로 확인만 남긴다
const lastT = tqqq[tqqq.length - 1][0];
const lastQ = qqq[qqq.length - 1][0];
if (lastT !== lastQ) console.warn(`주의: 최신일 불일치 TQQQ ${lastT} / QQQ ${lastQ}`);

const a = writeIfChanged('tqqq.json', tqqq);
const b = writeIfChanged('qqq.json', qqq);
const c = writeIfChanged('soxl_1h.json', await fetchHourly('SOXL', 'soxl_1h.json'));
const d = writeIfChanged('sox.json', await fetchSeries('%5ESOX', '2009-01-01', 3000));
if (!a && !b && !c && !d) console.log('전체 변경 없음.');
