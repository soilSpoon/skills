/**
 * BOOST 금액 통계를 Playwright로 파싱하는 스크립트.
 * Phase 1에서 실행하여 금액 결정 전에 시장 데이터를 수집한다.
 *
 * Usage: node fetch-boost-stats.mjs 154079 153957 154097
 * Output: JSON으로 각 프로젝트의 BOOST 통계 출력
 */
import { chromium } from 'playwright';

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('Usage: node fetch-boost-stats.mjs <ID1> <ID2> ...');
  process.exit(1);
}

async function fetchBoost(page, id) {
  await page.goto(`https://www.wishket.com/project/${id}/proposal/apply/`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  if (page.url().includes('auth.wishket.com')) {
    return { id, error: 'NOT_LOGGED_IN' };
  }

  // "실시간 확인" 버튼이 있으면 클릭하여 BOOST 통계 로드
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [class*="btn"]')]
      .find(b => b.textContent.includes('실시간 확인'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => {
    const result = { min: 0, p75: 0, avg: 0, p25: 0, max: 0, applicants: 0 };

    // 지원자 수
    const appText = document.body.innerText.match(/지원자\s*(\d+)명/);
    if (appText) result.applicants = parseInt(appText[1]);

    // 예상 금액 / 기간
    const budgetEl = [...document.querySelectorAll('p')]
      .find(p => p.textContent.includes('예상 금액'));
    if (budgetEl) {
      const next = budgetEl.nextElementSibling || budgetEl.parentElement;
      const m = next?.textContent?.replace(/[^0-9]/g, '');
      if (m) result.budget = parseInt(m);
    }

    const termEl = [...document.querySelectorAll('p')]
      .find(p => p.textContent.includes('예상 기간'));
    if (termEl) {
      const next = termEl.nextElementSibling || termEl.parentElement;
      const m = next?.textContent?.match(/(\d+)일/);
      if (m) result.term = parseInt(m[1]);
    }

    // BOOST 통계 (최저/평균/최고 박스)
    const boxes = document.querySelectorAll('[class*="statistics"], [class*="stat-box"]');
    for (const box of boxes) {
      const text = box.textContent;
      const num = parseInt(text.replace(/[^0-9]/g, '') || '0');
      if (text.includes('최저') && num > 0) result.min = num;
      if (text.includes('평균') && num > 0) result.avg = num;
      if (text.includes('최고') && num > 0) result.max = num;
    }

    // 75%/50%/25% 라벨의 금액 (BOOST 차트 위 라벨)
    const labels = document.querySelectorAll('[class*="label"], [class*="price-tag"]');
    const prices = [];
    for (const el of labels) {
      const num = parseInt(el.textContent.replace(/[^0-9]/g, '') || '0');
      if (num > 100000) prices.push(num);
    }
    // 3개면 75%, 50%, 25% 순서
    if (prices.length >= 3) {
      result.p75 = prices[0];
      result.avg = result.avg || prices[1];
      result.p25 = prices[2];
    }

    return result;
  });

  return { id, ...stats };
}

async function main() {
  const ctx = await chromium.launchPersistentContext(
    '/Users/dh/Library/Caches/ms-playwright/mcp-chrome-868f91d',
    { headless: !process.argv.includes('--headful'), channel: 'chrome', viewport: { width: 1280, height: 900 } }
  );
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  const results = [];
  for (const id of ids) {
    const r = await fetchBoost(page, id);
    results.push(r);
    console.error(`[${id}] min=${r.min} p75=${r.p75} avg=${r.avg} max=${r.max} applicants=${r.applicants}`);
  }

  // JSON 출력 (stdout)
  console.log(JSON.stringify(results, null, 2));
}

main().catch(e => console.error(e.message));
