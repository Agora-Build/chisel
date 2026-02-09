export { DevPanel } from "./panel";
export type { PanelOptions, VarGroup, VarInfo, ContentChange, DetectedIcon, IconChange, IconLibrary } from "./types";
export { hslToHex, hexToHsl, isColorValue, scanCSSVariables } from "./utils";
export { findSVGIcon, detectIcon, kebabToPascal } from "./icons";

import { DevPanel } from "./panel";
import type { PanelOptions } from "./types";

export function mountPanel(options?: PanelOptions): DevPanel {
  const panel = new DevPanel(options);
  panel.mount();
  return panel;
}
