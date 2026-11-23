/**
 * contrast-guard — Core WCAG 2.1 + Perceptual CIELAB Delta-E Engine
 * =================================================================
 * Zero external dependencies. Works identically in Node.js (static palette/token checks
 * and unit tests) and injected into any browser / headless Chrome CDP target to audit
 * live composited RGBA layers, multi-stop CSS linear-gradients, <select> options, and
 * SVG/medallion perceptual camouflage (CIELAB Delta-E).
 */

/**
 * Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(...)`, or `rgba(...)` into `[r, g, b, a]`.
 * @param {string} str
 * @returns {[number, number, number, number] | null}
 */
export function parseColor(str) {
  if (!str || typeof str !== "string") return null;
  const s = str.trim();

  // Hex formats: #rgb, #rgba, #rrggbb, #rrggbbaa
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (!/^[0-9a-f]+$/i.test(hex)) return null;
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        1,
      ];
    }
    if (hex.length === 4) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
        parseInt(hex[3] + hex[3], 16) / 255,
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        1,
      ];
    }
    if (hex.length === 8) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
        parseInt(hex.slice(6, 8), 16) / 255,
      ];
    }
    return null;
  }

  // rgb() / rgba() (comma or space-slash syntax, clamped 0..255)
  const m = s.match(
    /^rgba?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)(?:[,/\s]+(\d+(?:\.\d+)?%?))?\s*\)$/i
  );
  if (!m) return null;
  let alpha = 1;
  if (m[4] !== undefined) {
    alpha = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : Number(m[4]);
  }
  const clamp255 = (n) => Math.max(0, Math.min(255, Number(n)));
  return [clamp255(m[1]), clamp255(m[2]), clamp255(m[3]), Math.max(0, Math.min(1, alpha))];
}

/**
 * Extract all rgb()/rgba()/#hex stops from a CSS background-image gradient string.
 * @param {string} bgImg
 * @returns {Array<[number, number, number, number]>}
 */
export function parseGradientStops(bgImg) {
  if (!bgImg || bgImg === "none" || !bgImg.includes("gradient")) return [];
  const stops = [];
  const re =
    /rgba?\(\s*\d+(?:\.\d+)?[,\s]+\d+(?:\.\d+)?[,\s]+\d+(?:\.\d+)?(?:[,/\s]+\d+(?:\.\d+)?%?)?\s*\)|#[0-9a-f]{3,8}\b/gi;
  let m;
  while ((m = re.exec(bgImg)) !== null) {
    const c = parseColor(m[0]);
    if (c) stops.push(c);
  }
  return stops;
}

/**
 * Alpha-composite foreground RGBA over opaque background RGB (`fg` over `bg`).
 * @param {[number, number, number, number]} fg
 * @param {[number, number, number, number]} bg
 * @returns {[number, number, number, number]}
 */
export function compositeOver(fg, bg) {
  const a = fg[3];
  const inv = 1 - a;
  return [fg[0] * a + bg[0] * inv, fg[1] * a + bg[1] * inv, fg[2] * a + bg[2] * inv, 1];
}

/**
 * Convert an 8-bit sRGB channel (0..255) to linear light (IEC 61966-2-1 / WCAG 2.1).
 */
export function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * WCAG 2.1 relative luminance.
 */
export function relativeLuminance(rgb) {
  return (
    0.2126 * srgbToLinear(rgb[0]) +
    0.7152 * srgbToLinear(rgb[1]) +
    0.0722 * srgbToLinear(rgb[2])
  );
}

/**
 * WCAG 2.1 contrast ratio between two RGB/RGBA colors.
 * Semi-transparent backgrounds are composited over `backdrop` (default opaque white `[255,255,255,1]`).
 */
