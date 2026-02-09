import type { VarGroup, VarInfo } from "./types";

export function hslToHex(hslStr: string): string {
  const parts = hslStr.trim().split(/\s+/);
  if (parts.length < 3) return "#000000";
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): string {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return "0 0% 0%";
  const r = parseInt(result[1], 16) / 255;
  const g = parseInt(result[2], 16) / 255;
  const b = parseInt(result[3], 16) / 255;

  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export function isColorValue(value: string): boolean {
  const trimmed = value.trim();
  // HSL pattern: "220 14% 10%" or "220 14.5% 10.2%"
  if (/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/.test(trimmed)) return true;
  // Hex: #rgb, #rrggbb, #rrggbbaa
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return true;
  // rgb/rgba/hsl/hsla functions
  if (/^(rgb|hsl)a?\(/.test(trimmed)) return true;
  return false;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Auto-detect CSS custom properties from all stylesheets on the page.
 * Groups them by prefix (e.g. --sidebar-* -> "Sidebar").
 */
export function scanCSSVariables(): VarGroup[] {
  const vars: VarInfo[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < document.styleSheets.length; i++) {
    let rules: CSSRuleList;
    try {
      rules = document.styleSheets[i].cssRules;
    } catch {
      // Cross-origin stylesheet, skip
      continue;
    }
    for (let j = 0; j < rules.length; j++) {
      const rule = rules[j];
      if (!(rule instanceof CSSStyleRule)) continue;
      const style = rule.style;
      for (let k = 0; k < style.length; k++) {
        const prop = style[k];
        if (!prop.startsWith("--")) continue;
        if (seen.has(prop)) continue;
        seen.add(prop);
        const rawValue = style.getPropertyValue(prop).trim();
        vars.push({
          name: prop,
          value: rawValue,
          isColor: isColorValue(rawValue),
        });
      }
    }
  }

  // Group by prefix: --sidebar-primary -> "Sidebar", --chart-1 -> "Charts"
  const groups = new Map<string, VarInfo[]>();
  for (const v of vars) {
    const withoutDashes = v.name.slice(2); // remove leading --
    const dashIndex = withoutDashes.indexOf("-");
    let groupKey: string;
    if (dashIndex > 0) {
      groupKey = withoutDashes.slice(0, dashIndex);
    } else {
      groupKey = "general";
    }
    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey)!.push(v);
  }

  const result: VarGroup[] = [];
  for (const [key, groupVars] of groups) {
    result.push({
      label: capitalize(key),
      vars: groupVars,
    });
  }
  return result;
}
