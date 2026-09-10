export async function provePhaseGroundContrast(page) {
  const palettes = await page.evaluate(() => {
    const shell = document.querySelector('[data-component="fm-app-shell"]');
    if (shell === null) {
      throw new Error("phase contrast check requires the fm-app-shell root");
    }
    const readPalette = () => {
      const styles = getComputedStyle(shell);
      const token = (name) => styles.getPropertyValue(name).trim();
      return {
        ink: token("--fm-ink"),
        inkMuted: token("--fm-ink-muted"),
        ground: token("--fm-ground"),
        raised: token("--fm-raised"),
        accent: token("--fm-accent"),
        ok: token("--fm-ok"),
        pending: token("--fm-pending"),
        danger: token("--fm-danger"),
        dangerInk: token("--fm-danger-ink"),
        info: token("--fm-info"),
      };
    };
    const original = shell.getAttribute("data-palette");
    shell.setAttribute("data-palette", "day");
    const day = readPalette();
    shell.setAttribute("data-palette", "night");
    const night = readPalette();
    shell.setAttribute("data-palette", "twilight");
    const twilight = readPalette();
    if (original === null) {
      shell.removeAttribute("data-palette");
    } else {
      shell.setAttribute("data-palette", original);
    }
    return { day, night, twilight };
  });

  const checks = [];
  for (const [phase, palette] of Object.entries(palettes)) {
    const pairs = [
      ["ink-on-ground", palette.ink, palette.ground, 4.5],
      ["ink-on-raised", palette.ink, palette.raised, 4.5],
      ["ink-muted-on-ground", palette.inkMuted, palette.ground, 4.5],
      ["ink-muted-on-raised", palette.inkMuted, palette.raised, 4.5],
      ["accent-on-ground", palette.accent, palette.ground, 3],
      ["ok-on-ground", palette.ok, palette.ground, 3],
      ["ok-on-raised", palette.ok, palette.raised, 3],
      ["pending-on-ground", palette.pending, palette.ground, 3],
      ["pending-on-raised", palette.pending, palette.raised, 3],
      ["danger-on-ground", palette.danger, palette.ground, 3],
      ["danger-on-raised", palette.danger, palette.raised, 3],
      ["info-on-ground", palette.info, palette.ground, 3],
      ["info-on-raised", palette.info, palette.raised, 3],
      ["danger-ink-on-ground", palette.dangerInk, palette.ground, 4.5],
      ["danger-ink-on-raised", palette.dangerInk, palette.raised, 4.5],
    ];
    for (const [label, foreground, background, minimum] of pairs) {
      const ratio = wcagContrastRatio(foreground, background);
      if (ratio < minimum) {
        throw new Error(
          `${phase} palette ${label} contrast ${ratio.toFixed(2)} is below ${minimum} (${foreground} on ${background})`,
        );
      }
      checks.push({
        phase,
        pair: label,
        foreground,
        background,
        ratio: Number(ratio.toFixed(2)),
        minimum,
      });
    }
  }
  return checks;
}

function wcagContrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(cssColor) {
  const hex = cssColor.match(/^#([0-9a-f]{6})$/i)?.[1];
  let channels;
  if (hex !== undefined) {
    channels = [0, 2, 4].map((offset) =>
      parseInt(hex.slice(offset, offset + 2), 16) / 255,
    );
  } else {
    const rgb = cssColor.match(/rgba?\(([^)]+)\)/)?.[1];
    if (rgb === undefined) {
      throw new Error(`phase contrast check cannot parse color: ${cssColor}`);
    }
    channels = rgb
      .split(",")
      .slice(0, 3)
      .map((value) => Number(value.trim()) / 255);
  }
  const [r, g, b] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

