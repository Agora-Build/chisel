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
  /** Optional Astation connection for forwarding tasks */
  astation?: AstationConfig;
  /** Server-only online Station connection. The browser never receives its credential. */
  station?: StationConfig;
}

export type IconLibrary = "lucide" | "fontawesome" | "material" | "unknown";

export interface DetectedIcon {
  /** Icon library identifier */
  library: IconLibrary;
  /** Kebab-case icon name, e.g. "zap", "arrow-right" */
  iconName: string;
  /** PascalCase component name, e.g. "Zap", "ArrowRight" */
  componentName: string;
  /** The SVG element on the page */
  element: SVGSVGElement;
  /** Import source, e.g. "lucide-react", "@fortawesome/free-solid-svg-icons" */
  importSource: string;
}

export interface IconChange {
  /** Original component name (PascalCase) */
  originalComponent: string;
  /** Replacement component name (PascalCase) */
  replacementComponent: string;
  /** Import source for the replacement */
  importSource: string;
  /** Icon library */
  library: IconLibrary;
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

// ---- Mark & Snapshot types ----

export type AnnotationTool = "circle" | "arrow" | "text";

export interface Annotation {
  id: string;
  tool: AnnotationTool;
  x: number;
  y: number;
  width?: number;
  height?: number;
  endX?: number;
  endY?: number;
  text?: string;
  color: string;
}

export interface MarkSnapshot {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  timestamp: string;
  screenshotDataUrl: string;
  annotations: Annotation[];
}

export interface AstationConfig {
  /** @deprecated Task-ID-only forwarding is unsupported. Use MiddlewareOptions.station. */
  wsUrl: string;
}

export interface StationConfig {
  /** HTTPS Station origin (HTTP is allowed only for loopback development). */
  origin: string;
  integrationId: string;
  hostId: string;
  sessionId: string;
  /** An explicitly approved route from the target Atem's runtime.toml. */
  routeId: string;
  routeRevision: number;
  /** Name of the server environment variable containing the integration bearer token. */
  tokenEnv: string;
}
