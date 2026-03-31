/**
 * Lightpanda 기반 위시켓 파싱/제출 헬퍼.
 * Playwright보다 가볍고 Chrome 프로필 잠금 문제 없음.
 *
 * 사용법:
 *   import { createLP, visitPage, getWishketCookies } from './lightpanda-helper.mjs';
 *
 * 또는 CLI:
 *   node lightpanda-helper.mjs fetch 154079 153957   # 프로젝트 정보 파싱
 *   node lightpanda-helper.mjs boost 154079 153957   # BOOST 통계 (로그인 필요)
 */
import { spawn } from 'child_process';
import { chromium } from 'playwright-core';

// Sentry, Clarity 등 트래킹 스크립트 차단 — 미차단 시 SIGSEGV 크래시
const BLOCK_DOMAINS = [
  'sentry-cdn.com', 'clarity.ms', 'googletagmanager.com',
  'googleoptimize.com', 'doubleclick.net', 'googleadservices.com',
  'snap.licdn.com', 'analytics.google.com', 'wcs.naver.net',
  'pstatic.net', 'hs-scripts.com', 'channel.io', 'hubspot.com',
  'facebook.net', 'google.com/ccm', 'google.com/rmkt',
];

/** Lightpanda CDP 서버 시작 + Playwright 연결 */
export async function createLP(port = 9240) {
  const proc = spawn('lightpanda', [
    'serve', '--host', '127.0.0.1', '--port', String(port),
    '--log-level', 'error', '--timeout', '60', '--http-timeout', '15000',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', d => process.stderr.write(`[LP] ${d}`));
  await new Promise(r => setTimeout(r, 2000));
  const browser = await chromium.connectOverCDP(`ws://127.0.0.1:${port}`);
  return { browser, proc };
}

/** Playwright persistent context에서 위시켓 쿠키 추출 */
export async function getWishketCookies() {
  const pw = await chromium.launchPersistentContext(
    '/Users/dh/Library/Caches/ms-playwright/mcp-chrome-868f91d',
    { headless: true, channel: 'chrome', viewport: { width: 1280, height: 900 } }
  );
  const cookies = await pw.cookies('https://www.wishket.com');
  await pw.close();
  return cookies.filter(c => c.domain.includes('wishket')).map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
  }));
}

/**
 * Lightpanda로 페이지 방문.
 * context 1개 제한이므로 매번 새로 생성/소멸.
 */
export async function visitPage(browser, url, cookies = []) {
  const ctx = await browser.newContext({});
  const page = await ctx.newPage();
  await page.route(u => BLOCK_DOMAINS.some(d => u.toString().includes(d)), r => r.abort());
  if (cookies.length) await ctx.addCookies(cookies);

  await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

/** 프로젝트 정보 파싱 (로그인 불필요) */
export async function fetchProject(browser, id) {
  const { ctx, page } = await visitPage(browser, `https://www.wishket.com/project/${id}/`);
  const data = await page.evaluate(() => {
    const text = document.body?.innerText || '';
    const title = document.querySelector('h1')?.textContent?.trim() || '';
    return { title, bodyLength: text.length, body: text };
  });
  await page.close();
  await ctx.close();
  return { id, ...data };
}

/** BOOST 통계 파싱 (로그인 필요 → 쿠키 주입) */
export async function fetchBoost(browser, id, cookies) {
  const { ctx, page } = await visitPage(
    browser,
    `https://www.wishket.com/project/${id}/proposal/apply/`,
    cookies
  );

  if (page.url().includes('auth.wishket.com')) {
    await page.close(); await ctx.close();
    return { id, error: 'NOT_LOGGED_IN' };
  }

  // "실시간 확인" 버튼 클릭
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button, [class*="btn"]')]
      .find(b => b.textContent.includes('실시간 확인'));
    if (btn) btn.click();
  });
  await page.waitForTimeout(2000);

  const stats = await page.evaluate(() => {
    const result = { min: 0, avg: 0, max: 0, applicants: 0, budget: '' };
    const text = document.body?.innerText || '';

    const appMatch = text.match(/지원자\s*(\d+)명/);
    if (appMatch) result.applicants = parseInt(appMatch[1]);

    const budgetMatch = text.match(/예상 금액[^0-9]*([0-9,]+)/);
    if (budgetMatch) result.budget = budgetMatch[1];

    const boxes = document.querySelectorAll('[class*="statistics"], [class*="stat-box"]');
    for (const box of boxes) {
      const t = box.textContent;
      const num = parseInt(t.replace(/[^0-9]/g, '') || '0');
      if (t.includes('최저') && num > 0) result.min = num;
      if (t.includes('평균') && num > 0) result.avg = num;
      if (t.includes('최고') && num > 0) result.max = num;
    }
    return result;
  });

  await page.close();
  await ctx.close();
  return { id, ...stats };
}

