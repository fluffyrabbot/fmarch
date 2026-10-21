import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { THEMES } from "./theme.mjs";
const styles = new URL("../styles/", import.meta.url);
const declarations = css => new Set([...css.matchAll(/(--fm-[\w-]+)\s*:/g)].map(match => match[1]));
test("every theme supplies each palette's full semantic color contract", () => {
  const paper = readFileSync(new URL("themes/paper.css", styles), "utf8");
  const required = declarations(paper.match(/\[data-palette="day"\]\s*\{([^}]+)\}/s)[1]);
  for (const theme of THEMES) {
    const css = readFileSync(new URL(`themes/${theme.id}.css`, styles), "utf8");
    for (const palette of ["day", "night", "twilight"]) {
      const block = css.match(new RegExp(`\\[data-palette="${palette}"\\]\\s*\\{([^}]+)\\}`, "s"));
      assert.ok(block, `${theme.id}/${palette} missing`);
      assert.deepEqual([...declarations(block[1])].sort(), [...required].sort(), `${theme.id}/${palette} token contract drift`);
    }
  }
});

const luminance = hex => {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map(part => {
    const channel = parseInt(part, 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
test("role alignment inks read on their wash and on raised in every palette", () => {
  for (const theme of THEMES) {
    const css = readFileSync(new URL(`themes/${theme.id}.css`, styles), "utf8");
    for (const palette of ["day", "night", "twilight"]) {
      const block = css.match(new RegExp(`\\[data-palette="${palette}"\\]\\s*\\{([^}]+)\\}`, "s"))[1];
      const token = name => block.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1];
      const raised = token("--fm-raised");
      for (const alignment of ["town", "mafia", "independent"]) {
        const ink = token(`--fm-align-${alignment}`);
        const wash = token(`--fm-align-${alignment}-wash`);
        assert.ok(ink && wash && raised, `${theme.id}/${palette}/${alignment} tokens missing`);
        for (const [label, ground] of [["wash", wash], ["raised", raised]]) {
          const ratio = contrast(ink, ground);
          assert.ok(ratio >= 4.5, `${theme.id}/${palette} ${alignment} on ${label} is ${ratio.toFixed(2)}`);
        }
      }
    }
  }
});
