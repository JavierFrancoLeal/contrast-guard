import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { Script } from "node:vm";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import {
  parseColor,
  parseGradientStops,
  compositeOver,
  contrastRatio,
  deltaE,
  auditColorPair,
  auditForbiddenTokens,
  buildBrowserAuditorScript,
} from "../src/core.mjs";

test("parseColor handles #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), and clamping", () => {
  assert.deepEqual(parseColor("#fff"), [255, 255, 255, 1]);
  assert.deepEqual(parseColor("#000f"), [0, 0, 0, 1]);
  assert.deepEqual(parseColor("#354ed6"), [53, 78, 214, 1]);
  assert.deepEqual(parseColor("rgba(79, 70, 229, 0.3)"), [79, 70, 229, 0.3]);
  assert.deepEqual(parseColor("rgb(300 23 42 / 50%)"), [255, 23, 42, 0.5]);
  assert.equal(parseColor("not-a-color"), null);
});

test("WCAG 2.1 contrastRatio catches bright indigo #4D6BFE failure vs #354ed6 pass for white text", () => {
  const brightIndigo = auditColorPair({ fg: "#ffffff", bg: "#4D6BFE" });
  assert.equal(brightIndigo.pass, false);
  assert.ok(brightIndigo.worstRatio < 4.5, `Expected < 4.5, got ${brightIndigo.worstRatio}`);

  const deepIndigo = auditColorPair({ fg: "#ffffff", bg: "#354ed6" });
  assert.equal(deepIndigo.pass, true);
  assert.ok(deepIndigo.worstRatio >= 5.5, `Expected >= 5.5, got ${deepIndigo.worstRatio}`);
});

test("auditColorPair evaluates worst-case stop across multi-stop linear-gradient", () => {
  const res = auditColorPair({
    fg: "#ffffff",
    bg: "linear-gradient(135deg, #1e1b4b 0%, #4D6BFE 100%)",
  });
  assert.equal(res.pass, false, "Gradient containing a low-contrast stop must fail");
  assert.deepEqual(res.worstBg, [77, 107, 254]);
  assert.equal(parseGradientStops("linear-gradient(90deg, rgb(53,78,214), rgb(87,59,212))").length, 2);
});

test("compositeOver alpha-blends semi-transparent surfaces accurately", () => {
  const blended = compositeOver([0, 0, 0, 0.5], [255, 255, 255, 1]);
  assert.deepEqual(blended.map(Math.round), [128, 128, 128, 1]);
  assert.ok(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1]) > 20.9);
});

test("CIELAB Delta-E catches perceptual camouflage on brand medallions", () => {
  const camouflaged = deltaE([53, 78, 214], [61, 86, 224]);
  assert.ok(camouflaged < 15, `Camouflaged pair should have Delta-E < 15, got ${camouflaged}`);

  const separated = deltaE([53, 78, 214], [238, 242, 255]);
  assert.ok(separated > 45, `Indigo on pearl should have Delta-E > 45, got ${separated}`);
});

test("auditForbiddenTokens reports exact line numbers and ignores 8-digit hex prefix collisions", () => {
  const css = `body { color: #111827; }\n.bad { background: #090d16; }\n.alpha { background: #090d1680; }\n.ok { color: #354ed6; }\n`;
  const res = auditForbiddenTokens(css, ["#090d16", "#fff5f5"]);
  assert.equal(res.pass, false);
  assert.equal(res.hits.length, 1);
  assert.equal(res.hits[0].line, 2);
  assert.equal(res.hits[0].token, "#090d16");
});

test("auditColorPair composites semi-transparent RGBA background over backdrop", () => {
  // Semi-transparent dark bg over white backdrop lowers contrast for white text
  const semi = auditColorPair({ fg: "#ffffff", bg: "rgba(0, 0, 0, 0.3)", backdrop: "#ffffff" });
  assert.equal(semi.pass, false);
  assert.ok(semi.worstRatio < 2.5, `Expected < 2.5, got ${semi.worstRatio}`);
});

test("CLI end-to-end check and live headless Chrome CDP audit-url (skips gracefully if Chrome absent)", (t) => {
  const cli = join(process.cwd(), "src", "cli.mjs");
  const out = execFileSync(process.execPath, [cli, "check", "--fg", "#ffffff", "--bg", "#354ed6"], {
    encoding: "utf8",
  });
  assert.equal(JSON.parse(out).pass, true);

  // Verify browser auditor script actually parses as valid JavaScript via node:vm
  new Script(buildBrowserAuditorScript());

  const chromeBins = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  if (!chromeBins.some((b) => existsSync(b))) {
    t.skip("No Chrome/Chromium binary installed in this environment");
    return;
  }

  // Run live CDP audit on a temporary HTML fixture (dark header with pearl medallion + accessible button)
  const tmp = mkdtempSync(join(tmpdir(), "cg-fixture-"));
  try {
    const htmlPath = join(tmp, "fixture.html");
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body style="background:#0b1220;padding:16px">
        <button style="background:#354ed6;color:#ffffff;padding:8px 14px">Accessible Button</button>
        <div class="brand-mark" style="background:#eef2ff;width:48px;height:48px;display:inline-block">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#354ed6"/></svg>
        </div>
      </body></html>`
    );
    const url = pathToFileURL(htmlPath).href;
    const cdpOut = execFileSync(process.execPath, [cli, "audit-url", url], { encoding: "utf8" });
    const parsed = JSON.parse(cdpOut);
    assert.equal(parsed.failures.length, 0);
    assert.ok(parsed.checkedCount >= 2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
