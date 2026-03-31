#!/usr/bin/env node
/**
 * 위시켓 자동화 통합 CLI.
 *
 * 현재 버전은 Playwright 의존 없이 HTTP 기반으로 읽기/제출 작업을 처리한다.
 * - list: 공개 프로젝트 목록
 * - detail: 공개 프로젝트 상세
 * - boost: 로그인 후 apply 페이지에서 data-bot / 지원 힌트 파싱
 *
 * submit은 기본적으로 preview 모드로 동작하며, --confirm이 있을 때만 실제 POST를 전송한다.
 */
import { execFile } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FILTER_URL = 'https://www.wishket.com/project/?d=A4FwvCCGDODWD6AjGBTAJgMgMZjSgbigDYD2wAtigHYgYBmdYA7iohilmmACoBOAriiA';

function usage() {
  console.log(`Usage:
  node wishket.mjs list [--pages N] [--sort default|closing|new|applicants|budget]
  node wishket.mjs detail <ID> [ID...]
  node wishket.mjs boost <ID> [ID...]
  node wishket.mjs evaluation <ID> [ID...]
  node wishket.mjs submit <proposals.json|proposal.md> [more.md ...] [--confirm]`);
}

function getListSortCode(args) {
  const raw = args[args.indexOf('--sort') + 1] || 'default';
  const map = {
    default: 'bs',
    closing: 'cls',
    new: 'new',
    applicants: 'apc',
    budget: 'bgt',
  };
  return map[raw] || map.default;
}

function expandHome(path) {
  if (!path.startsWith('~/')) return path;
  return `${process.env.HOME}/${path.slice(2)}`;
}

function getCookieHeader() {
  if (process.env.WISHKET_COOKIE_HEADER) return process.env.WISHKET_COOKIE_HEADER.trim();
  const fallback = expandHome('~/.wishket-cookie-header');
  if (existsSync(fallback)) return readFileSync(fallback, 'utf8').trim();
  throw new Error('WISHKET_COOKIE_HEADER not set and ~/.wishket-cookie-header not found');
}

async function fetchHtml(url, cookieHeader = '') {
  const args = ['-LsS', '-w', '\n__CURL_EFFECTIVE_URL__=%{url_effective}\n', url];
  if (cookieHeader) args.push('-H', `Cookie: ${cookieHeader}`);
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 20 * 1024 * 1024 });
  const marker = '\n__CURL_EFFECTIVE_URL__=';
  const idx = stdout.lastIndexOf(marker);
  if (idx === -1) return { html: stdout, effectiveUrl: url };
  return {
    html: stdout.slice(0, idx),
    effectiveUrl: stdout.slice(idx + marker.length).trim(),
  };
}

async function postForm(url, cookieHeader, referer, fields) {
  const args = ['-i', '-sS', '-X', 'POST', url,
    '-H', `Cookie: ${cookieHeader}`,
    '-H', 'Origin: https://www.wishket.com',
    '-H', `Referer: ${referer}`,
    '-H', 'X-Requested-With: XMLHttpRequest',
  ];

  for (const [name, value] of Object.entries(fields)) {
    args.push('--data-urlencode', `${name}=${value ?? ''}`);
  }

  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|li|h1|h2|h3|span)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&')
    .replace(/\s+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function toNumber(value) {
  if (!value) return 0;
  const digits = String(value).replace(/[^0-9]/g, '');
  return digits ? Number(digits) : 0;
}

function parseMoneyToWon(value) {
  if (!value) return 0;
  const raw = String(value).trim();
  if (raw.includes('만원')) return toNumber(raw) * 10000;
  return toNumber(raw);
}

function matchOne(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return '';
}

function parseProjectCards(html) {
  const results = [];
  const seen = new Set();
  const regex = /<a[^>]+href="\/project\/(\d+)\/"[^>]*>([\s\S]*?)<\/a>/g;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    if (seen.has(id)) continue;

    const anchorText = stripTags(match[2]).replace(/\s+/g, ' ').trim();
    if (!anchorText || anchorText.length < 8) continue;

    const chunk = html.slice(Math.max(0, match.index - 1200), Math.min(html.length, match.index + 2400));
    const chunkText = stripTags(chunk);

    results.push({
      id,
      title: anchorText,
      budget: toNumber(matchOne(chunkText, [/([0-9,]+)\s*원/, /예상 금액[^0-9]*([0-9,]+)/])),
      durationDays: toNumber(matchOne(chunkText, [/(\d+)\s*일/, /예상 기간[^0-9]*(\d+)/])),
      applicants: toNumber(matchOne(chunkText, [/지원자[^0-9]*(\d+)/, /(\d+)\s*명/])),
    });
    seen.add(id);
  }

  return results;
}

