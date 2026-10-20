// Legibility guard (RFC 0008, decision 9): engine vocabulary must not reach the
// words a person reads or hears. The browser lanes collect every rendered text
// run and accessible name on a surface, and this module decides which of them
// leak an internal identifier.
//
// Two regions are exempt and say so in the DOM: `data-legibility="technical"`
// marks host/admin technical drawers, and `data-legibility="author-content"`
// marks text a person wrote (post bodies), which may legitimately contain
// anything. The nearest marker wins, so a system-rendered element inside
// authored text (a mention chip, `data-legibility="rendered"`) is checked
// again.

export const LEGIBILITY_MODE = "enforce";

export const LEGIBILITY_EXEMPT_REGIONS = Object.freeze(["technical", "author-content"]);

const PLAYER_SURFACES = new Set(["player", "player-private", "board"]);

export const LEGIBILITY_RULES = Object.freeze([
  Object.freeze({
    id: "seat-id",
    pattern: /\bslot[-_]\d+\b/giu,
    surfaces: null,
  }),
  Object.freeze({
    id: "uuid",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu,
    surfaces: null,
  }),
  Object.freeze({
    id: "capability-kind",
    pattern:
      /\b(?:HostOf|CohostOf|SlotOccupant|PendingReplacement|SpectatorOf|DeadViewer|ChannelMember|GlobalAdmin|GlobalMod)\b/gu,
    surfaces: null,
  }),
  Object.freeze({
    id: "snake-case",
    pattern: /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gu,
    surfaces: null,
  }),
  Object.freeze({
    id: "transport-jargon",
    pattern: /\b(?:command ID|command identity|command receipts?|receipts?|principals?|projections?)\b/giu,
    surfaces: PLAYER_SURFACES,
  }),
]);

/**
 * Runs in the page (passed to `page.evaluate`). Returns one sample per text
 * run or accessible-name attribute outside the exempt regions, labelled with
 * the nearest `data-testid` so a report points at a component.
 */
export function collectLegibilitySamples(exemptRegions) {
  const exempted = (element) =>
    exemptRegions.includes(element?.closest("[data-legibility]")?.getAttribute("data-legibility"));
  const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
  const samples = [];
  const seen = new Set();
  const where = (element) =>
    element?.closest("[data-testid]")?.getAttribute("data-testid") ?? element?.tagName?.toLowerCase() ?? "document";
  const push = (text, element, source) => {
    const value = String(text ?? "").replace(/\s+/gu, " ").trim();
    if (value === "") return;
    const key = `${source}\u0000${where(element)}\u0000${value}`;
    if (seen.has(key)) return;
    seen.add(key);
    samples.push({ text: value, where: where(element), source });
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (parent === null || skipTags.has(parent.tagName) || parent.closest("[hidden],script,style") || exempted(parent)) continue;
    push(node.nodeValue, parent, "text");
  }
  for (const element of document.body.querySelectorAll("[aria-label],[title],[placeholder],img[alt]")) {
    if (element.closest("[hidden],[aria-hidden=true]") || exempted(element)) continue;
    for (const attribute of ["aria-label", "title", "placeholder", "alt"]) {
      if (element.hasAttribute(attribute)) push(element.getAttribute(attribute), element, attribute);
    }
  }
  return samples;
}

/** Violations in `samples` for the named surface, in sample order. */
export function scanLegibility(samples, { surface }) {
  const violations = [];
  for (const sample of Array.isArray(samples) ? samples : []) {
    for (const rule of LEGIBILITY_RULES) {
      if (rule.surfaces !== null && !rule.surfaces.has(surface)) continue;
      for (const match of String(sample.text).matchAll(rule.pattern)) {
        violations.push(
          Object.freeze({
            rule: rule.id,
            match: match[0],
            where: sample.where,
            source: sample.source,
            excerpt: excerptAround(sample.text, match.index, match[0].length),
          }),
        );
      }
    }
  }
  return Object.freeze(violations);
}

/** Collects and scans one loaded page; the evidence shape role-smoke records. */
export async function captureLegibility(page, { surface }) {
  const samples = await page.evaluate(collectLegibilitySamples, [...LEGIBILITY_EXEMPT_REGIONS]);
  const violations = scanLegibility(samples, { surface });
  return Object.freeze({
    mode: LEGIBILITY_MODE,
    surface,
    sampleCount: samples.length,
    violations,
  });
}

export function legibilityEvidenceComplete(evidence, { surface } = {}) {
  return (
    evidence?.mode === LEGIBILITY_MODE &&
    (surface === undefined || evidence.surface === surface) &&
    Number.isInteger(evidence.sampleCount) &&
    evidence.sampleCount > 0 &&
    Array.isArray(evidence.violations) &&
    evidence.violations.length === 0 &&
    evidence.violations.every(
      (violation) =>
        LEGIBILITY_RULES.some((rule) => rule.id === violation?.rule) &&
        typeof violation.match === "string" &&
        violation.match !== "",
    )
  );
}

function excerptAround(text, index, length) {
  const start = Math.max(0, index - 30);
  const end = Math.min(text.length, index + length + 30);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
