#!/usr/bin/env node
/**
 * 채용공고 파서 CLI — API-first, HTTP 기반.
 *
 * 지원 플랫폼:
 *   - wanted: 원티드 공개 API (v4)
 *
 * Usage:
 *   node job-parser.mjs wanted <ID>          # 원티드 공고 상세
 *   node job-parser.mjs url <URL>            # URL 자동 감지 + 파싱
 *   node job-parser.mjs search <platform> <keyword> [--limit N]
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function fetchJson(url, headers = {}) {
  const args = ['-LsS', url, '-H', 'Accept: application/json'];
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `${k}: ${v}`);
  }
  const { stdout } = await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
  return JSON.parse(stdout);
}

// ---------------------------------------------------------------------------
// URL detection
// ---------------------------------------------------------------------------

const PLATFORM_PATTERNS = [
  { platform: 'wanted', pattern: /wanted\.co\.kr\/wd\/(\d+)/, extract: (m) => m[1] },
  { platform: 'wanted', pattern: /wanted\.co\.kr\/api\/v4\/jobs\/(\d+)/, extract: (m) => m[1] },
];

function detectPlatform(url) {
  for (const { platform, pattern, extract } of PLATFORM_PATTERNS) {
    const m = url.match(pattern);
    if (m) return { platform, id: extract(m) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Wanted
// ---------------------------------------------------------------------------

const WANTED_API = 'https://www.wanted.co.kr/api/v4';

function formatWantedJob(data) {
  const job = data.job;
  const d = job.detail || {};
  const c = job.company || {};
  const addr = job.address || {};
  const tags = (job.company_tags || []).map((t) => t.title);
  const skills = (job.skill_tags || []).map((t) => t.title || t);
  const categories = (job.category_tags || []).map((t) => `${t.parent_id}/${t.id}`);

  return {
    platform: 'wanted',
    id: job.id,
    position: job.position,
    status: job.status,
    company: {
      id: c.id,
      name: c.name,
      industry: c.industry_name,
      responseRate: c.application_response_stats?.avg_rate,
      responseLevel: c.application_response_stats?.level,
    },
    location: addr.full_location || addr.location,
    country: addr.country,
    annualFrom: job.annual_from,
    annualTo: job.annual_to,
    dueTime: job.due_time,
    likeCount: job.like_count,
    detail: {
      intro: d.intro || '',
      mainTasks: d.main_tasks || '',
      requirements: d.requirements || '',
      preferredPoints: d.preferred_points || '',
      benefits: d.benefits || '',
    },
    skills,
    companyTags: tags,
    categories,
    reward: job.reward,
    logoImg: job.logo_img?.origin,
  };
}

async function wantedDetail(id) {
  const data = await fetchJson(`${WANTED_API}/jobs/${id}`);
  if (!data.job) {
    throw new Error(`Wanted job ${id} not found`);
  }
  return formatWantedJob(data);
}

async function wantedSearch(keyword, limit = 10) {
  const encoded = encodeURIComponent(keyword);
  const data = await fetchJson(
    `${WANTED_API}/jobs?query=${encoded}&limit=${limit}&offset=0&country=kr`
  );
  const jobs = data.data || data.jobs || [];
  return jobs.map((job) => ({
    platform: 'wanted',
    id: job.id,
    position: job.position,
    company: job.company?.name || '',
    location: job.address?.full_location || '',
    annualFrom: job.annual_from,
    annualTo: job.annual_to,
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  console.log(`Usage:
  node job-parser.mjs wanted <ID> [ID...]     # 원티드 공고 상세
  node job-parser.mjs url <URL>               # URL 자동 감지 + 파싱
  node job-parser.mjs search wanted <keyword> [--limit N]`);
}

async function cmdDetail(platform, ids) {
  const fetchers = { wanted: wantedDetail };
  const fn = fetchers[platform];
  if (!fn) {
    console.error(`Unsupported platform: ${platform}`);
    process.exit(1);
  }
  if (ids.length === 1) {
    console.log(JSON.stringify(await fn(ids[0]), null, 2));
  } else {
    const results = [];
    for (const id of ids) results.push(await fn(id));
    console.log(JSON.stringify(results, null, 2));
  }
}

async function cmdUrl(url) {
  const detected = detectPlatform(url);
  if (!detected) {
    console.error(`Cannot detect platform from URL: ${url}`);
    console.error('Supported: wanted.co.kr/wd/{id}');
    process.exit(1);
  }
  await cmdDetail(detected.platform, [detected.id]);
}

async function cmdSearch(platform, keyword, args) {
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx !== -1 ? Number(args[limitIdx + 1]) || 10 : 10;

  const searchers = { wanted: wantedSearch };
  const fn = searchers[platform];
  if (!fn) {
    console.error(`Unsupported platform for search: ${platform}`);
    process.exit(1);
  }
  const results = await fn(keyword, limit);
  console.log(JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const [cmd, ...args] = process.argv.slice(2);

if (!cmd || cmd === 'help') {
  usage();
  process.exit(0);
}

try {
  if (cmd === 'url') {
    await cmdUrl(args[0]);
  } else if (cmd === 'search') {
    const [platform, ...rest] = args;
    const keyword = rest.filter((a) => !a.startsWith('--'))[0];
    await cmdSearch(platform, keyword, rest);
  } else {
    // cmd = platform name (e.g., 'wanted')
    await cmdDetail(cmd, args);
  }
} catch (error) {
  console.error(`FATAL: ${error.message}`);
  process.exit(1);
}