function parseDetail(id, html, effectiveUrl) {
  const text = stripTags(html);
  const title = matchOne(html, [
    /<p class="subtitle-1-medium text900">([^<]+)<\/p>/,
    /<title>([^<]+?) · 위시켓/,
  ]);

  return {
    id,
    url: effectiveUrl,
    title,
    budget: toNumber(matchOne(text, [/예상 금액[^0-9]*([0-9,]+)/, /([0-9,]+)\s*원/])),
    durationDays: toNumber(matchOne(text, [/예상 기간[^0-9]*(\d+)/])),
    applicants: toNumber(matchOne(text, [/지원자[^0-9]*(\d+)/])),
    deadline: matchOne(text, [/모집 마감[^\d]*([\d.]+)/]),
  };
}

function parseBoost(id, html, effectiveUrl) {
  const text = stripTags(html);
  const title = matchOne(html, [
    /<p class="subtitle-1-medium text900">([^<]+)<\/p>/,
    /<title>([^<]+?) · 위시켓/,
  ]);
  const dataBot = matchOne(
    html,
    [/<div class="data-bot-data mb12">([\s\S]*?)<\/div><p class="bot-guide-text/]
  );
  const botText = stripTags(dataBot);

  return {
    id,
    url: effectiveUrl,
    title,
    budget: toNumber(matchOne(text, [/예상 금액[^0-9]*([0-9,]+)/])),
    durationDays: toNumber(matchOne(text, [/예상 기간[^0-9]*(\d+)/])),
    applicants: toNumber(matchOne(text, [/지원자[^0-9]*(\d+)/])),
    minProposalChars: toNumber(matchOne(botText, [/지원 내용이\s*([0-9,]+)자 이상/])),
    minPortfolioCount: toNumber(matchOne(botText, [/포트폴리오 수가\s*([0-9,]+)개 이상/])),
    dataBotSummary: botText,
  };
}

function parseEvaluationOverview(id, html, effectiveUrl) {
  const text = stripTags(html);
  const ajaxPath = matchOne(html, [/url:\s*'([^']*\/review\/[^']+\/filter)'/, /url:\s*"([^"]*\/review\/[^"]+\/filter)"/]);
  const title = matchOne(html, [
    /<title>([^<]+?) · 위시켓/,
    /<p class="back"><a[^>]+>[\s\S]*?'([^']+)' 프로젝트로 돌아가기<\/a>/,
  ]);
  const reviewCounts = [...html.matchAll(/class="display-count">\((\d+)\)<\/span>/g)].map((match) => Number(match[1]));
  const ratingCounts = reviewCounts.length >= 6 ? {
    total: reviewCounts[0],
    highest: reviewCounts[1],
    good: reviewCounts[2],
    normal: reviewCounts[3],
    low: reviewCounts[4],
    worst: reviewCounts[5],
  } : {
    total: 0, highest: 0, good: 0, normal: 0, low: 0, worst: 0,
  };

  return {
    id,
    url: effectiveUrl,
    title,
    ajaxPath,
    ratingCounts,
    hasReviews: ratingCounts.total > 0,
    clientLabel: matchOne(text, [/클라이언트\s+([^\n]+)/]),
  };
}