export function contrastRatio(fg, bg, backdrop = [255, 255, 255, 1]) {
  const effBg = bg[3] !== undefined && bg[3] < 1 ? compositeOver(bg, backdrop) : bg;
  const effFg = fg[3] !== undefined && fg[3] < 1 ? compositeOver(fg, effBg) : fg;
  const l1 = relativeLuminance(effFg);
  const l2 = relativeLuminance(effBg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * Convert sRGB `[r, g, b]` to CIE L*a*b* (D65 illuminant, 2-degree observer).
 */
export function rgbToLab(rgb) {
  const r = srgbToLinear(rgb[0]);
  const g = srgbToLinear(rgb[1]);
  const b = srgbToLinear(rgb[2]);
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = f(x);
  y = f(y);
  z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/**
 * Perceptual color distance CIELAB Delta-E (CIE76).
 * Useful for detecting SVG/icon/medallion camouflage where luminance ratios alone fail.
 */
export function deltaE(rgb1, rgb2) {
  const a = rgbToLab(rgb1);
  const b = rgbToLab(rgb2);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Audit a static foreground/background pair (including CSS gradient & semi-transparent RGBA backgrounds).
 */
export function auditColorPair({
  fg,
  bg,
  backdrop = "#ffffff",
  isLargeText = false,
  minNormal = 4.5,
  minLarge = 3.0,
}) {
  const fgRgba = typeof fg === "string" ? parseColor(fg) : fg;
  if (!fgRgba) throw new Error(`Invalid foreground color: ${fg}`);
  const backdropRgba = typeof backdrop === "string" ? parseColor(backdrop) : backdrop;
  if (!backdropRgba) throw new Error(`Invalid backdrop color: ${backdrop}`);

  let bgCandidates = [];
  if (typeof bg === "string" && bg.includes("gradient")) {
    bgCandidates = parseGradientStops(bg);
  } else {
    const parsed = typeof bg === "string" ? parseColor(bg) : bg;
    if (parsed) bgCandidates = [parsed];
  }
  if (!bgCandidates.length) throw new Error(`Invalid background color/gradient: ${bg}`);

  const required = isLargeText ? minLarge : minNormal;
  let worstRatio = Infinity;
  let worstBg = bgCandidates[0];
  let worstDeltaE = Infinity;

  for (const rawCand of bgCandidates) {
    const effBg = rawCand[3] !== undefined && rawCand[3] < 1 ? compositeOver(rawCand, backdropRgba) : rawCand;
    const effFg = fgRgba[3] < 1 ? compositeOver(fgRgba, effBg) : fgRgba;
    const ratio = contrastRatio(effFg, effBg);
    const de = deltaE(effFg, effBg);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      worstBg = effBg;
    }
    if (de < worstDeltaE) worstDeltaE = de;
  }

  return {
    pass: worstRatio >= required,
    worstRatio: Number(worstRatio.toFixed(2)),
    requiredRatio: required,
    worstDeltaE: Number(worstDeltaE.toFixed(1)),
    worstBg: worstBg.slice(0, 3).map((x) => Math.round(x)),
  };
}

/**
 * Scan source text against a list of forbidden off-brand hex tokens (with hex-boundary guard).
 */
export function auditForbiddenTokens(sourceText, forbiddenHexList = []) {
  const hits = [];
  for (const token of forbiddenHexList) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(`${escaped}(?![0-9a-f])`, "gi");
    let m;
    while ((m = rx.exec(sourceText)) !== null) {
      const line = sourceText.slice(0, m.index).split("\n").length;
      hits.push({ token: m[0], line });
    }
  }
  return { pass: hits.length === 0, hits };
}

/**
 * Generate a self-contained browser-side DOM auditor function string suitable for
 * injection via Chrome DevTools Protocol (`Runtime.evaluate`).
 */
export function buildBrowserAuditorScript(options = {}) {
  const medallionSelector =
    options.medallionSelector || ".brand-mark, .lang-medallion, .splash-medallion, .welcome-medallion, [data-contrast-medallion]";
  const minNormal = Number(options.minNormal ?? 4.5);
  const minLarge = Number(options.minLarge ?? 3.0);
  const minMedallionDeltaE = Number(options.minMedallionDeltaE ?? 15);
  const minSvgDeltaE = Number(options.minSvgDeltaE ?? 18);

  return `
window.__contrastGuardAudit = function(screenLabel) {
  function parseRgba(str) {
    if (!str) return null;
    const m = str.match(/rgba?\\(\\s*(\\d+(?:\\.\\d+)?)[,\\s]+(\\d+(?:\\.\\d+)?)[,\\s]+(\\d+(?:\\.\\d+)?)(?:[,\\/\\s]+(\\d+(?:\\.\\d+)?))?\\s*\\)/i);
    if (!m) return null;
    return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  }
  function parseGradientStops(bgImg) {
    if (!bgImg || bgImg === "none" || !bgImg.includes("gradient")) return [];
    const stops = [];
    const re = /rgba?\\(\\s*\\d+(?:\\.\\d+)?[,\\s]+\\d+(?:\\.\\d+)?[,\\s]+\\d+(?:\\.\\d+)?(?:[,\\/\\s]+\\d+(?:\\.\\d+)?)?\\s*\\)/gi;
    let m;
    while ((m = re.exec(bgImg)) !== null) {
      const c = parseRgba(m[0]);
      if (c) stops.push(c);
    }
    return stops;
  }
  function over(fg, bg) {
    const a = fg[3], inv = 1 - a;
    return [fg[0] * a + bg[0] * inv, fg[1] * a + bg[1] * inv, fg[2] * a + bg[2] * inv, 1];
  }
  function srgbToLin(c) {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  }
  function relLum(rgb) {
    return 0.2126 * srgbToLin(rgb[0]) + 0.7152 * srgbToLin(rgb[1]) + 0.0722 * srgbToLin(rgb[2]);
  }
  function contrastRatio(fg, bg) {
    const l1 = relLum(fg), l2 = relLum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  function rgbToLab(rgb) {
    const r = srgbToLin(rgb[0]), g = srgbToLin(rgb[1]), b = srgbToLin(rgb[2]);
    let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
    let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000;
    let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
    const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    x = f(x); y = f(y); z = f(z);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
  }
  function deltaE(rgb1, rgb2) {
    const a = rgbToLab(rgb1), b = rgbToLab(rgb2);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  }
  function isEffectivelyVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    let cur = el;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) <= 0.04) return false;
      cur = cur.parentElement;
    }
    return true;
  }
  function compositeBackgroundCandidates(el) {
    const chain = [];
    let cur = el;
    while (cur && cur.nodeType === 1) { chain.unshift(cur); cur = cur.parentElement; }
    let candidates = [[255, 255, 255, 1]];
    for (const node of chain) {
      const cs = getComputedStyle(node);
      const stops = parseGradientStops(cs.backgroundImage);
      const bg = parseRgba(cs.backgroundColor);
      if (stops.length) {
        const next = [];
        for (const base of candidates) for (const st of stops) next.push(over(st, base));
        candidates = next.slice(0, 6);
      }
      if (bg && bg[3] > 0.01) candidates = candidates.map((base) => over(bg, base));
    }
    return candidates;
  }
  function hasOwnText(el) {
    for (const n of el.childNodes) if (n.nodeType === 3 && n.nodeValue && n.nodeValue.trim().length > 0) return true;
    return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT";
  }

  const failures = [];
  let checkedCount = 0;

  for (const el of document.querySelectorAll("body *")) {
    const tag = el.tagName;
    if (["SCRIPT","STYLE","NOSCRIPT","OPTION","SVG","PATH","RECT","CIRCLE","LINE","POLYGON"].includes(tag)) continue;
    if (!hasOwnText(el) || el.disabled || el.getAttribute("aria-disabled") === "true" || !isEffectivelyVisible(el)) continue;

    const cs = getComputedStyle(el);
    const fg = parseRgba(cs.color);
    if (!fg || fg[3] === 0) continue;

    const fontSize = parseFloat(cs.fontSize || "14");
    const fontWeight = parseInt(cs.fontWeight || "400", 10) || 400;
    const isLarge = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700);
    const minRatio = isLarge ? ${minLarge} : ${minNormal};

    const bgs = compositeBackgroundCandidates(el);
    let worstRatio = Infinity, worstBg = bgs[0];
    for (const bg of bgs) {
      const effFg = fg[3] < 1 ? over(fg, bg) : fg;
      const ratio = contrastRatio(effFg, bg);
      if (ratio < worstRatio) { worstRatio = ratio; worstBg = bg; }
    }
    checkedCount++;
    if (worstRatio < minRatio) {
      failures.push({
        screen: screenLabel, kind: "text",
        selector: tag.toLowerCase() + (el.id ? "#" + el.id : ""),
        text: (el.value || el.textContent || "").trim().slice(0, 48),
        ratio: Number(worstRatio.toFixed(2)), required: minRatio,
        fg: fg.slice(0, 3).map(Math.round), bg: worstBg.slice(0, 3).map(Math.round),
      });
    }
  }

  for (const med of document.querySelectorAll(${JSON.stringify(medallionSelector)})) {
    if (!isEffectivelyVisible(med)) continue;
    const medBgs = compositeBackgroundCandidates(med);
    const parentBgs = med.parentElement ? compositeBackgroundCandidates(med.parentElement) : medBgs;
    const sepDelta = deltaE(medBgs[0], parentBgs[0]);
    checkedCount++;
    if (sepDelta < ${minMedallionDeltaE}) {
      failures.push({
        screen: screenLabel, kind: "medallion-separation",
        selector: "." + String(med.className).trim().split(/\\s+/).join("."),
        deltaE: Number(sepDelta.toFixed(1)), requiredDeltaE: ${minMedallionDeltaE},
      });
    }
    for (const node of med.querySelectorAll("svg stop, svg path, svg rect, svg circle, svg polygon")) {
      const cs = getComputedStyle(node);
      const col = node.tagName.toLowerCase() === "stop"
        ? parseRgba(cs.stopColor || node.getAttribute("stop-color"))
        : (cs.stroke && cs.stroke !== "none" ? parseRgba(cs.stroke) : parseRgba(cs.fill));
      if (!col || col[3] < 0.2) continue;
      const de = deltaE(col, medBgs[0]);
      if (de < ${minSvgDeltaE}) {
        failures.push({
          screen: screenLabel, kind: "svg-camouflage",
          selector: "." + String(med.className).trim().split(/\\s+/).join(".") + " svg " + node.tagName.toLowerCase(),
          deltaE: Number(de.toFixed(1)), requiredDeltaE: ${minSvgDeltaE},
        });
      }
    }
  }

  return { screen: screenLabel, checkedCount, failures };
};
`;
}
