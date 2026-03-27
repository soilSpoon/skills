---
name: human-like-browser
description: "Human-like browser automation that bypasses bot detection. Wraps Playwright MCP tools to simulate realistic human behavior: Bezier-curve mouse movements with micro-tremor, log-normal typing delays with digraph timing and typos (~600 chars/min), smooth inertia scrolling, CDP artifact cleanup, and comprehensive anti-fingerprinting stealth (hardware, WebGL, plugins, connection). Passes FCaptcha keystroke biometrics. Use this skill whenever the user mentions bot detection, anti-scraping bypass, human-like browsing, stealth automation, Cloudflare bypass, DataDome, PerimeterX, Akamai, scraping protected sites, or needs to interact with websites that detect and block bots. Also trigger when the user says 'act like a human', 'natural browsing', 'avoid detection', 'scrape without getting blocked', 'fill form like a person', or any Playwright/browser task where detection evasion matters. Korean language typing support included."
---

# Human-Like Browser Automation v2

Make Playwright automation indistinguishable from real human browsing. Bypasses bot detection systems (Cloudflare, DataDome, PerimeterX, Akamai, FCaptcha) by simulating realistic behavioral biometrics and browser fingerprints.

## What's New in v2
- **Log-normal typing distribution** — matches real keystroke biometrics (FCaptcha checks this)
- **Digraph timing** — common letter pairs (th, er, in) typed at realistic relative speeds
- **Same-hand autocorrelation** — keys typed by same hand are slower (biometric signal)
- **Mouse micro-tremor** — subtle hand shake during hover/idle (FCaptcha analyzes this)
- **Idle fidget movements** — unconscious mouse drift between actions
- **CDP artifact cleanup** — removes `cdc_` variables and `__playwright` markers
- **Hardware fingerprint spoofing** — `hardwareConcurrency`, `deviceMemory`, `platform`, `maxTouchPoints`
- **WebGL2 patching** — both WebGL and WebGL2 contexts covered
- **`outerWidth/outerHeight`** — matches inner dimensions (headless mismatch is detectable)
- **Element-scoped scrolling** — scroll within specific containers
- **Auto-stealth on navigation** — patches re-applied automatically via `page.on('load')`
- **`think()` function** — natural pauses with optional fidget/tremor
- **`navigate()` function** — goto + stealth + post-load human behavior in one call

## Environment Constraints

`browser_run_code` runs in a sandboxed context:
- **No `require()`** — all code must be inlined
- **No `setTimeout()`** — use `page.waitForTimeout()`
- **`page` object persists** — `page.__human` survives across calls

## Quick Start

### Step 1: Initialize (once per session)

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

FCaptcha biometric signals addressed:
- **Dwell variance**: log-normal distribution provides natural variance
- **Log-normal fit**: directly modeled (Gaussian fails this check)
- **Autocorrelation**: same-hand key pairs have higher intervals
- **Digraph patterns**: common pairs have realistic relative timing
- **Entropy**: variance of delay distribution matches human range

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
Re-applies all anti-detection patches. Auto-called on page load events.

**Patches applied:**
| Category | Property | Spoofed Value |
|----------|----------|---------------|
| Automation | `navigator.webdriver` | false |
| Chrome | `chrome.runtime`, `chrome.app` | present with mock methods |
| Hardware | `hardwareConcurrency` | 8 |
| Hardware | `deviceMemory` | 8 |
| Hardware | `platform` | MacIntel |
| Hardware | `maxTouchPoints` | 0 |
| Network | `connection.rtt` | 50 |
| Network | `connection.downlink` | 10 |
| Network | `connection.effectiveType` | 4g |
| Browser | `plugins` | 3 standard Chrome plugins |
| Browser | `languages` | ko-KR, ko, en-US, en |
| Graphics | WebGL/WebGL2 vendor | Google Inc. (Apple) |
| Graphics | WebGL/WebGL2 renderer | ANGLE Apple M1 |
| Window | `outerWidth/outerHeight` | matches inner + chrome UI |
| Screen | width/height fallback | 1920x1080 |
| CDP | `cdc_*` variables | deleted |
| CDP | `__playwright*` markers | deleted |
| Security | `Function.toString()` | returns `[native code]` for overrides |
| Iframe | child `navigator.webdriver` | false |

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
- **For Korean text**, same API works — typo map covers QWERTY layout used for Korean IME
- **Element scrolling**: use `opts.selector` for scrollable containers like sidebars or chat windows