/** 지원서 폼 입력 + 제출 (Lightpanda, JS click 사용) */
export async function submitProposal(browser, cookies, { id, amount, term, body, portfolios, desc }) {
  const { ctx, page } = await visitPage(
    browser,
    `https://www.wishket.com/project/${id}/proposal/apply/`,
    cookies
  );

  if (page.url().includes('auth.wishket.com')) {
    await page.close(); await ctx.close();
    return { id, status: 'NOT_LOGGED_IN' };
  }

  // 금액/기간/본문
  await page.fill('input[name="budget"]', String(amount));
  await page.fill('input[name="term"]', String(term));
  await page.fill('textarea[name="body"]', body);

  // 포트폴리오 라디오 (JS click)
  await page.evaluate(() => {
    document.querySelector('label[for="has_related_portfolio"]')?.click();
  });
  await page.waitForTimeout(500);

  // 포트폴리오 모달
  await page.evaluate(() => {
    document.querySelector('.btn-select-related-portfolio')?.click();
  });
  await page.waitForTimeout(1000);

  // 포트폴리오 선택
  for (const title of portfolios) {
    const prefix = title.substring(0, 10);
    await page.evaluate((pf) => {
      const match = [...document.querySelectorAll('.portfolio-box')]
        .find(b => b.querySelector('.portfolio-title-box')?.innerText?.includes(pf));
      if (match) match.click();
    }, prefix);
    await page.waitForTimeout(300);
  }

  // 선택 완료
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.includes('선택 완료'))?.click();
  });
  await page.waitForTimeout(500);

  // 포트폴리오 설명
  const descTa = page.locator('textarea[name="related_description"]');
  if (await descTa.count() > 0) await descTa.fill(desc);
  await page.waitForTimeout(300);

  // 1차: "프로젝트 지원"
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === '프로젝트 지원' && !b.disabled)?.click();
  });
  await page.waitForTimeout(2000);

  // 2차: "제출하기"
  await page.evaluate(() => {
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.trim() === '제출하기')?.click();
  });
  await page.waitForTimeout(3000);

  await page.close();
  await ctx.close();
  return { id, status: 'DONE' };
}

// CLI 모드
if (process.argv[1]?.endsWith('lightpanda-helper.mjs')) {
  const [cmd, ...ids] = process.argv.slice(2);
  if (!cmd || !ids.length) {
    console.error('Usage: node lightpanda-helper.mjs <fetch|boost> <ID1> <ID2> ...');
    process.exit(1);
  }

  const { browser, proc } = await createLP();

  if (cmd === 'fetch') {
    for (const id of ids) {
      const r = await fetchProject(browser, id);
      console.log(JSON.stringify({ id: r.id, title: r.title, bodyLength: r.bodyLength }));
    }
  } else if (cmd === 'boost') {
    const cookies = await getWishketCookies();
    for (const id of ids) {
      const r = await fetchBoost(browser, id, cookies);
      console.log(JSON.stringify(r));
    }
  }

  await browser.close().catch(() => {});
  proc.kill();
}
