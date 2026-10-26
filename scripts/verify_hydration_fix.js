/**
 * Hydration fix verification for Paper2Bench (Grammarly-extension simulation).
 *
 * Test 1 (proof of fix):  inject Grammarly's exact attributes into <body> BEFORE
 *                         React hydrates -> expect ZERO hydration errors.
 * Test 2 (harness control): inject an extra attribute into a body CHILD element
 *                         (not covered by suppressHydrationWarning) -> expect the
 *                         harness to still catch hydration mismatches.
 */
const path = "/home/z/.npm-global/lib/node_modules/playwright";
const { chromium } = require(path);

const GR_INIT = `
  new MutationObserver(() => {
    const b = document.body;
    if (b && !b.hasAttribute('data-new-gr-c-s-check-loaded')) {
      b.setAttribute('data-new-gr-c-s-check-loaded', '14.1341.0');
      b.setAttribute('data-gr-ext-installed', '');
    }
  }).observe(document, { childList: true, subtree: true });
`;

const CONTROL_INIT = `
  new MutationObserver(() => {
    const b = document.body;
    if (b && b.firstElementChild && !b.firstElementChild.hasAttribute('data-injected-control')) {
      b.firstElementChild.setAttribute('data-injected-control', '1');
    }
  }).observe(document, { childList: true, subtree: true });
`;

async function runScenario(name, initScript) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addInitScript(initScript);
  const page = await context.newPage();

  const hydrationErrors = [];
  page.on("console", (msg) => {
    const t = msg.text();
    const type = msg.type();
    if (
      (type === "error" || type === "warning") &&
      /hydrat|did not match|server rendered|Mismatch/i.test(t)
    ) {
      hydrationErrors.push(t.slice(0, 300));
    }
  });
  page.on("pageerror", (err) => {
    if (/hydrat|did not match/i.test(err.message)) {
      hydrationErrors.push("PAGEERROR: " + err.message.slice(0, 300));
    }
  });

  const target = process.argv[2] || "http://localhost:3000/";
  await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(2500);

  const bodyAttrs = await page.evaluate(() => {
    const b = document.body;
    return {
      gr: b.getAttribute("data-new-gr-c-s-check-loaded"),
      ext: b.getAttribute("data-gr-ext-installed"),
      childInjected: b.firstElementChild ? b.firstElementChild.getAttribute("data-injected-control") : null,
    };
  });
  // app actually interactive?
  const interactive = await page.evaluate(() => !!document.querySelector("button, a, input"));

  await browser.close();
  return { name, hydrationErrors, bodyAttrs, interactive };
}

(async () => {
  let failed = false;

  const t1 = await runScenario("Test 1: Grammarly attributes on <body> (the fix)", GR_INIT);
  console.log("[" + t1.name + "]");
  console.log("  body attrs injected:", JSON.stringify(t1.bodyAttrs));
  console.log("  app interactive:", t1.interactive);
  console.log("  hydration errors:", t1.hydrationErrors.length === 0 ? "NONE ✓" : t1.hydrationErrors);
  if (t1.hydrationErrors.length !== 0 || !t1.interactive) failed = true;

  const t2 = await runScenario("Test 2: control mismatch on body child (harness sanity)", CONTROL_INIT);
  console.log("[" + t2.name + "]");
  console.log("  child attr injected:", JSON.stringify(t2.bodyAttrs.childInjected));
  console.log("  hydration errors detected:", t2.hydrationErrors.length > 0 ? "YES (harness works) ✓" : "none (harness may be blind) ⚠");
  // NOTE: if the control test shows NO error, the harness is weak — but React 19 in dev
  // logs attribute mismatches on non-suppressed elements, so we expect detection.

  console.log(failed || t1.hydrationErrors.length !== 0 ? "\nRESULT: FAIL" : "\nRESULT: PASS — Grammarly hydration error is fixed");
  process.exit(failed ? 1 : 0);
})();
