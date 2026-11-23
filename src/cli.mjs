#!/usr/bin/env node
/**
 * contrast-guard CLI — Zero-dependency WCAG 2.1 + CIELAB Delta-E Auditor
 *
 * Commands:
 *   contrast-guard check --fg "#ffffff" --bg "#4D6BFE" [--large]
 *   contrast-guard check --fg "#ffffff" --bg "linear-gradient(90deg, #354ed6, #573bd4)"
 *   contrast-guard tokens <file> --forbid "#090d16,#020617"
 *   contrast-guard audit-url <http://... | file://...> [--require-chrome]
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditColorPair, auditForbiddenTokens, buildBrowserAuditorScript } from "./core.mjs";

function findChromeBinary() {
  const envBin = String(process.env.CHROME_BIN || "").trim();
  if (envBin && existsSync(envBin)) return envBin;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  return candidates.find((c) => existsSync(c)) || null;
}

async function runCdpAudit(targetUrl) {
  const bin = findChromeBinary();
  if (!bin) {
    throw new Error("No Chrome/Chromium binary found (set CHROME_BIN to override).");
  }
  const userDataDir = mkdtempSync(join(tmpdir(), "contrast-guard-chrome-"));
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1280,840",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
  ];
  if (process.platform === "linux") args.push("--no-sandbox", "--disable-setuid-sandbox");
  args.push("about:blank");

  const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let ws;
  try {
    const wsEndpoint = await new Promise((res, rej) => {
      let stderr = "";
      const timer = setTimeout(() => rej(new Error("Chrome startup timeout")), 20000);
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
        const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (m) {
          clearTimeout(timer);
          res(m[1]);
        }
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        rej(new Error(`Chrome exited (${code}): ${stderr.slice(-300)}`));
      });
    });

    const host = wsEndpoint.match(/^ws:\/\/([^/]+)/)[1];
    const listResp = await fetch(`http://${host}/json/list`);
    const list = await listResp.json();
    const pageTarget = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
    ws = new WebSocket(pageTarget ? pageTarget.webSocketDebuggerUrl : wsEndpoint);
    await new Promise((res, rej) => {
      ws.addEventListener("open", res, { once: true });
      ws.addEventListener("error", rej, { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const waiters = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      } else if (msg.method && waiters.has(msg.method)) {
        for (const fn of waiters.get(msg.method)) fn(msg.params || {});
        waiters.delete(msg.method);
      }
    });
    const send = (method, params = {}) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { res, rej });
        ws.send(JSON.stringify({ id, method, params }));
      });
    const once = (method, ms = 6000) =>
      new Promise((res) => {
        const t = setTimeout(() => res(null), ms);
        const arr = waiters.get(method) || [];
        arr.push((p) => {
          clearTimeout(t);
          res(p);
        });
        waiters.set(method, arr);
      });

    await send("Page.enable");
    await send("Runtime.enable");
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: targetUrl });
    await loaded;
    await new Promise((r) => setTimeout(r, 250));
    const injectRes = await send("Runtime.evaluate", { expression: buildBrowserAuditorScript() });
    if (injectRes.exceptionDetails) {
      throw new Error(`Auditor injection failed: ${injectRes.exceptionDetails.text}`);
    }
    const evalRes = await send("Runtime.evaluate", {
      expression: `window.__contrastGuardAudit(${JSON.stringify(targetUrl)})`,
      returnByValue: true,
    });
    if (evalRes.exceptionDetails) {
      throw new Error(`Auditor execution failed: ${evalRes.exceptionDetails.text}`);
    }
    return evalRes.result.value;
  } finally {
    try { ws?.close(); } catch {}
    try { proc.kill("SIGKILL"); } catch {}
    try { rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
  }
}

function getFlag(args, name) {
  const idx = args.indexOf(name);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === "--help" || cmd === "-h") {
    console.log(`contrast-guard v1.0.0 — Zero-dep WCAG 2.1 + CIELAB Delta-E Auditor
Usage:
  contrast-guard check --fg <color> --bg <color|gradient> [--large]
  contrast-guard tokens <file> --forbid "#hex1,#hex2"
  contrast-guard audit-url <url>`);
    process.exit(0);
  }

  if (cmd === "check") {
    const fg = getFlag(args, "--fg");
    const bg = getFlag(args, "--bg");
    const isLargeText = args.includes("--large");
    if (!fg || !bg) {
      console.error("Error: --fg and --bg are required.");
      process.exit(2);
    }
    const res = auditColorPair({ fg, bg, isLargeText });
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.pass ? 0 : 1);
  }

  if (cmd === "tokens") {
    const file = args[1];
    const forbid = (getFlag(args, "--forbid") || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (!file || !existsSync(file)) {
      console.error(`Error: file not found: ${file}`);
      process.exit(2);
    }
    const res = auditForbiddenTokens(readFileSync(file, "utf8"), forbid);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.pass ? 0 : 1);
  }

  if (cmd === "audit-url") {
    const url = args[1];
    if (!url) {
      console.error("Error: target URL is required.");
      process.exit(2);
    }
    const res = await runCdpAudit(url);
    console.log(JSON.stringify(res, null, 2));
    process.exit(res.failures.length === 0 ? 0 : 1);
  }

  console.error(`Unknown command: ${cmd}`);
  process.exit(2);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
