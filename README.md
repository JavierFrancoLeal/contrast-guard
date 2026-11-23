# contrast-guard

Zero-dependency **WCAG 2.1 + Perceptual CIELAB $\Delta E$** contrast and anti-camouflage auditor for web apps, Electron desktop shells, CSS multi-stop gradients, and SVG brand medallions.

Extracted from production CI pipelines (where it audited 39 screens and 1,488 DOM elements per commit in headless Chrome via Node.js native WebSocket CDP — no Puppeteer or Playwright required).

## Why Standard Contrast Checkers Miss Production Regressions

1. **Multi-stop `linear-gradient(...)` blind spots:** Most checkers only read `background-color` and ignore `background-image: linear-gradient(...)`. `contrast-guard` composites ancestor `rgba()` layers and tests **every gradient stop**, failing on the worst-case stop.
2. **Perceptual SVG / Medallion Camouflage:** A dark-indigo icon on a navy header can slip past text-only WCAG checks. `contrast-guard` computes **CIE $L^*a^*b^*$ $\Delta E$** (`>= 15` medallion-to-parent separation, `>= 18` SVG stroke/fill vs medallion surface).
3. **Zero-Dependency Headless CDP:** Uses Node.js >=22 built-in `WebSocket` + `fetch` directly against Chrome DevTools Protocol.

## Quick Start

```bash
# Check a single foreground/background pair or CSS linear-gradient
node src/cli.mjs check --fg "#ffffff" --bg "linear-gradient(135deg, #354ed6, #573bd4)"

# Enforce static palette discipline against off-brand hex drift
node src/cli.mjs tokens styles.css --forbid "#090d16,#020617,#fff5f5"

# Audit a live URL or local HTML file in headless Chrome via CDP
node src/cli.mjs audit-url http://127.0.0.1:3000/

# Run full unit + live Chrome CDP test suite
npm test
```

## License

MIT — Javier Franco Leal (Trasunto)
