# Stealth Patches Reference

Patches auto-applied by `h.stealth()` on every page load.

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