function parseEvaluationCards(html) {
  const cards = [];
  const regex = /<li[^>]*class="[^"]*review[^"]*"[^>]*>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const chunk = match[1];
    const text = stripTags(chunk);
    const price = toNumber(matchOne(text, [/금액[^0-9]*([0-9,]+)/, /계약 금액[^0-9]*([0-9,]+)/]));
    const durationDays = toNumber(matchOne(text, [/기간[^0-9]*(\d+)/, /(\d+)\s*일/]));
    const score = toNumber(matchOne(chunk, [/data-score="(\d+)"/, /평점[^0-9]*([1-5])/]));
    const partnerLevel = matchOne(text, [/파트너스?\s+(시니어|미드|주니어)/, /(시니어|미드|주니어)\s*파트너/]);
    const keywordSource = matchOne(chunk, [/<div class="review-keyword[^"]*">([\s\S]*?)<\/div>/]);
    const keywords = stripTags(keywordSource)
      .split(/\s{2,}|\n|,/)
      .map((value) => value.trim())
      .filter(Boolean);

    if (text) {
      cards.push({
        partnerLevel,
        score,
        price,
        durationDays,
        keywords,
        summary: text.slice(0, 400),
      });
    }
  }
  return cards;
}

function parseCsrfToken(html) {
  return matchOne(html, [/name="csrfmiddlewaretoken" type="hidden" value="([^"]+)"/]);
}

function parsePortfolioOptions(html) {
  const results = [];
  const regex = /class="portfolio-box"[\s\S]*?data-portfolio="(\d+)"[\s\S]*?<div class="portfolio-title[^"]*">([\s\S]*?)<\/div>/g;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    const title = stripTags(match[2]).replace(/\s+/g, ' ').trim();
    if (title) results.push({ id, title });
  }
  return results;
}

