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
