#!/usr/bin/env node
/**
 * 위시켓 자동화 통합 CLI (Lightpanda).
 *
 * Usage:
 *   node wishket.mjs list [--pages N]              # 프로젝트 목록
 *   node wishket.mjs detail <ID> [ID...]           # 프로젝트 상세
 *   node wishket.mjs boost <ID> [ID...]            # BOOST 통계 (로그인 필요)
 *   node wishket.mjs submit <proposals.json>       # 폼 제출 (로그인 필요)
 *
 * 환경: playwright-core + lightpanda 바이너리 필요
 * 쿠키: boost/submit는 Playwright persistent context에서 자동 추출
 */
import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { createRequire } from 'module';

// playwright-core를 portfolio/node_modules에서 찾기 (스킬 디렉토리에는 없으므로)
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = await import('playwright-core'));
} catch {
  // 폴백: 알려진 경로에서 직접 로드
  const pw = require('/Users/dh/dev/portfolio/node_modules/playwright-core');
  chromium = pw.chromium;
}

// ── 공통 ──

const BLOCK_DOMAINS = [
  'sentry-cdn.com', 'clarity.ms', 'googletagmanager.com',
  'googleoptimize.com', 'doubleclick.net', 'googleadservices.com',
  'snap.licdn.com', 'analytics.google.com', 'wcs.naver.net',
  'pstatic.net', 'hs-scripts.com', 'channel.io', 'hubspot.com',
  'facebook.net', 'google.com/ccm', 'google.com/rmkt',
];

const CHROME_PROFILE = '/Users/dh/Library/Caches/ms-playwright/mcp-chrome-868f91d';
const FILTER_URL = 'https://www.wishket.com/project/?d=A4FwvCCGDODWD6AjGBTAJgMgMZjSgbigDYD2wAtigHYgYBmdYA7iohilmmACoBOAriiA';

let LP_PORT = 9260;
let lpProc = null;
let lpBrowser = null;

