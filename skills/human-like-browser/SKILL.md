---
name: human-like-browser
description: "Human-like browser automation that bypasses bot detection. Wraps Playwright MCP tools to simulate realistic human behavior: Bezier-curve mouse movements with micro-tremor, log-normal typing delays with digraph timing and typos (~600 chars/min), smooth inertia scrolling, CDP artifact cleanup, and comprehensive anti-fingerprinting stealth (hardware, WebGL, plugins, connection). Passes FCaptcha keystroke biometrics. Use this skill whenever the user mentions bot detection, anti-scraping bypass, human-like browsing, stealth automation, Cloudflare bypass, DataDome, PerimeterX, Akamai, scraping protected sites, or needs to interact with websites that detect and block bots. Also trigger when the user says 'act like a human', 'natural browsing', 'avoid detection', 'scrape without getting blocked', 'fill form like a person', or any Playwright/browser task where detection evasion matters. Korean QWERTY layout supported (no IME simulation)."
---

# Human-Like Browser Automation v2

Make Playwright automation indistinguishable from real human browsing. Bypasses bot detection systems (Cloudflare, DataDome, PerimeterX, Akamai, FCaptcha) by simulating realistic behavioral biometrics and browser fingerprints.

## Quick Start

### Step 1: Initialize (once per session)

> **Constraints**: `browser_run_code` runs in a sandbox — no `require()`, no `setTimeout()` (use `page.waitForTimeout()`). The `page` object and `page.__human` persist across calls.

Read `scripts/human-behavior.js` and paste the entire initialization block into `mcp__plugin_playwright_playwright__browser_run_code`. This defines all functions on `page.__human` and applies stealth patches.

### Step 2: Use

```javascript
async (page) => {
  const h = page.__human;

  await h.navigate('https://example.com');       // goto + stealth + human post-load
  await h.think(500, 1500);                       // natural pause with optional fidget
  await h.click('#search-box');                    // Bezier mouse + tremor + click
  await h.type('search query', { baseDelay: 100 }); // log-normal + digraph + typos
  await h.scroll({ direction: 'down', distance: 500 }); // inertia scroll
  await h.fidget();                               // unconscious mouse drift
}
```

## API Reference

### `h.click(selector, opts?)`
Bezier-curve mouse path → hover with micro-tremor → mousedown → variable dwell → mouseup.
- `selector`: CSS selector or ElementHandle
- `opts.button`: 'left' | 'right' | 'middle'
- 8% double-take, 15% overshoot correction, offset within 30-70% of element bounds

### `h.type(text, opts?)`
Log-normal keystroke timing with digraph speed modifiers and same-hand autocorrelation.
- `opts.baseDelay`: median ms between keys (default 100 = ~600 cpm)
- `opts.typoRate`: typo probability per key (default 0.03)
- `opts.sigma`: log-normal sigma, controls variance (default 0.3)

| Style | baseDelay | sigma | typoRate |
|-------|-----------|-------|----------|
| Fast | 70 | 0.25 | 0.02 |
| Average | 100 | 0.30 | 0.03 |
| Slow | 160 | 0.35 | 0.01 |
| Erratic | 120 | 0.50 | 0.05 |

### `h.scroll(opts?)`
- `opts.direction`: 'down' | 'up'
- `opts.distance`: pixels (default random 300-800)
- `opts.selector`: CSS selector for element-scoped scrolling (e.g., `'.sidebar'`)
- Mixed trackpad/mousewheel, inertia deceleration, reading pauses with tremor

### `h.mouseMove(x, y, noOvershoot?)`
Bezier curve with cubic ease-in-out. Micro-jitter decreases toward target. Fitts's Law path density.

### `h.navigate(url, opts?)`
`page.goto()` + auto-stealth + post-load mouse movement + optional orientation scroll.
- `opts.waitUntil`: 'domcontentloaded' (default) | 'load' | 'networkidle'

### `h.think(minMs?, maxMs?)`
Natural pause between actions. 30% chance of fidget, 20% chance of tremor during longer pauses.
- Default: 300-1500ms

### `h.fidget()`
1-3 small random mouse movements near current position. Simulates unconscious hand drift.

### `h.microTremor(durationMs)`
Subtle hand shake — tiny movements (±0.3px) at ~50ms intervals. Applied automatically during hover.

### `h.stealth()`
Re-applies all anti-detection patches. Auto-called on page load events. See `references/stealth-patches.md` for the full list of 28 patches (automation, hardware, WebGL, CDP, etc.).

### Utility Functions
- `h.sleep(ms)` — `page.waitForTimeout()` wrapper
- `h.rnd(min, max)` — random float
- `h.rndInt(min, max)` — random integer
- `h.gaussianRandom(mean, stddev)` — normal distribution
- `h.logNormalRandom(median, sigma)` — log-normal distribution
- `h.fatigue()` — returns fatigue multiplier (auto-applied)
- `h.clamp(val, min, max)` — clamp value

## Complete Example: Protected Site Login

```javascript
async (page) => {
  const h = page.__human;

  // Navigate with auto-stealth
  await h.navigate('https://protected-site.com/login');
  await h.think(800, 2000);  // "Reading the page"

  // Scroll to form
  await h.scroll({ direction: 'down', distance: 200 });
  await h.think();

  // Fill email with natural rhythm
  await h.click('#email');
  await h.think(150, 400);
  await h.type('user@example.com', { baseDelay: 100, typoRate: 0.03 });

  // Move to password
  await h.think(300, 600);
  await h.click('#password');
  await h.think(100, 300);
  await h.type('SecurePass123', { baseDelay: 110, typoRate: 0.02 });

  // Hesitate before submit
  await h.think(500, 1500);
  await h.click('button[type="submit"]');

  return 'Login completed';
}
```

## Tips

- **Always use `think()` between actions** — it adds fidget/tremor naturally
- **Combine with residential proxies** for IP reputation
- **Vary parameters across sessions** — slightly different baseDelay/sigma each time
- **For Korean text**, typo simulation works on the QWERTY layer. Actual Hangul IME composition is not simulated.
- **Selector safety**: If an element may not be loaded yet, use `await page.waitForSelector(sel, {timeout: 5000})` before `h.click(sel)`. The skill does not auto-retry on null selectors.
- **Element scrolling**: use `opts.selector` for scrollable containers like sidebars or chat windows
