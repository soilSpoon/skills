// human-behavior.js — Human-like browser automation algorithms v2
//
// REFERENCE COPY — paste into browser_run_code to use.
// Cannot be loaded via require() (sandbox limitation).
// Uses page.waitForTimeout() instead of setTimeout.
//
// v2 improvements:
// - Log-normal typing distribution (passes FCaptcha keystroke biometrics)
// - Digraph timing (common letter pairs typed faster)
// - Key dwell time simulation (hold duration variance)
// - Mouse micro-tremor during idle/hover
// - Idle fidget movements between actions
// - CDP detection countermeasures
// - Hardware fingerprint spoofing (hardwareConcurrency, deviceMemory, platform)
// - Element-scoped scrolling
// - Auto-stealth on navigation hook
// - Improved Korean typing support

async (page) => {
  // ============================================================
  // UTILITY
  // ============================================================
  function gaussianRandom(mean, stddev) {
    let u1, u2;
    do { u1 = Math.random(); } while (u1 === 0);
    u2 = Math.random();
    return mean + Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2) * stddev;
  }

  // Log-normal distribution — matches real keystroke inter-key intervals
  // Real typing data follows log-normal, not Gaussian (FCaptcha checks this)
  function logNormalRandom(median, sigma) {
    const mu = Math.log(median);
    return Math.exp(gaussianRandom(mu, sigma));
  }

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function rnd(min, max) { return min + Math.random() * (max - min); }
  function rndInt(min, max) { return Math.floor(rnd(min, max + 1)); }
  async function sleep(ms) { await page.waitForTimeout(Math.max(1, Math.round(ms))); }

  // Session fatigue: actions gradually slow down
  let actionCount = 0;
  function fatigue() { actionCount++; return 1.0 + Math.min(actionCount / 500, 0.2); }

  // ============================================================
  // MOUSE: Bezier Curve Movement
  // ============================================================
  function bezPt(t, p0, p1, p2, p3) {
    const u = 1 - t;
    return {
      x: u*u*u*p0.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*p3.x,
      y: u*u*u*p0.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*p3.y,
    };
  }

  function bezPath(start, end) {
    const dx = end.x - start.x, dy = end.y - start.y;
    const dist = Math.sqrt(dx*dx + dy*dy);
    const side = Math.random() > 0.5 ? 1 : -1;
    const px = -dy/(dist||1), py = dx/(dist||1);
    const spread = clamp(dist*0.3, 20, 200);
    const cp1 = { x: start.x+dx*rnd(.15,.4)+px*side*rnd(0,spread), y: start.y+dy*rnd(.15,.4)+py*side*rnd(0,spread) };
    const cp2 = { x: start.x+dx*rnd(.6,.85)+px*side*rnd(0,spread*.5), y: start.y+dy*rnd(.6,.85)+py*side*rnd(0,spread*.5) };
    const n = Math.max(Math.ceil(dist/3 + rnd(5,15)), 10);
    const path = [];
    for (let i = 0; i <= n; i++) {
      let t = i/n;
      t = t<.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2;
      const p = bezPt(t, start, cp1, cp2, end);
      const jit = Math.max(0, 1-(i/n)*1.5);
      p.x += gaussianRandom(0, .8*jit);
      p.y += gaussianRandom(0, .8*jit);
      path.push(p);
    }
    return path;
  }

  // Micro-tremor: subtle hand shake while holding mouse still
  // Real humans can't hold a mouse perfectly still — FCaptcha checks for this
  async function microTremor(duration) {
    const pos = page.__mousePos;
    if (!pos) return;
    const steps = Math.floor(duration / 50);
    for (let i = 0; i < steps; i++) {
      const tx = pos.x + gaussianRandom(0, 0.3);
      const ty = pos.y + gaussianRandom(0, 0.3);
      await page.mouse.move(tx, ty);
      await sleep(rnd(30, 70));
    }
    // Return to original position
    await page.mouse.move(pos.x, pos.y);
  }

  async function mouseMove(tX, tY, noOvershoot) {
    const f = fatigue();
    const vp = page.viewportSize() || {width:1280,height:720};
    const cur = page.__mousePos || {x:rnd(vp.width*.3,vp.width*.7),y:rnd(vp.height*.3,vp.height*.7)};
    const path = bezPath(cur, {x:tX,y:tY});
    for (let i = 1; i < path.length; i++) {
      await page.mouse.move(path[i].x, path[i].y);
      const prog = i/path.length;
      let d = prog<.2||prog>.8 ? 8 : 3;
      d = d*f + gaussianRandom(0, 1.5);
      if (d > 1) await sleep(d);
    }
    page.__mousePos = {x:tX,y:tY};
    if (Math.random() < .15 && !noOvershoot) {
      const ovX = tX + gaussianRandom(0, clamp(Math.abs(tX - cur.x)*0.05, 2, 8));
      const ovY = tY + gaussianRandom(0, clamp(Math.abs(tY - cur.y)*0.05, 2, 8));
      await page.mouse.move(ovX, ovY);
      await sleep(rnd(30,80));
      await page.mouse.move(tX, tY);
      page.__mousePos = {x:tX,y:tY};
    }
  }

  // Idle fidget: random small mouse movements between actions
  // Humans unconsciously move the mouse while reading/thinking
  async function fidget() {
    const pos = page.__mousePos;
    if (!pos) return;
    const vp = page.viewportSize() || {width:1280,height:720};
    const moves = rndInt(1, 3);
    for (let i = 0; i < moves; i++) {
      const dx = gaussianRandom(0, 30);
      const dy = gaussianRandom(0, 20);
      const nx = clamp(pos.x + dx, 5, vp.width - 5);
      const ny = clamp(pos.y + dy, 5, vp.height - 5);
      await mouseMove(nx, ny, true);
      await sleep(rnd(100, 400));
    }
  }

  // ============================================================
  // MOUSE: Human-like Click
  // ============================================================
  async function click(sel, opts={}) {
    const f = fatigue();
    const el = typeof sel==='string' ? await page.$(sel) : sel;
    if (!el) throw new Error('Not found: '+sel);
    const box = await el.boundingBox();
    if (!box) throw new Error('No bbox');
    const oX = box.x+box.width*rnd(.3,.7), oY = box.y+box.height*rnd(.35,.65);

    // Double-take: ~8% chance to hesitate near target
    if (Math.random() < .08) {
      await mouseMove(oX+rnd(-40,40), oY+rnd(-30,30), true);
      await sleep(rnd(100,300)*f);
    }
    await mouseMove(oX, oY);

    // Pre-click hover with micro-tremor
    const hoverTime = rnd(50,200)*f;
    if (hoverTime > 80) {
      await microTremor(hoverTime);
    } else {
      await sleep(hoverTime);
    }

    await page.mouse.down({button:opts.button||'left'});
    await sleep(rnd(40,130)); // Dwell: human mousedown-mouseup is ~60-100ms
    await page.mouse.up({button:opts.button||'left'});
    await sleep(rnd(80,250)*f);
  }

  // ============================================================
  // KEYBOARD: Human-like Typing (v2 — log-normal + digraph)
  // ============================================================

  // Common English digraphs and their relative speed multipliers
  // Digraphs typed by alternating hands are faster; same-hand pairs are slower
  const DIGRAPH_SPEED = {
    'th':0.7,'he':0.7,'in':0.75,'er':0.75,'an':0.75,'re':0.7,'on':0.8,
    'en':0.8,'at':0.8,'nd':0.85,'st':0.85,'es':0.85,'or':0.85,'te':0.8,
    'ed':0.9,'is':0.9,'it':0.9,'al':0.9,'ar':0.85,'ou':0.8,'to':0.8,
    // Same-finger pairs are slower
    'de':1.15,'fr':1.1,'gr':1.1,'sw':1.15,'cd':1.2,'nu':1.1,
    'my':1.1,'ki':1.15,'lo':1.15,'ju':1.1,
  };

  const NEARBY = {
    'q':['w','a'],'w':['q','e','s'],'e':['w','r','d'],'r':['e','t','f'],'t':['r','y','g'],
    'y':['t','u','h'],'u':['y','i','j'],'i':['u','o','k'],'o':['i','p','l'],'p':['o','l'],
    'a':['q','w','s'],'s':['a','e','d'],'d':['s','r','f'],'f':['d','t','g'],'g':['f','y','h'],
    'h':['g','u','j'],'j':['h','i','k'],'k':['j','o','l'],'l':['k','p'],
    'z':['a','x'],'x':['z','d','c'],'c':['x','f','v'],'v':['c','g','b'],
    'b':['v','h','n'],'n':['b','j','m'],'m':['n','k'],
    '1':['2','q'],'2':['1','3','w'],'3':['2','4','e'],'4':['3','5','r'],'5':['4','6','t'],
    '6':['5','7','y'],'7':['6','8','u'],'8':['7','9','i'],'9':['8','0','o'],'0':['9','p'],
  };

  // Hand assignment for autocorrelation modeling
  // Keys typed by same hand have higher inter-key intervals (autocorrelation)
  const LEFT_HAND = new Set('qwertasdfgzxcvb12345'.split(''));
  const RIGHT_HAND = new Set('yuiophjklnm67890'.split(''));
  function sameHand(a, b) {
    const al = a.toLowerCase(), bl = b.toLowerCase();
    return (LEFT_HAND.has(al) && LEFT_HAND.has(bl)) || (RIGHT_HAND.has(al) && RIGHT_HAND.has(bl));
  }

  async function type(text, opts={}) {
    const f = fatigue();
    const base = opts.baseDelay || 100;
    const typoRate = clamp(opts.typoRate || .03, 0, .1);
    // Log-normal sigma — controls variance of keystroke timing
    // 0.3 is realistic for average typists; higher = more erratic
    const sigma = opts.sigma || 0.3;
    let prevChar = '';

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      // Typo simulation with adjacent key
      if (Math.random() < typoRate && ch !== ' ' && ch !== '\n') {
        const nb = NEARBY[ch.toLowerCase()];
        if (nb && nb.length) {
          const wrong = nb[rndInt(0, nb.length - 1)];
          await page.keyboard.type(wrong);
          // Notice delay (log-normal — sometimes fast catch, sometimes slow)
          await sleep(logNormalRandom(base * 0.8, 0.4) * f);
          // Reaction + correction
          await sleep(logNormalRandom(350, 0.3) * f);
          // Sometimes panic-delete extra chars (~12%)
          const extra = Math.random() < 0.12 ? rndInt(1, 2) : 0;
          for (let b = 0; b <= extra; b++) {
            await page.keyboard.press('Backspace');
            await sleep(rnd(30, 80));
          }
          if (extra > 0) {
            const replayStart = Math.max(0, i - extra);
            for (let r = replayStart; r < i; r++) {
              await page.keyboard.type(text[r]);
              await sleep(logNormalRandom(base * 0.7, 0.2));
            }
          }
          await sleep(rnd(40, 120));
        }
      }

      // Type the correct character
      await page.keyboard.type(ch);

      // Inter-key interval: log-normal base with contextual modifiers
      let delay = logNormalRandom(base, sigma) * f;

      // Digraph speed adjustment
      if (prevChar) {
        const di = (prevChar + ch).toLowerCase();
        const speedMul = DIGRAPH_SPEED[di];
        if (speedMul) delay *= speedMul;
      }

      // Same-hand penalty (autocorrelation — FCaptcha metric)
      if (prevChar && sameHand(prevChar, ch)) {
        delay *= rnd(1.05, 1.2);
      }

      // Word boundary pause
      if (ch === ' ') delay += rnd(20, 100);

      // Punctuation pause (thinking about next sentence)
      if ('.!?,;:'.includes(ch)) delay += rnd(100, 350);

      // Paragraph break
      if (ch === '\n') delay += rnd(200, 600);

      // Random hesitation (4%)
      if (Math.random() < 0.04) delay += rnd(250, 700);

      // Occasional burst (6% — rapid consecutive keys, common in muscle memory)
      if (Math.random() < 0.06 && i < text.length - 2) {
        const burstLen = rndInt(2, 4);
        const burstEnd = Math.min(i + burstLen, text.length - 1);
        for (let b = i + 1; b <= burstEnd; b++) {
          await page.keyboard.type(text[b]);
          await sleep(logNormalRandom(base * 0.45, 0.15));
        }
        prevChar = text[burstEnd];
        i = burstEnd;
        continue;
      }

      prevChar = ch;
      await sleep(Math.max(15, delay));
    }
  }

  // ============================================================
  // SCROLL: Human-like Scrolling
  // ============================================================
  async function scroll(opts={}) {
    const f = fatigue();
    const dist = opts.distance || rnd(300, 800);
    const sign = (opts.direction || 'down') === 'down' ? 1 : -1;
    // Support element-scoped scrolling
    const target = opts.selector ? await page.$(opts.selector) : null;
    let scrolled = 0;

    while (scrolled < dist) {
      const tp = Math.random() < .4;
      let chunk = tp ? rnd(15, 50) : rnd(60, 150);
      const prog = scrolled / dist;
      if (prog > 0.7) chunk *= (1 - prog) * 2;
      chunk = Math.min(chunk, dist - scrolled);
      scrolled += chunk;

      if (target) {
        // Scroll within a specific element
        await target.evaluate((el, delta) => el.scrollBy(0, delta), chunk * sign);
      } else {
        await page.mouse.wheel(0, chunk * sign);
      }

      await sleep(Math.max(5, (tp ? rnd(8, 25) : rnd(30, 100)) * f));

      // Reading pause mid-scroll (6%)
      if (Math.random() < .06 && scrolled < dist * .8) {
        await sleep(rnd(300, 1200) * f);
        // Micro-tremor while "reading"
        if (Math.random() < 0.3) await microTremor(rnd(200, 500));
      }
    }
    await sleep(rnd(100, 400) * f);
  }

  // ============================================================
  // STEALTH: Anti-Detection Patches (v2 — expanded)
  // ============================================================
  async function stealth() {
    await page.evaluate(() => {
      // --- Core automation flags ---
      Object.defineProperty(navigator, 'webdriver', { get: () => false, configurable: true });

      // --- Chrome object ---
      if (!window.chrome) window.chrome = {};
      if (!window.chrome.runtime) {
        window.chrome.runtime = {
          connect() {},
          sendMessage() {},
          onConnect: { addListener() {}, removeListener() {} },
          onMessage: { addListener() {}, removeListener() {} },
        };
      }
      if (!window.chrome.app) {
        window.chrome.app = {
          isInstalled: false,
          InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
          RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
          getDetails() { return null; },
          getIsInstalled() { return false; },
        };
      }

      // --- Permissions query fix ---
      const oq = window.navigator.permissions?.query;
      if (oq) {
        window.navigator.permissions.query = (p) =>
          p.name === 'notifications'
            ? Promise.resolve({ state: Notification.permission })
            : oq.call(window.navigator.permissions, p);
      }

      // --- Plugins (headless has 0) ---
      Object.defineProperty(navigator, 'plugins', {
        get: () => {
          const p = [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
          ];
          p.length = 3;
          return p;
        },
        configurable: true,
      });

      // --- Languages ---
      Object.defineProperty(navigator, 'languages', {
        get: () => ['ko-KR', 'ko', 'en-US', 'en'],
        configurable: true,
      });

      // --- Hardware fingerprint ---
      // Headless often reports 1-2 cores and low memory — dead giveaway
      Object.defineProperty(navigator, 'hardwareConcurrency', {
        get: () => 8,  // Typical modern machine
        configurable: true,
      });
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,  // 8GB — common value
        configurable: true,
      });
      Object.defineProperty(navigator, 'platform', {
        get: () => 'MacIntel',
        configurable: true,
      });
      Object.defineProperty(navigator, 'maxTouchPoints', {
        get: () => 0,  // Desktop = 0, mobile > 0
        configurable: true,
      });

      // --- Connection info ---
      if (navigator.connection) {
        Object.defineProperty(navigator.connection, 'rtt', { get: () => 50, configurable: true });
        Object.defineProperty(navigator.connection, 'downlink', { get: () => 10, configurable: true });
        Object.defineProperty(navigator.connection, 'effectiveType', { get: () => '4g', configurable: true });
      }

      // --- WebGL vendor/renderer ---
      const gp = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(p) {
        if (p === 37445) return 'Google Inc. (Apple)';
        if (p === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
        return gp.call(this, p);
      };
      // Also patch WebGL2
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const gp2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(p) {
          if (p === 37445) return 'Google Inc. (Apple)';
          if (p === 37446) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
          return gp2.call(this, p);
        };
      }

      // --- Screen dimensions ---
      if (screen.width === 0 || screen.height === 0) {
        Object.defineProperty(screen, 'width', { get: () => 1920, configurable: true });
        Object.defineProperty(screen, 'height', { get: () => 1080, configurable: true });
      }
      // Ensure outer matches inner (headless mismatch is detectable)
      Object.defineProperty(window, 'outerWidth', { get: () => window.innerWidth, configurable: true });
      Object.defineProperty(window, 'outerHeight', { get: () => window.innerHeight + 85, configurable: true }); // 85px chrome UI

      // --- Iframe protection ---
      const origAppend = Element.prototype.appendChild;
      Element.prototype.appendChild = function(child) {
        const r = origAppend.call(this, child);
        if (child.tagName === 'IFRAME' && child.contentWindow) {
          try {
            Object.defineProperty(child.contentWindow.navigator, 'webdriver', { get: () => false, configurable: true });
          } catch(e) {}
        }
        return r;
      };

      // --- CDP artifact cleanup ---
      // Remove cdc_ variables that some CDP implementations inject
      for (const key of Object.keys(window)) {
        if (key.match(/^cdc_|^_cdc_/)) {
          try { delete window[key]; } catch(e) {}
        }
      }
      // Remove Playwright-specific markers
      for (const key of Object.keys(document)) {
        if (key.match(/^__playwright/)) {
          try { delete document[key]; } catch(e) {}
        }
      }

      // --- toString() protection ---
      // Prevent detection of overridden functions via .toString()
      const nativeToStr = Function.prototype.toString;
      const overridden = new WeakSet();
      const origToStr = Function.prototype.toString;
      Function.prototype.toString = function() {
        if (overridden.has(this)) {
          return 'function ' + (this.name || '') + '() { [native code] }';
        }
        return nativeToStr.call(this);
      };
      overridden.add(Function.prototype.toString);
    });
  }

  // ============================================================
  // NAVIGATION: Human-like
  // ============================================================
  async function navigate(url, opts={}) {
    const f = fatigue();
    await page.goto(url, { waitUntil: opts.waitUntil || 'domcontentloaded' });
    await stealth(); // Re-apply stealth after navigation
    await sleep(rnd(500, 1500) * f);

    // Natural post-load: move mouse, maybe scroll
    const vp = page.viewportSize() || { width: 1280, height: 720 };
    await mouseMove(rnd(100, vp.width - 100), rnd(100, 400));
    if (Math.random() < 0.4) {
      await scroll({ direction: 'down', distance: rnd(100, 300) });
      await sleep(rnd(300, 800));
    }
  }

  // ============================================================
  // THINK: Natural pause between actions
  // ============================================================
  async function think(minMs, maxMs) {
    const min = minMs || 300;
    const max = maxMs || 1500;
    const duration = rnd(min, max) * fatigue();
    // Sometimes fidget while thinking
    if (duration > 500 && Math.random() < 0.3) {
      await fidget();
      await sleep(duration * 0.5);
    } else if (duration > 300 && Math.random() < 0.2) {
      await microTremor(duration * 0.4);
      await sleep(duration * 0.6);
    } else {
      await sleep(duration);
    }
  }

  // ============================================================
  // STORE & RETURN
  // ============================================================
  page.__human = {
    mouseMove, click, type, scroll, sleep, stealth, navigate,
    think, fidget, microTremor,
    gaussianRandom, logNormalRandom, fatigue, rnd, rndInt, clamp,
  };
  await stealth();

  // Auto-stealth on future navigations (guard against duplicate listeners)
  if (!page.__humanStealthBound) {
    page.on('load', async () => {
      try { await stealth(); } catch(e) {}
    });
    page.__humanStealthBound = true;
  }

  return 'Human behavior v2 initialized. New: logNormal typing, digraph, tremor, fidget, CDP stealth, hardware fingerprint';
}
