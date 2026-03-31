import { chromium } from 'playwright';
import { readFileSync } from 'fs';

const PROPOSALS = [
  { id: '153957', amount: '500000', term: '4', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '학생 건강검진 결과 관리 및 공문서 자동 발행 시스템'], desc: 'HR SaaS 데이터 관리 4년 운영 + 건강검진 데이터 입력→조회 시스템 개발 경험이 안과 근시 데이터 관리와 직결됩니다.' },
  { id: '154097', amount: '4000000', term: '40', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '클라우드 기반 드론 설계 및 시뮬레이션 플랫폼 개발'], desc: 'HR SaaS 레거시 코드 인수→리팩토링 경험과 Next.js SaaS 풀스택 개발 경험이 코드 안정화와 직결됩니다.' },
  { id: '153940', amount: '20000000', term: '100', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '학생 건강검진 결과 관리 및 공문서 자동 발행 시스템'], desc: 'HR SaaS 5단계 권한+관리자 대시보드 4년 운영과 건강검진 데이터 관리+리포트 생성 경험이 환자 건강관리 플랫폼과 직결됩니다.' },
  { id: '154098', amount: '12000000', term: '60', portfolios: ['클라우드 기반 드론 설계 및 시뮬레이션 플랫폼 개발', 'AI를 활용한 식사 메뉴 추천 서비스'], desc: 'AI 챗봇 의도 분류+프롬프트 설계(시뮬레이션)와 AI 추천 알고리즘+태깅 체계(메뉴추천) 경험이 AI 패션 코디 추천과 직결됩니다.' },
  { id: '153961', amount: '12000000', term: '60', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '블록체인 토큰 가격 추이 시각화 서비스'], desc: 'HR SaaS CRUD+관리 시스템 4년 운영과 외부 데이터 수집→DB 적재 파이프라인 구축 경험이 Access DB 마이그레이션+관리 시스템과 직결됩니다.' },
  { id: '153979', amount: '6000000', term: '30', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '제철소 실시간 품질 분석 데스크탑 시스템'], desc: 'HR SaaS 풀스택+결제 연동 경험과 제철소 MES 비즈니스 규칙 엔진 경험이 월세 카드대납 결제+정산과 직결됩니다.' },
  { id: '153894', amount: '4000000', term: '40', portfolios: ['클라우드 기반 드론 설계 및 시뮬레이션 플랫폼 개발', '블록체인 토큰 가격 추이 시각화 서비스'], desc: '124개국 글로벌 서비스 운영(시뮬레이션)과 영/한 다국어 서비스 구축(토큰) 경험이 영문+한국어 기업 홈페이지와 직결됩니다.' },
  { id: '154017', amount: '3000000', term: '30', portfolios: ['근태 및 급여 등 HR 관리를 위한 웹 플랫폼', '학생 건강검진 결과 관리 및 공문서 자동 발행 시스템'], desc: 'HR SaaS 학생/직원 데이터 CRUD+권한 분리 4년 운영과 건강검진 학생별 데이터 관리+리포트 생성 경험이 체육학원 학생 관리와 직결됩니다.' },
];