function normalize(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function resolvePortfolios(requestedValues, options) {
  const resolved = [];
  const seen = new Set();
  for (const requested of requestedValues || []) {
    const raw = String(requested || '').trim();
    if (!raw) continue;

    if (/^\d+$/.test(raw)) {
      const direct = options.find((option) => option.id === raw);
      if (direct && !seen.has(direct.id)) {
        seen.add(direct.id);
        resolved.push(direct);
      }
      if (resolved.length === 3) break;
      continue;
    }

    const key = normalize(requested);
    if (!key) continue;
    const match = options.find((option) => {
      const title = normalize(option.title);
      return title.includes(key) || key.includes(title) || title.includes(key.slice(0, 10));
    });
    if (match && !seen.has(match.id)) {
      seen.add(match.id);
      resolved.push(match);
    }
    if (resolved.length === 3) break;
  }
  return resolved;
}

function extractMarkdownSection(markdown, heading) {
  const lines = markdown.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (startIndex === -1) return '';

  const body = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (trimmed === '---' || /^##\s+/.test(trimmed)) break;
    body.push(lines[index]);
  }
  return body.join('\n').trim();
}

function synthesizePortfolioDescription(portfolioIds, reasonMap) {
  const reasons = portfolioIds
    .map((id) => reasonMap.get(String(id)))
    .filter(Boolean);

  if (reasons.length === 0) return '';

  return `관련 포트폴리오에서는 ${reasons.join(' 또한 ')} 경험을 확인하실 수 있습니다. 이번 프로젝트도 화면 구현보다 먼저 운영 흐름과 상태 구조를 안정적으로 정리하고, 이를 실제 사용자 경험으로 연결하는 방식으로 진행할 수 있습니다.`;
}

function parseMarkdownProposal(file) {
  const markdown = readFileSync(file, 'utf8');
  const id = matchOne(markdown, [/\*\*프로젝트 ID:\*\*\s*(\d+)/]);
  const amount = String(parseMoneyToWon(matchOne(markdown, [/\*\*지원 금액:\*\*\s*([^\n]+)/])));
  const term = String(toNumber(matchOne(markdown, [/\*\*지원 기간:\*\*\s*([^\n]+)/])));
  const portfolios = matchOne(markdown, [/\*\*첨부 포트폴리오:\*\*\s*([^\n]+)/])
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const body = extractMarkdownSection(markdown, '지원서 본문');
  const explicitDesc = extractMarkdownSection(markdown, '관련 포트폴리오 설명');
  const reasonSection = matchOne(markdown, [
    /### 포트폴리오 선택 이유\s*\n([\s\S]*?)(?=\n### |\n## |\n?$)/,
  ]);
  const reasonMap = new Map();
  const reasonRegex = /-\s+\*\*(\d+)\*\*:\s*(.+)/g;
  let reasonMatch;
  while ((reasonMatch = reasonRegex.exec(reasonSection)) !== null) {
    reasonMap.set(reasonMatch[1], reasonMatch[2].trim());
  }

  return {
    id,
    amount,
    term,
    body,
    portfolios,
    desc: explicitDesc || synthesizePortfolioDescription(portfolios, reasonMap),
  };
}

function loadProposals(file) {
  if (file.endsWith('.md')) return [parseMarkdownProposal(file)];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [parsed];
}

function loadProposalInputs(files) {
  return files.flatMap((file) => loadProposals(file));
}

function buildPreviewWarnings(preview, boostHints) {
  const minimums = {
    proposalChars: boostHints.minProposalChars || 0,
    portfolioCount: boostHints.minPortfolioCount || 0,
    relatedDescriptionChars: preview.has_related_portfolio === 'True' ? 300 : 0,
  };

  const checks = {
    proposalLengthOk: minimums.proposalChars === 0 || preview.body_length >= minimums.proposalChars,
    portfolioCountOk: minimums.portfolioCount === 0 || preview.resolvedPortfolios.length >= minimums.portfolioCount,
    relatedDescriptionOk: minimums.relatedDescriptionChars === 0 || preview.related_description_length >= minimums.relatedDescriptionChars,
  };

  const warnings = [];
  if (!checks.proposalLengthOk) {
    warnings.push(`proposal body too short: ${preview.body_length} < ${minimums.proposalChars}`);
  }
  if (!checks.portfolioCountOk) {
    warnings.push(`portfolio count too low: ${preview.resolvedPortfolios.length} < ${minimums.portfolioCount}`);
  }
  if (!checks.relatedDescriptionOk) {
    warnings.push(`related description too short: ${preview.related_description_length} < ${minimums.relatedDescriptionChars}`);
  }

  return { minimums, checks, warnings };
}

function buildSubmitFields(proposal, csrfToken, portfolios) {
  const fields = {
    csrfmiddlewaretoken: csrfToken,
    budget: String(proposal.amount ?? ''),
    term: String(proposal.term ?? ''),
    body: proposal.body ?? '',
    ai_proposal_history: '',
  };

  if (portfolios.length > 0 || proposal.desc) {
    fields.has_related_portfolio = 'True';
    fields.relate_tmp = portfolios.map((p) => p.id).join(',');
    fields.relate_portfolio_first = portfolios[0]?.id ?? '';
    fields.relate_portfolio_second = portfolios[1]?.id ?? '';
    fields.relate_portfolio_third = portfolios[2]?.id ?? '';
    fields.related_description = proposal.desc ?? '';
  } else {
    fields.has_related_portfolio = 'False';
    fields.relate_tmp = '';
    fields.relate_portfolio_first = '';
    fields.relate_portfolio_second = '';
    fields.relate_portfolio_third = '';
    fields.related_description = '';
  }

  return fields;
}

async function cmdList(args) {
  const pages = Number(args[args.indexOf('--pages') + 1] || 1);
  const sortCode = getListSortCode(args);
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= pages; page += 1) {
    const query = sortCode === 'bs' ? '' : `&srt=${sortCode}`;
    const url = page === 1 ? `${FILTER_URL}${query}` : `${FILTER_URL}${query}&page=${page}`;
    console.error(`[list] ${url}`);
    const { html } = await fetchHtml(url);
    const items = parseProjectCards(html);
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
    }
    if (items.length === 0) break;
  }

  console.log(JSON.stringify(all, null, 2));
}

async function cmdDetail(ids) {
  const results = [];
  for (const id of ids) {
    console.error(`[detail] ${id}`);
    const { html, effectiveUrl } = await fetchHtml(`https://www.wishket.com/project/${id}/`);
    results.push(parseDetail(id, html, effectiveUrl));
  }
  console.log(JSON.stringify(results, null, 2));
}

async function cmdBoost(ids) {
  const cookieHeader = getCookieHeader();
  const results = [];

  for (const id of ids) {
    console.error(`[boost] ${id}`);
    const { html, effectiveUrl } = await fetchHtml(
      `https://www.wishket.com/project/${id}/proposal/apply/`,
      cookieHeader,
    );

    if (effectiveUrl.includes('auth.wishket.com')) {
      results.push({ id, error: 'NOT_LOGGED_IN', url: effectiveUrl });
      continue;
    }

    results.push(parseBoost(id, html, effectiveUrl));
  }

  console.log(JSON.stringify(results, null, 2));
}

