#!/usr/bin/env npx zx
/**
 * 그룹바이 이력서 분석 API (브라우저 불필요)
 *
 * 사용법:
 *   npx zx scripts/groupby-api.mjs improve cv/output/combined.pdf
 *   npx zx scripts/groupby-api.mjs job-match cv/output/combined.pdf "https://www.wanted.co.kr/wd/342655"
 *   npx zx scripts/groupby-api.mjs both cv/output/combined.pdf "https://www.wanted.co.kr/wd/342655"
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { gzipSync } from 'zlib';

// ── 설정 ─────────────────────────────────────────────────────

const API = 'https://api.groupby.kr/resume-analysis';
const SITE = 'https://groupby.kr';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';
const HEADERS = { Referer: `${SITE}/`, Origin: SITE, 'User-Agent': UA };
const OUTPUT_DIR = resolve('cv/output');

const IMPROVE_DEFAULTS = {
  positionType: '17',     // 개발
  experience: '7',
  businessScale: '대기업',
  serviceAreas: '37',     // 테크
};

const POLL_INTERVAL = 5000;
const POLL_MAX = 24;

// ── 인자 ─────────────────────────────────────────────────────

const [mode = 'improve', pdfPath = 'cv/output/combined.pdf', jobUrl = ''] = argv._;

if (!fs.existsSync(pdfPath)) {
  console.error(`오류: PDF 파일 없음: ${pdfPath}`);
  process.exit(1);
}
if ((mode === 'job-match' || mode === 'both') && !jobUrl) {
  console.error('오류: job-match/both 모드에는 공고 URL이 필요합니다.');
  process.exit(1);
}

// ── 폴링 ─────────────────────────────────────────────────────

async function pollResult(endpoint, uuid, label) {
  console.log(chalk.gray(`[groupby] ${label} 결과 대기...`));
  for (let i = 0; i < POLL_MAX; i++) {
    const res = await fetch(`${API}/${endpoint}/${uuid}`, { headers: HEADERS });
    const data = await res.json();
    if (data.data?.output || data.data?.score !== undefined) return data.data;
    console.log(chalk.gray(`  대기 ${i + 1}/${POLL_MAX}...`));
    await sleep(POLL_INTERVAL);
  }
  throw new Error('시간 초과');
}

// ── 팩폭 ─────────────────────────────────────────────────────

async function runImprove(pdf) {
  console.log(chalk.blue(`[groupby] 팩폭 제출: ${pdf}`));
  const form = new FormData();
  form.append('file', new Blob([readFileSync(pdf)]), 'resume.pdf');
  form.append('positionType', IMPROVE_DEFAULTS.positionType);
  form.append('experience', IMPROVE_DEFAULTS.experience);
  form.append('businessScale', IMPROVE_DEFAULTS.businessScale);
  form.append('serviceAreas', IMPROVE_DEFAULTS.serviceAreas);

  const res = await fetch(`${API}/fact-assault`, { method: 'POST', headers: HEADERS, body: form });
  const { data } = await res.json();
  if (!data?.id) throw new Error('제출 실패');
  console.log(chalk.gray(`  UUID: ${data.id}`));

  const result = await pollResult('fact-assault', data.id, '팩폭');

  console.log(chalk.bold('\n' + '='.repeat(60)));
  console.log(chalk.bold('그룹바이 팩폭 결과'));
  console.log('='.repeat(60));
  for (const key of ['introduction', 'career', 'performance', 'skills', 'overall']) {
    const s = result.output[key];
    console.log(chalk.yellow(`\n### ${s.title}`));
    console.log(s.content);
  }

  writeFileSync(resolve(OUTPUT_DIR, 'groupby-improve-result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ── 합격률 예측 ──────────────────────────────────────────────

async function runJobMatch(pdf, url) {
  // 1. 공고 HTML 크롤링 (그룹바이 자체 API)
  console.log(chalk.blue(`[groupby] 공고 크롤링: ${url}`));
  const crawlRes = await fetch(`${SITE}/api/crawl-html?url=${encodeURIComponent(url)}`, { headers: HEADERS });
  const html = await crawlRes.text();
  console.log(chalk.gray(`  HTML: ${html.length} bytes`));

  if (new TextEncoder().encode(html).length > 204800) {
    throw new Error('공고 내용이 너무 많아 분석 불가 (200KB 초과)');
  }

  // 2. gzip 압축
  const gzipped = gzipSync(Buffer.from(html, 'utf-8'));
  console.log(chalk.gray(`  GZ: ${gzipped.length} bytes`));

  // 3. 제출
  console.log(chalk.blue(`[groupby] 합격률 예측 제출`));
  const form = new FormData();
  form.append('resumeFile', new Blob([readFileSync(pdf)]), 'resume.pdf');
  form.append('positionHtmlFile', new Blob([gzipped], { type: 'application/gzip' }), 'position.html.gz');

  const res = await fetch(`${API}/character-match`, { method: 'POST', headers: HEADERS, body: form });
  const { data } = await res.json();
  if (!data?.id) throw new Error('제출 실패');
  console.log(chalk.gray(`  UUID: ${data.id}`));

  const result = await pollResult('character-match', data.id, '합격률 예측');

  console.log(chalk.bold('\n' + '='.repeat(60)));
  console.log(chalk.bold(`그룹바이 합격률 예측 — ${chalk.green(result.score + '점')}`));
  console.log(`채용 공고: ${url}`);
  console.log('='.repeat(60));
  console.log(chalk.gray(`\n${result.jobPostingSummary}`));
  console.log(chalk.yellow('\n### 평가 항목'));
  for (const c of result.conditionFulfillment) {
    const icon = c.fulfillmentIndex >= 0.8 ? '✅' : c.fulfillmentIndex >= 0.5 ? '⚠️' : '❌';
    console.log(`${icon} ${c.condition} (${(c.fulfillmentIndex * 100).toFixed(0)}%)`);
    console.log(chalk.gray(`   ${c.detail}`));
  }
  console.log(chalk.green(`\n### 강점\n${result.positiveFeedback}`));
  console.log(chalk.red(`\n### 개선점\n${result.negativeFeedback}`));

  writeFileSync(resolve(OUTPUT_DIR, 'groupby-job-match-result.json'), JSON.stringify(result, null, 2));
  return result;
}

// ── 실행 ─────────────────────────────────────────────────────

if (mode === 'improve' || mode === 'both') await runImprove(pdfPath);
if (mode === 'job-match' || mode === 'both') await runJobMatch(pdfPath, jobUrl);