function extractBody(id) {
  const content = readFileSync(`/Users/dh/dev/portfolio/benchmark/wishket/proposals/${id}.md`, 'utf-8');
  const match = content.match(/## 지원서 본문\n\n([\s\S]*?)\n\n---/);
  return match ? match[1].trim() : '';
}

async function submit(page, p) {
  const body = extractBody(p.id);
  if (!body) { console.log(`[${p.id}] SKIP - no body`); return; }

  console.log(`[${p.id}] Navigating...`);
  await page.goto(`https://www.wishket.com/project/${p.id}/proposal/apply/`, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  if (page.url().includes('auth.wishket.com')) { console.log(`[${p.id}] NOT LOGGED IN`); return; }

  try {
    // BOOST 통계 파싱
    const boost = await page.evaluate(() => {
      const getText = (sel) => document.querySelector(sel)?.textContent?.replace(/[^0-9]/g, '') || '';
      // BOOST 영역의 금액들 파싱
      const allNums = [...document.querySelectorAll('.boost-price, .statistics-price, [class*="price"]')]
        .map(el => parseInt(el.textContent.replace(/[^0-9]/g, '')))
        .filter(n => n > 0);
      // 최저/평균/최고 텍스트 파싱
      const statBoxes = [...document.querySelectorAll('.statistics-box, [class*="stat"]')];
      const stats = {};
      for (const box of statBoxes) {
        const label = box.querySelector('[class*="label"], p:first-child')?.textContent || '';
        const value = parseInt(box.querySelector('[class*="value"], p:last-child')?.textContent?.replace(/[^0-9]/g, '') || '0');
        if (label.includes('최저')) stats.min = value;
        if (label.includes('평균')) stats.avg = value;
        if (label.includes('최고')) stats.max = value;
      }
      return { ...stats, raw: allNums };
    });
    if (boost.min || boost.avg) {
      console.log(`[${p.id}] BOOST: min=${boost.min} avg=${boost.avg} max=${boost.max}`);
      // 금액 자동 조정: 최저 이상 & 일당 10~20만 범위
      const term = parseInt(p.term);
      let amount = parseInt(p.amount);
      if (boost.min && amount < boost.min) {
        const adjusted = Math.min(boost.min, term * 200000); // 일당 20만 상한
        if (adjusted >= term * 100000) { // 일당 10만 하한
          amount = adjusted;
          console.log(`[${p.id}] Adjusted amount: ${p.amount} → ${amount} (BOOST min: ${boost.min})`);
          p.amount = String(amount);
        }
      }
    }

    // 금액
    await page.fill('input[name="budget"]', p.amount);
    await page.press('input[name="budget"]', 'Tab');
    await page.waitForTimeout(300);

    // 기간
    await page.fill('input[name="term"]', p.term);
    await page.press('input[name="term"]', 'Tab');
    await page.waitForTimeout(300);

    // 지원 내용
    const ta = page.locator('textarea[name="body"]');
    if (await ta.count() > 0) await ta.fill(body);
    await page.waitForTimeout(300);

    // 포트폴리오 라디오
    await page.evaluate(() => {
      const l = document.querySelector('label[for="has_related_portfolio"]');
      if (l) l.click();
    });
    await page.waitForTimeout(500);

    // 포트폴리오 모달 열기
    await page.evaluate(() => {
      const b = document.querySelector('.btn-select-related-portfolio');
      if (b) b.click();
    });
    await page.waitForTimeout(1000);

    // 포트폴리오 선택
    for (const title of p.portfolios) {
      const prefix = title.substring(0, 10);
      await page.evaluate((pf) => {
        const boxes = [...document.querySelectorAll('.portfolio-box')];
        const match = boxes.find(b => {
          const t = b.querySelector('.portfolio-title-box');
          return t && t.innerText.includes(pf);
        });
        if (match) match.click();
      }, prefix);
      await page.waitForTimeout(300);
    }

    // 선택 완료
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const c = btns.find(b => b.textContent.includes('선택 완료'));
      if (c) c.click();
    });
    await page.waitForTimeout(500);

    // 포트폴리오 설명
    const desc = page.locator('textarea[name="related_description"]');
    if (await desc.count() > 0) await desc.fill(p.desc);
    await page.waitForTimeout(300);

    // 1차: "프로젝트 지원" 버튼
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const s = btns.find(b => b.textContent.trim() === '프로젝트 지원' && !b.disabled);
      if (s) s.click();
    });
    await page.waitForTimeout(2000);

    // 2차: "제출하기" 확인 버튼
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')];
      const c = btns.find(b => b.textContent.trim() === '제출하기');
      if (c) c.click();
    });
    await page.waitForTimeout(3000);

    console.log(`[${p.id}] DONE`);
  } catch (e) {
    console.log(`[${p.id}] ERROR: ${e.message}`);
  }
}

async function main() {
  // headless for speed. Set to false for debugging.
  const headless = !process.argv.includes('--headful');
  const ctx = await chromium.launchPersistentContext(
    '/Users/dh/Library/Caches/ms-playwright/mcp-chrome-868f91d',
    { headless, channel: 'chrome', viewport: { width: 1280, height: 900 } }
  );
  const page = ctx.pages()[0] || await ctx.newPage();
  page.on('dialog', async d => { try { await d.accept(); } catch {} });

  for (const p of PROPOSALS) {
    await submit(page, p);
    await page.waitForTimeout(1000);
  }
  console.log('\n=== ALL DONE ===');
}

main().catch(e => console.error(e.message));