async function cmdEvaluation(ids) {
  const cookieHeader = getCookieHeader();
  const results = [];

  for (const id of ids) {
    console.error(`[evaluation] ${id}`);
    const pageUrl = `https://www.wishket.com/project/project_evaluation/${id}/`;
    const { html, effectiveUrl } = await fetchHtml(pageUrl, cookieHeader);

    if (effectiveUrl.includes('auth.wishket.com')) {
      results.push({ id, error: 'NOT_LOGGED_IN', url: effectiveUrl });
      continue;
    }

    const overview = parseEvaluationOverview(id, html, effectiveUrl);
    let cards = [];
    if (overview.ajaxPath && overview.hasReviews) {
      const ajaxUrl = overview.ajaxPath.startsWith('http')
        ? `${overview.ajaxPath}?filter_str=latest_date&star_count=0&public_post=yes`
        : `https://www.wishket.com${overview.ajaxPath}?filter_str=latest_date&star_count=0&public_post=yes`;
      const { html: cardHtml } = await fetchHtml(ajaxUrl, cookieHeader);
      cards = parseEvaluationCards(cardHtml);
    }

    results.push({
      ...overview,
      cards,
      cardCount: cards.length,
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

async function cmdSubmit(files, options = {}) {
  const proposals = loadProposalInputs(files);
  const cookieHeader = getCookieHeader();

  for (const proposal of proposals) {
    console.error(`[submit] ${proposal.id}`);
    const applyUrl = `https://www.wishket.com/project/${proposal.id}/proposal/apply/`;
    const { html, effectiveUrl } = await fetchHtml(applyUrl, cookieHeader);

    if (effectiveUrl.includes('auth.wishket.com')) {
      console.log(JSON.stringify({ id: proposal.id, error: 'NOT_LOGGED_IN', url: effectiveUrl }, null, 2));
      continue;
    }

    const csrfToken = parseCsrfToken(html);
    const portfolioOptions = parsePortfolioOptions(html);
    const resolvedPortfolios = resolvePortfolios(proposal.portfolios, portfolioOptions);
    const fields = buildSubmitFields(proposal, csrfToken, resolvedPortfolios);
    const boostHints = parseBoost(proposal.id, html, effectiveUrl);

    const preview = {
      id: proposal.id,
      url: applyUrl,
      budget: fields.budget,
      term: fields.term,
      has_related_portfolio: fields.has_related_portfolio,
      resolvedPortfolios,
      related_description_length: fields.related_description.length,
      body_length: fields.body.length,
      mode: options.confirm ? 'confirm' : 'preview',
    };
    const review = buildPreviewWarnings(preview, boostHints);
    const previewWithChecks = {
      ...preview,
      minimums: review.minimums,
      checks: review.checks,
      warnings: review.warnings,
    };

    if (!options.confirm) {
      console.log(JSON.stringify(previewWithChecks, null, 2));
      continue;
    }

    const response = await postForm(applyUrl, cookieHeader, applyUrl, fields);
    const statusLine = response.split('\n', 1)[0].trim();
    const locationMatch = response.match(/\nlocation:\s*(.+)\r?/i);

    console.log(JSON.stringify({
      ...previewWithChecks,
      statusLine,
      location: locationMatch?.[1]?.trim() || '',
      submitted: true,
    }, null, 2));
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help') {
  usage();
  process.exit(0);
}

try {
  if (cmd === 'list') await cmdList(args);
  else if (cmd === 'detail') await cmdDetail(args);
  else if (cmd === 'boost') await cmdBoost(args);
  else if (cmd === 'evaluation') await cmdEvaluation(args);
  else if (cmd === 'submit') await cmdSubmit(args.filter((arg) => arg !== '--confirm'), { confirm: args.includes('--confirm') });
  else {
    console.error(`Unknown command: ${cmd}`);
    process.exit(1);
  }
} catch (error) {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
}