async function startLP() {
  lpProc = spawn('lightpanda', [
    'serve', '--host', '127.0.0.1', '--port', String(LP_PORT),
    '--log-level', 'error', '--timeout', '120', '--http-timeout', '15000',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  lpProc.stderr.on('data', d => process.stderr.write(d));
  lpProc.on('exit', (code, signal) => {
    if (signal === 'SIGSEGV') console.error('[LP] SIGSEGV — 트래킹 스크립트 차단 확인 필요');
  });
  await new Promise(r => setTimeout(r, 2000));
  lpBrowser = await chromium.connectOverCDP(`ws://127.0.0.1:${LP_PORT}`);
}

async function stopLP() {
  await lpBrowser?.close().catch(() => {});
  lpProc?.kill();
}

/** 페이지 방문 (context 1개 제한 → 매번 새로 생성) */
async function visit(url, cookies = []) {
  const ctx = await lpBrowser.newContext({});
  const page = await ctx.newPage();
  await page.route(u => BLOCK_DOMAINS.some(d => u.toString().includes(d)), r => r.abort());
  if (cookies.length) await ctx.addCookies(cookies);
  await page.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' });
  return { ctx, page };
}

/** Playwright persistent context에서 위시켓 쿠키 추출 */
async function extractCookies() {
  console.error('[cookies] Extracting from Chrome profile...');
  const pw = await chromium.launchPersistentContext(CHROME_PROFILE, {
    headless: true, channel: 'chrome', viewport: { width: 1280, height: 900 },
  });
  const cookies = await pw.cookies('https://www.wishket.com');
  await pw.close();
  const filtered = cookies
    .filter(c => c.domain.includes('wishket'))
    .map(c => ({ name: c.name, value: c.value, domain: c.domain, path: c.path || '/' }));
  console.error(`[cookies] Got ${filtered.length} wishket cookies`);
  return filtered;
}

// ── list ──

async function cmdList(args) {
  const pages = parseInt(args.find((_, i, a) => a[i - 1] === '--pages') || '7');
  await startLP();

  const all = [];
  const seen = new Set();

  for (let p = 1; p <= pages; p++) {
    const url = p === 1 ? FILTER_URL : `${FILTER_URL}&page=${p}`;
    console.error(`[list] Page ${p}/${pages}`);

    try {
      const { ctx, page } = await visit(url);
      const rows = await page.evaluate(() => {
        const results = [];
        const links = document.querySelectorAll('a[href*="/project/"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const m = href.match(/\/project\/(\d+)\//);
          if (!m) continue;
          const title = link.textContent?.trim();
          if (!title || title.length < 5) continue;

          // 부모 요소에서 추가 정보 추출
          const container = link.closest('[class*="item"], [class*="card"], li, tr') || link.parentElement?.parentElement;
          const text = container?.textContent || '';
          const budget = text.match(/([0-9,]+)원/);
          const duration = text.match(/(\d+)일/);
          const applicants = text.match(/(\d+)명/);

          results.push({
            id: m[1],
            title: title.replace(/\s+/g, ' '),
            budget: budget ? budget[1] + '원' : '협의',
            duration: duration ? duration[1] + '일' : '-',
            applicants: applicants ? applicants[1] + '명' : '비공개',
          });
        }
        return results;
      });

      for (const r of rows) {
        if (!seen.has(r.id)) { seen.add(r.id); all.push(r); }
      }
      console.error(`  → ${rows.length} found (total: ${all.length})`);
      await page.close();
      await ctx.close();

      if (rows.length === 0) break;
    } catch (e) {
      console.error(`  → FAIL: ${e.message.split('\n')[0]}`);
      break;
    }
  }

  console.log(JSON.stringify(all, null, 2));
  await stopLP();
}

// ── detail ──

async function cmdDetail(ids) {
  await startLP();
  const results = [];

  for (const id of ids) {
    console.error(`[detail] ${id}`);
    try {
      const { ctx, page } = await visit(`https://www.wishket.com/project/${id}/`);
      const data = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const title = document.querySelector('h1')?.textContent?.trim() || '';

        const budget = text.match(/예상 금액[^0-9]*([0-9,]+)/)?.[1] || text.match(/([0-9,]+)원/)?.[1] || '협의';
        const duration = text.match(/예상 기간[^0-9]*(\d+)/)?.[1] || '';
        const applicants = text.match(/지원자[^0-9]*(\d+)/)?.[1] || '비공개';
        const deadline = text.match(/모집 마감[^\d]*([\d.]+)/)?.[1] || '';

        // 기술 스택
        const techSection = text.match(/사용\s*기술[\s\S]*?(?=업무|프로젝트|클라이언트)/)?.[0] || '';

        // 상세 설명 (h1 이후 텍스트)
        const desc = text.substring(0, 3000);

        return { title, budget, duration, applicants, deadline, techSection: techSection.trim(), bodyLength: text.length };
      });
      results.push({ id, ...data });
      await page.close();
      await ctx.close();
    } catch (e) {
      results.push({ id, error: e.message.split('\n')[0] });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await stopLP();
}

// ── boost ──

async function cmdBoost(ids) {
  const cookies = await extractCookies();
  await startLP();
  const results = [];

  for (const id of ids) {
    console.error(`[boost] ${id}`);
    try {
      const { ctx, page } = await visit(
        `https://www.wishket.com/project/${id}/proposal/apply/`, cookies
      );

      if (page.url().includes('auth.wishket.com')) {
        results.push({ id, error: 'NOT_LOGGED_IN' });
        await page.close(); await ctx.close();
        continue;
      }

      // "실시간 확인" 버튼 클릭
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, [class*="btn"]')]
          .find(b => b.textContent.includes('실시간 확인'));
        if (btn) btn.click();
      });
      await page.waitForTimeout(2000);

      const stats = await page.evaluate(() => {
        const text = document.body?.innerText || '';
        const result = { min: 0, avg: 0, max: 0, applicants: 0, budget: '' };

        const app = text.match(/지원자\s*(\d+)명/);
        if (app) result.applicants = parseInt(app[1]);

        const bud = text.match(/예상 금액[^0-9]*([0-9,]+)/);
        if (bud) result.budget = bud[1];

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

      results.push({ id, ...stats });
      await page.close();
      await ctx.close();
    } catch (e) {
      results.push({ id, error: e.message.split('\n')[0] });
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await stopLP();
}

// ── submit ──

async function cmdSubmit(file) {
  const proposals = JSON.parse(readFileSync(file, 'utf-8'));
  const cookies = await extractCookies();
  await startLP();

  for (const p of proposals) {
    console.error(`[submit] ${p.id}`);
    try {
      const { ctx, page } = await visit(
        `https://www.wishket.com/project/${p.id}/proposal/apply/`, cookies
      );

      if (page.url().includes('auth.wishket.com')) {
        console.error(`  → NOT_LOGGED_IN`);
        await page.close(); await ctx.close();
        continue;
      }

      // 금액/기간/본문
      await page.fill('input[name="budget"]', String(p.amount));
      await page.fill('input[name="term"]', String(p.term));
      await page.fill('textarea[name="body"]', p.body);

      // 포트폴리오 라디오
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
      for (const title of (p.portfolios || [])) {
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
      if (p.desc) {
        const descTa = page.locator('textarea[name="related_description"]');
        if (await descTa.count() > 0) await descTa.fill(p.desc);
      }
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

      console.error(`  → DONE`);
      await page.close();
      await ctx.close();
    } catch (e) {
      console.error(`  → ERROR: ${e.message.split('\n')[0]}`);
    }
  }

  await stopLP();
}

// ── main ──

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help') {
  console.log(`Usage:
  node wishket.mjs list [--pages N]
  node wishket.mjs detail <ID> [ID...]
  node wishket.mjs boost <ID> [ID...]
  node wishket.mjs submit <proposals.json>`);
  process.exit(0);
}

try {
  if (cmd === 'list') await cmdList(args);
  else if (cmd === 'detail') await cmdDetail(args);
  else if (cmd === 'boost') await cmdBoost(args);
  else if (cmd === 'submit') await cmdSubmit(args[0]);
  else { console.error(`Unknown command: ${cmd}`); process.exit(1); }
} catch (e) {
  console.error(`FATAL: ${e.message}`);
  await stopLP();
  process.exit(1);
}
