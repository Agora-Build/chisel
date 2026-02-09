export interface PanelOptions {
  /** API route prefix for save endpoints. Default: "/api/dev" */
  apiPrefix?: string;
  /** localStorage key for persisting overrides. Default: "chisel-dev-panel" */
  storageKey?: string;
  /** Keyboard shortcut to toggle panel. Default: "Ctrl+Shift+D" */
  shortcut?: { ctrl?: boolean; shift?: boolean; alt?: boolean; key: string };
  /** Explicit variable groups. If omitted, variables are auto-detected from stylesheets. */
  variables?: VarGroup[];
  /** Panel position. Default: "right" */
  position?: "left" | "right";
  /** Panel width in pixels. Default: 380 */
  width?: number;
}

export interface MiddlewareOptions {
  /** Path to the CSS file to edit. Default: "src/index.css" */
  cssFile?: string;
  /** Directories to search for source files when doing content replacements. Default: ["src"] */
  srcDirs?: string[];
  /** File extensions to search in source directories. Default: [".tsx", ".ts", ".jsx", ".js", ".vue", ".svelte"] */
  extensions?: string[];
  /** Git commit message for style saves. Default: "style: update theme variables via chisel" */
  commitMessage?: string;
  /** API route prefix. Default: "/api/dev" */
  apiPrefix?: string;
}

export interface VarInfo {
  /** CSS variable name, e.g. "--background" */
  name: string;
  /** Current computed value */
  value: string;
  /** Whether this variable holds a color value */
  isColor: boolean;
}

export interface VarGroup {
  /** Display label for the group */
  label: string;
  /** Variables in this group */
  vars: VarInfo[];
}

export interface ContentChange {
  /** Original text content */
  original: string;
  /** Replacement text content */
  replacement: string;
  /** HTML tag name of the element */
  tagName: string;
}
