import type { PanelOptions, VarGroup, ContentChange, DetectedIcon, IconChange, AnnotationTool, MarkSnapshot } from "./types";
import { hslToHex, hexToHsl, scanCSSVariables } from "./utils";
import { findSVGIcon, detectIcon } from "./icons";
import { AnnotationOverlay } from "./overlay";

// ============================================================
// Default options
// ============================================================

const DEFAULTS: Required<Pick<PanelOptions, "apiPrefix" | "storageKey" | "position" | "width">> & {
  shortcut: NonNullable<PanelOptions["shortcut"]>;
} = {
  apiPrefix: "/api/dev",
  storageKey: "chisel-dev-panel",
  shortcut: { ctrl: true, shift: true, key: "D" },
  position: "right",
  width: 380,
};

// ============================================================
// Inline styles as CSS strings (immune to app CSS overrides)
// ============================================================

const COLORS = {
  bg: "#111827",
  bgSecondary: "#1f2937",
  border: "#374151",
  text: "#e5e7eb",
  textMuted: "#9ca3af",
  textDim: "#6b7280",
  textDimmer: "#4b5563",
  accent: "#60a5fa",
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
  infoBg: "#1e3a5f",
  infoText: "#93c5fd",
  diffRed: "#f87171",
  diffGreen: "#4ade80",
};

function btnStyle(bg: string): string {
  return `flex:1;padding:6px 10px;background:${bg};color:#fff;border:none;border-radius:4px;font-size:12px;font-family:system-ui,sans-serif;cursor:pointer;`;
}

// ============================================================
// DevPanel class
// ============================================================

export class DevPanel {
  private options: typeof DEFAULTS & { variables?: VarGroup[] };
  private isOpen = false;
  private activeTab: "theme" | "css" | "content" | "icons" | "mark" = "theme";
  private overrides: Record<string, string> = {};
  private customCSS = "";
  private isPicking = false;
  private selectedEl: { el: HTMLElement; text: string; tag: string } | null = null;
  private editText = "";
  private contentChanges: ContentChange[] = [];
  private status = "";
  private saving = false;

  // Icon tab state
  private isPickingIcon = false;
  private detectedIcon: DetectedIcon | null = null;
  private iconReplacement = "";
  private iconChanges: IconChange[] = [];

  // Mark tab state
  private overlay: AnnotationOverlay | null = null;
  private markTool: AnnotationTool = "circle";
  private markColor = "#ef4444";
  private markSaving = false;
  private markResult = "";

  // DOM refs
  private root: HTMLDivElement | null = null;
  private toggleBtn: HTMLButtonElement | null = null;
  private panelEl: HTMLDivElement | null = null;
  private bodyEl: HTMLDivElement | null = null;
  private statusEl: HTMLDivElement | null = null;
  private customStyleEl: HTMLStyleElement | null = null;
  private highlightedEl: HTMLElement | null = null;

  // Bound listeners for cleanup
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private pickMouseOver: ((e: MouseEvent) => void) | null = null;
  private pickClick: ((e: MouseEvent) => void) | null = null;
  private pickKeyDown: ((e: KeyboardEvent) => void) | null = null;
  private iconPickMouseOver: ((e: MouseEvent) => void) | null = null;
  private iconPickClick: ((e: MouseEvent) => void) | null = null;
  private iconPickKeyDown: ((e: KeyboardEvent) => void) | null = null;

  // Resolved variable groups (auto-detected or explicit)
  private varGroups: VarGroup[] = [];

  constructor(options?: PanelOptions) {
    this.options = { ...DEFAULTS, ...options };
    this.overrides = this.loadOverrides();
  }

  // ---- Public API ----

  mount(target?: HTMLElement): void {
    const container = target || document.body;

    // Root container
    this.root = document.createElement("div");
    this.root.setAttribute("data-chisel", "root");
    container.appendChild(this.root);

    // Custom CSS style element
    let styleEl = document.getElementById("chisel-custom-css") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "chisel-custom-css";
      document.head.appendChild(styleEl);
    }
    this.customStyleEl = styleEl;

    // Apply saved overrides
    for (const [name, value] of Object.entries(this.overrides)) {
      document.documentElement.style.setProperty(name, value);
    }

    // Resolve variable groups
    this.varGroups = this.options.variables || scanCSSVariables();

    // Create toggle button
    this.renderToggle();

    // Keyboard shortcut
    const sc = this.options.shortcut;
    this.keydownHandler = (e: KeyboardEvent) => {
      if (
        (sc.ctrl ? e.ctrlKey : true) &&
        (sc.shift ? e.shiftKey : true) &&
        (sc.alt ? e.altKey : true) &&
        e.key === sc.key
      ) {
        e.preventDefault();
        this.toggle();
      }
    };
    window.addEventListener("keydown", this.keydownHandler);
  }

  unmount(): void {
    this.stopPicking();
    this.stopIconPicking();
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = null;
    }
    if (this.keydownHandler) {
      window.removeEventListener("keydown", this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.customStyleEl) {
      this.customStyleEl.remove();
      this.customStyleEl = null;
    }
    if (this.root) {
      this.root.remove();
      this.root = null;
    }
    this.toggleBtn = null;
    this.panelEl = null;
    this.bodyEl = null;
    this.statusEl = null;
  }

  // ---- Toggle ----

  private toggle(): void {
    this.isOpen = !this.isOpen;
    if (this.isOpen) {
      this.buildPanel();
    } else {
      this.stopPicking();
      this.stopIconPicking();
      if (this.overlay) this.overlay.hide();
      if (this.panelEl) {
        this.panelEl.remove();
        this.panelEl = null;
      }
    }
    this.updateToggleVisibility();
  }

  // ---- Render toggle button ----

  private renderToggle(): void {
    if (!this.root) return;
    const btn = document.createElement("button");
    btn.setAttribute("data-chisel", "toggle");
    btn.setAttribute("aria-label", "Open Chisel Dev Panel");
    btn.textContent = "Chisel Dev";
    const pos = this.options.position;
    btn.style.cssText = `position:fixed;bottom:16px;${pos}:16px;z-index:99999;padding:8px 16px;background:${COLORS.blue};color:#fff;border:none;border-radius:6px;font-size:13px;font-family:system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,0.3);`;
    btn.addEventListener("click", () => this.toggle());
    this.root.appendChild(btn);
    this.toggleBtn = btn;
  }

  private updateToggleVisibility(): void {
    if (this.toggleBtn) {
      this.toggleBtn.style.display = this.isOpen ? "none" : "";
    }
  }

  // ---- Build full panel ----

  private buildPanel(): void {
    if (!this.root) return;
    if (this.panelEl) this.panelEl.remove();

    const w = this.options.width;
    const pos = this.options.position;
    const panel = document.createElement("div");
    panel.setAttribute("data-chisel", "panel");
    panel.style.cssText = `position:fixed;top:0;${pos}:0;width:${w}px;height:100vh;z-index:99998;background:${COLORS.bg};color:${COLORS.text};font-family:system-ui,sans-serif;font-size:13px;display:flex;flex-direction:column;border-${pos === "right" ? "left" : "right"}:1px solid ${COLORS.border};box-shadow:${pos === "right" ? "-" : ""}4px 0 16px rgba(0,0,0,0.4);`;

    panel.innerHTML = `
      <div style="padding:12px 16px;border-bottom:1px solid ${COLORS.border};font-size:14px;font-weight:600;line-height:1.4;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span>Chisel Dev</span>
          <button data-chisel="close" style="background:none;border:none;color:${COLORS.textMuted};cursor:pointer;font-size:18px;font-family:system-ui;" aria-label="Close panel">x</button>
        </div>
        <div style="font-size:11px;color:${COLORS.textDim};margin-top:2px;">
          Adjust theme, CSS, or text content — then Save to File or Save &amp; Commit
        </div>
      </div>
      <div data-chisel="tabs" style="display:flex;border-bottom:1px solid ${COLORS.border};">
        <button data-chisel="tab" data-tab="theme" style="${this.tabStyle("theme")}">Theme</button>
        <button data-chisel="tab" data-tab="css" style="${this.tabStyle("css")}">CSS</button>
        <button data-chisel="tab" data-tab="content" style="${this.tabStyle("content")}">Content</button>
        <button data-chisel="tab" data-tab="icons" style="${this.tabStyle("icons")}">Icons</button>
        <button data-chisel="tab" data-tab="mark" style="${this.tabStyle("mark")}">Mark</button>
      </div>
      <div data-chisel="body" style="flex:1;overflow:auto;padding:12px 16px;"></div>
      <div data-chisel="footer" style="padding:10px 16px;border-top:1px solid ${COLORS.border};display:flex;flex-direction:column;gap:6px;${this.activeTab === "mark" ? "display:none;" : ""}">
        <div style="display:flex;gap:6px;">
          <button data-chisel="save" style="${btnStyle(COLORS.blue)}">Save to File</button>
          <button data-chisel="save-commit" style="${btnStyle(COLORS.green)}">Save &amp; Commit</button>
        </div>
        <div style="display:flex;gap:6px;">
          <button data-chisel="reset" style="${btnStyle(COLORS.red)}">Reset All</button>
        </div>
        <div data-chisel="status" style="font-size:11px;color:${COLORS.textMuted};text-align:center;min-height:16px;"></div>
      </div>
    `;

    this.root.appendChild(panel);
    this.panelEl = panel;
    this.bodyEl = panel.querySelector('[data-chisel="body"]') as HTMLDivElement;
    this.statusEl = panel.querySelector('[data-chisel="status"]') as HTMLDivElement;

    // Attach panel-level event delegation
    panel.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      const chiselAttr = target.getAttribute("data-chisel");

      if (chiselAttr === "close") {
        this.toggle();
      } else if (chiselAttr === "tab") {
        const tab = target.getAttribute("data-tab") as "theme" | "css" | "content" | "icons" | "mark";
        if (tab && tab !== this.activeTab) {
          if (this.activeTab === "mark" && this.overlay) this.overlay.hide();
          this.activeTab = tab;
          this.updateTabs();
          this.renderBody();
        }
      } else if (chiselAttr === "save") {
        this.save(false);
      } else if (chiselAttr === "save-commit") {
        this.save(true);
      } else if (chiselAttr === "reset") {
        this.reset();
      } else if (chiselAttr === "pick-element") {
        if (this.isPicking) {
          this.stopPicking();
        } else {
          this.selectedEl = null;
          this.editText = "";
          this.startPicking();
        }
        this.renderBody();
      } else if (chiselAttr === "apply-change") {
        this.applyContent();
      } else if (chiselAttr?.startsWith("remove-change-")) {
        const idx = parseInt(chiselAttr.replace("remove-change-", ""), 10);
        if (!isNaN(idx)) {
          this.contentChanges.splice(idx, 1);
          this.renderBody();
        }
      } else if (chiselAttr === "pick-icon") {
        if (this.isPickingIcon) {
          this.stopIconPicking();
        } else {
          this.detectedIcon = null;
          this.iconReplacement = "";
          this.startIconPicking();
        }
        this.renderBody();
      } else if (chiselAttr === "apply-icon") {
        if (this.iconReplacement.trim() && this.detectedIcon) {
          const comp = this.iconReplacement.trim();
          // Mark the icon on the page so the user sees it was captured
          const svgEl = this.detectedIcon.element;
          svgEl.style.outline = "2px dashed #f97316";
          svgEl.style.outlineOffset = "2px";
          svgEl.style.opacity = "0.5";
          this.iconChanges.push({
            originalComponent: this.detectedIcon.componentName,
            replacementComponent: comp,
            importSource: this.detectedIcon.importSource,
            library: this.detectedIcon.library,
          });
          this.setStatus(`Queued: ${this.detectedIcon.componentName} → ${comp}`);
          this.detectedIcon = null;
          this.iconReplacement = "";
          this.renderBody();
        }
      } else if (chiselAttr?.startsWith("remove-icon-change-")) {
        const idx = parseInt(chiselAttr.replace("remove-icon-change-", ""), 10);
        if (!isNaN(idx)) {
          this.iconChanges.splice(idx, 1);
          this.renderBody();
        }
      } else if (chiselAttr === "tool-circle" || chiselAttr === "tool-arrow" || chiselAttr === "tool-text") {
        const tool = chiselAttr.replace("tool-", "") as AnnotationTool;
        this.markTool = tool;
        if (!this.overlay) this.overlay = new AnnotationOverlay();
        this.overlay.setColor(this.markColor);
        this.overlay.show(tool);
        this.renderBody();
      } else if (chiselAttr?.startsWith("color-")) {
        const color = "#" + chiselAttr.replace("color-", "");
        this.markColor = color;
        if (this.overlay) this.overlay.setColor(color);
        this.renderBody();
      } else if (chiselAttr === "mark-undo") {
        if (this.overlay) {
          this.overlay.undo();
          this.renderBody();
        }
      } else if (chiselAttr === "mark-clear") {
        if (this.overlay) {
          this.overlay.clear();
          this.renderBody();
        }
      } else if (chiselAttr === "ask-agent") {
        this.handleAskAgent();
      }
    });

    this.renderBody();
  }

  // ---- Tab styles ----

  private tabStyle(tab: string): string {
    const active = tab === this.activeTab;
    return `flex:1;padding:8px;background:${active ? COLORS.bgSecondary : "transparent"};color:${active ? COLORS.accent : COLORS.textMuted};border:none;border-bottom:2px solid ${active ? COLORS.accent : "transparent"};cursor:pointer;font-size:12px;font-family:system-ui,sans-serif;`;
  }

  private updateTabs(): void {
    if (!this.panelEl) return;
    const tabs = this.panelEl.querySelectorAll('[data-chisel="tab"]');
    tabs.forEach((t) => {
      const tabName = (t as HTMLElement).getAttribute("data-tab") || "";
      (t as HTMLElement).style.cssText = this.tabStyle(tabName);
    });
    // Hide save/commit footer on Mark tab
    const footer = this.panelEl.querySelector('[data-chisel="footer"]') as HTMLElement | null;
    if (footer) footer.style.display = this.activeTab === "mark" ? "none" : "flex";
  }

  // ---- Render body content ----

  private renderBody(): void {
    if (!this.bodyEl) return;
    switch (this.activeTab) {
      case "theme":
        this.renderThemeTab();
        break;
      case "css":
        this.renderCSSTab();
        break;
      case "content":
        this.renderContentTab();
        break;
      case "icons":
        this.renderIconsTab();
        break;
      case "mark":
        this.renderMarkTab();
        break;
    }
    this.attachBodyListeners();
  }

  // ---- Theme Tab ----

  private renderThemeTab(): void {
    if (!this.bodyEl) return;
    let html = "";
    for (const group of this.varGroups) {
      html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin:16px 0 6px;letter-spacing:0.05em;">${group.label}</div>`;
      for (const v of group.vars) {
        const val = this.getCurrentValue(v.name);
        const overrideVal = this.overrides[v.name] ?? "";
        const placeholder = this.getComputedVar(v.name);
        let colorPicker = "";
        if (v.isColor) {
          let hexVal: string;
          try {
            hexVal = hslToHex(val);
          } catch {
            hexVal = "#000000";
          }
          colorPicker = `<input type="color" data-chisel="color" data-var="${v.name}" value="${hexVal}" style="width:32px;height:24px;border:1px solid ${COLORS.textDimmer};border-radius:3px;padding:0;cursor:pointer;background:transparent;" aria-label="${v.name} color picker"/>`;
        }
        html += `
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <label style="width:170px;font-size:12px;color:#d1d5db;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${v.name}">${v.name}</label>
            ${colorPicker}
            <input type="text" data-chisel="var-input" data-var="${v.name}" value="${this.escapeAttr(overrideVal)}" placeholder="${this.escapeAttr(placeholder)}" style="flex:1;padding:3px 6px;background:${COLORS.bgSecondary};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:3px;font-size:12px;font-family:monospace;" aria-label="${v.name} value"/>
          </div>`;
      }
    }
    this.bodyEl.innerHTML = html;
  }

  // ---- CSS Tab ----

  private renderCSSTab(): void {
    if (!this.bodyEl) return;
    this.bodyEl.innerHTML = `
      <div style="margin-bottom:8px;color:${COLORS.textMuted};">Write arbitrary CSS below. Applied instantly.</div>
      <textarea data-chisel="css-editor" style="width:100%;height:300px;background:${COLORS.bgSecondary};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:4px;padding:8px;font-size:12px;font-family:monospace;resize:vertical;box-sizing:border-box;" placeholder=".example {\n  font-size: 20px;\n}" aria-label="Custom CSS editor">${this.escapeHtml(this.customCSS)}</textarea>
    `;
  }

  // ---- Content Tab ----

  private renderContentTab(): void {
    if (!this.bodyEl) return;
    let html = `
      <div style="margin-bottom:10px;color:${COLORS.textMuted};line-height:1.5;">
        Pick a text element on the page, edit its content, then Apply. Changes are saved to source files when you click Save to File.
      </div>
      <button data-chisel="pick-element" style="${btnStyle(this.isPicking ? COLORS.red : COLORS.border)}flex:none;width:100%;margin-bottom:12px;padding:8px;">
        ${this.isPicking ? "Cancel Picking (Esc)" : "Pick Element"}
      </button>
    `;

    if (this.isPicking) {
      html += `<div style="padding:8px;background:${COLORS.infoBg};border-radius:4px;margin-bottom:12px;color:${COLORS.infoText};font-size:12px;">Click any text element on the page to select it...</div>`;
    }

    if (this.selectedEl && !this.isPicking) {
      const disabled = this.editText === this.selectedEl.text ? "opacity:0.5;pointer-events:none;" : "";
      html += `
        <div style="border:1px solid ${COLORS.border};border-radius:4px;padding:10px;margin-bottom:12px;background:${COLORS.bgSecondary};">
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:6px;">Selected: &lt;${this.selectedEl.tag}&gt;</div>
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:2px;">Original text:</div>
          <div style="padding:6px;background:${COLORS.bg};border-radius:3px;font-size:12px;color:${COLORS.textMuted};margin-bottom:8px;max-height:60px;overflow:auto;font-family:monospace;white-space:pre-wrap;word-break:break-word;" data-chisel="original-text">${this.escapeHtml(this.selectedEl.text)}</div>
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:2px;">New text:</div>
          <textarea data-chisel="new-text" style="width:100%;height:80px;background:${COLORS.bgSecondary};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:4px;padding:8px;font-size:12px;font-family:monospace;resize:vertical;margin-bottom:8px;box-sizing:border-box;" aria-label="New text content">${this.escapeHtml(this.editText)}</textarea>
          <button data-chisel="apply-change" style="${btnStyle(COLORS.blue)}flex:none;width:100%;${disabled}">Apply Change</button>
        </div>
      `;
    }

    if (this.contentChanges.length > 0) {
      html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin:16px 0 6px;letter-spacing:0.05em;">Pending Changes (${this.contentChanges.length})</div>`;
      this.contentChanges.forEach((change, i) => {
        const origTrunc = change.original.length > 80 ? change.original.slice(0, 80) + "..." : change.original;
        const replTrunc = change.replacement.length > 80 ? change.replacement.slice(0, 80) + "..." : change.replacement;
        html += `
          <div style="border:1px solid ${COLORS.border};border-radius:4px;padding:8px;margin-bottom:6px;background:${COLORS.bgSecondary};font-size:11px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="color:${COLORS.textDim};">&lt;${change.tagName}&gt;</span>
              <button data-chisel="remove-change-${i}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:11px;font-family:system-ui;padding:0 2px;" aria-label="Remove change ${i}">remove</button>
            </div>
            <div style="color:${COLORS.diffRed};font-family:monospace;word-break:break-word;">- ${this.escapeHtml(origTrunc)}</div>
            <div style="color:${COLORS.diffGreen};font-family:monospace;word-break:break-word;">+ ${this.escapeHtml(replTrunc)}</div>
          </div>
        `;
      });
    }

    if (!this.isPicking && !this.selectedEl && this.contentChanges.length === 0) {
      html += `<div style="color:${COLORS.textDimmer};text-align:center;padding:24px 0;">No changes yet. Click "Pick Element" to start.</div>`;
    }

    this.bodyEl.innerHTML = html;
  }

  // ---- Icons Tab ----

  private renderIconsTab(): void {
    if (!this.bodyEl) return;
    let html = `
      <div style="margin-bottom:10px;color:${COLORS.textMuted};line-height:1.5;">
        Pick an icon on the page, type the replacement component name, then Apply. Changes rewrite imports and usage in source files.
      </div>
      <button data-chisel="pick-icon" style="${btnStyle(this.isPickingIcon ? COLORS.red : COLORS.border)}flex:none;width:100%;margin-bottom:12px;padding:8px;">
        ${this.isPickingIcon ? "Cancel Picking (Esc)" : "Pick Icon"}
      </button>
    `;

    if (this.isPickingIcon) {
      html += `<div style="padding:8px;background:${COLORS.infoBg};border-radius:4px;margin-bottom:12px;color:${COLORS.infoText};font-size:12px;">Click any icon (SVG) on the page to select it...</div>`;
    }

    if (this.detectedIcon && !this.isPickingIcon) {
      const disabled = !this.iconReplacement.trim() || this.iconReplacement.trim() === this.detectedIcon.componentName ? "opacity:0.5;pointer-events:none;" : "";
      html += `
        <div style="border:1px solid ${COLORS.border};border-radius:4px;padding:10px;margin-bottom:12px;background:${COLORS.bgSecondary};">
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:6px;">Detected Icon</div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:14px;font-weight:600;color:${COLORS.text};font-family:monospace;">${this.escapeHtml(this.detectedIcon.componentName)}</span>
            <span style="font-size:11px;color:${COLORS.textDim};background:${COLORS.bg};padding:2px 6px;border-radius:3px;">${this.detectedIcon.library}</span>
          </div>
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:8px;">from "${this.escapeHtml(this.detectedIcon.importSource)}"</div>
          <div style="font-size:11px;color:${COLORS.textDim};margin-bottom:2px;">Replacement component name:</div>
          <input type="text" data-chisel="icon-replacement" value="${this.escapeAttr(this.iconReplacement)}" placeholder="e.g. Rocket, ArrowRight" style="width:100%;padding:6px 8px;background:${COLORS.bgSecondary};color:${COLORS.text};border:1px solid ${COLORS.border};border-radius:4px;font-size:13px;font-family:monospace;margin-bottom:8px;box-sizing:border-box;" aria-label="Replacement icon name"/>
          <button data-chisel="apply-icon" style="${btnStyle(COLORS.blue)}flex:none;width:100%;${disabled}">Apply Change</button>
        </div>
      `;
    }

    if (this.iconChanges.length > 0) {
      html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin:16px 0 6px;letter-spacing:0.05em;">Pending Icon Changes (${this.iconChanges.length})</div>`;
      this.iconChanges.forEach((change, i) => {
        html += `
          <div style="border:1px solid ${COLORS.border};border-radius:4px;padding:8px;margin-bottom:6px;background:${COLORS.bgSecondary};font-size:11px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
              <span style="color:${COLORS.textDim};">${this.escapeHtml(change.library)}</span>
              <button data-chisel="remove-icon-change-${i}" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:11px;font-family:system-ui;padding:0 2px;" aria-label="Remove icon change ${i}">remove</button>
            </div>
            <div style="color:${COLORS.diffRed};font-family:monospace;word-break:break-word;">- ${this.escapeHtml(change.originalComponent)}</div>
            <div style="color:${COLORS.diffGreen};font-family:monospace;word-break:break-word;">+ ${this.escapeHtml(change.replacementComponent)}</div>
          </div>
        `;
      });
    }

    if (!this.isPickingIcon && !this.detectedIcon && this.iconChanges.length === 0) {
      html += `<div style="color:${COLORS.textDimmer};text-align:center;padding:24px 0;">No icon changes yet. Click "Pick Icon" to start.</div>`;
    }

    this.bodyEl.innerHTML = html;
  }

  // ---- Mark Tab ----

  private renderMarkTab(): void {
    if (!this.bodyEl) return;
    const MARK_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6"];
    const annotations = this.overlay ? this.overlay.getAnnotations() : [];
    const count = annotations.length;

    let html = `
      <div style="margin-bottom:10px;color:${COLORS.textMuted};line-height:1.5;">
        Draw annotations on the page, then ask an agent to work on it.
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin-bottom:6px;letter-spacing:0.05em;">Tools</div>
      <div style="display:flex;gap:6px;margin-bottom:10px;">
        <button data-chisel="tool-circle" style="${btnStyle(this.markTool === "circle" ? COLORS.blue : COLORS.border)}">Circle</button>
        <button data-chisel="tool-arrow" style="${btnStyle(this.markTool === "arrow" ? COLORS.blue : COLORS.border)}">Arrow</button>
        <button data-chisel="tool-text" style="${btnStyle(this.markTool === "text" ? COLORS.blue : COLORS.border)}">Text</button>
      </div>
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin-bottom:6px;letter-spacing:0.05em;">Color</div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
    `;
    for (const c of MARK_COLORS) {
      const selected = c === this.markColor;
      html += `<button data-chisel="color-${c.replace("#", "")}" style="width:24px;height:24px;border-radius:50%;background:${c};border:2px solid ${selected ? "#fff" : "transparent"};cursor:pointer;padding:0;" aria-label="Color ${c}"></button>`;
    }
    html += `</div>
      <div style="display:flex;gap:6px;margin-bottom:12px;">
        <button data-chisel="mark-undo" style="${btnStyle(COLORS.border)}">Undo</button>
        <button data-chisel="mark-clear" style="${btnStyle(COLORS.border)}">Clear</button>
      </div>
    `;

    if (count > 0) {
      html += `<div style="font-size:11px;font-weight:700;text-transform:uppercase;color:${COLORS.textDim};margin:8px 0 6px;letter-spacing:0.05em;">Annotations (${count})</div>`;
      for (const ann of annotations) {
        let desc = "";
        if (ann.tool === "circle") desc = `Circle at (${Math.round(ann.x)}, ${Math.round(ann.y)})`;
        else if (ann.tool === "arrow") desc = `Arrow (${Math.round(ann.x)},${Math.round(ann.y)}) → (${Math.round(ann.endX || 0)},${Math.round(ann.endY || 0)})`;
        else if (ann.tool === "text") desc = `Text: "${this.escapeHtml(ann.text || "")}"`;
        html += `<div style="font-size:11px;color:${COLORS.textMuted};padding:2px 0;display:flex;align-items:center;gap:6px;">
          <span style="width:8px;height:8px;border-radius:50%;background:${ann.color};flex-shrink:0;"></span>
          ${desc}
        </div>`;
      }
    }

    if (this.markSaving) {
      html += `<div style="margin-top:16px;padding:12px;background:${COLORS.infoBg};border-radius:4px;color:${COLORS.infoText};font-size:12px;text-align:center;">Capturing screenshot...</div>`;
    } else if (this.markResult) {
      html += `<div style="margin-top:16px;padding:12px;background:#0a3622;border-radius:4px;color:#4ade80;font-size:12px;">${this.escapeHtml(this.markResult)}</div>`;
    }

    html += `
      <button data-chisel="ask-agent" style="${btnStyle(COLORS.green)}flex:none;width:100%;margin-top:16px;padding:10px;font-size:13px;${this.markSaving || count === 0 ? "opacity:0.5;pointer-events:none;" : ""}">
        Ask Agent to Work on It
      </button>
    `;

    this.bodyEl.innerHTML = html;
  }

  private async handleAskAgent(): Promise<void> {
    if (this.markSaving || !this.overlay || this.overlay.getAnnotationCount() === 0) return;

    this.markSaving = true;
    this.markResult = "";
    this.renderBody();

    try {
      const screenshotDataUrl = await this.overlay.captureScreenshot();
      const annotations = this.overlay.getAnnotations();

      const snapshot: MarkSnapshot = {
        url: window.location.href,
        title: document.title,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        timestamp: new Date().toISOString(),
        screenshotDataUrl,
        annotations,
      };

      const resp = await fetch(`${this.options.apiPrefix}/save-mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(snapshot),
      });

      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Failed to save mark");

      this.markResult = `Task saved: ${data.taskFile}${data.forwarded ? " (forwarded to Astation)" : ""}`;
      this.overlay.clear();
      this.overlay.hide();
    } catch (err) {
      this.markResult = `Error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.markSaving = false;
      this.renderBody();
    }
  }

  // ---- Attach body-level listeners ----

  private attachBodyListeners(): void {
    if (!this.bodyEl) return;

    // Color picker changes
    this.bodyEl.querySelectorAll<HTMLInputElement>('[data-chisel="color"]').forEach((input) => {
      input.addEventListener("input", () => {
        const varName = input.getAttribute("data-var");
        if (varName) this.setVariable(varName, hexToHsl(input.value));
      });
    });

    // Text input changes
    this.bodyEl.querySelectorAll<HTMLInputElement>('[data-chisel="var-input"]').forEach((input) => {
      input.addEventListener("input", () => {
        const varName = input.getAttribute("data-var");
        if (varName) this.setVariable(varName, input.value);
      });
    });

    // Custom CSS textarea
    const cssEditor = this.bodyEl.querySelector<HTMLTextAreaElement>('[data-chisel="css-editor"]');
    if (cssEditor) {
      cssEditor.addEventListener("input", () => {
        this.customCSS = cssEditor.value;
        if (this.customStyleEl) {
          this.customStyleEl.textContent = this.customCSS;
        }
      });
    }

    // New text textarea
    const newTextArea = this.bodyEl.querySelector<HTMLTextAreaElement>('[data-chisel="new-text"]');
    const applyBtn = this.bodyEl.querySelector<HTMLButtonElement>('[data-chisel="apply-change"]');
    if (newTextArea) {
      newTextArea.addEventListener("input", () => {
        this.editText = newTextArea.value;
        if (applyBtn && this.selectedEl) {
          const same = this.editText === this.selectedEl.text;
          applyBtn.style.opacity = same ? "0.5" : "1";
          applyBtn.style.pointerEvents = same ? "none" : "auto";
        }
      });
    }

    // Icon replacement input
    const iconReplacementInput = this.bodyEl.querySelector<HTMLInputElement>('[data-chisel="icon-replacement"]');
    const applyIconBtn = this.bodyEl.querySelector<HTMLButtonElement>('[data-chisel="apply-icon"]');
    if (iconReplacementInput) {
      iconReplacementInput.addEventListener("input", () => {
        this.iconReplacement = iconReplacementInput.value;
        if (applyIconBtn && this.detectedIcon) {
          const empty = !this.iconReplacement.trim() || this.iconReplacement.trim() === this.detectedIcon.componentName;
          applyIconBtn.style.opacity = empty ? "0.5" : "1";
          applyIconBtn.style.pointerEvents = empty ? "none" : "auto";
        }
      });
    }
  }

  // ---- Variable manipulation ----

  private setVariable(name: string, value: string): void {
    if (value === "") {
      delete this.overrides[name];
      document.documentElement.style.removeProperty(name);
    } else {
      this.overrides[name] = value;
      document.documentElement.style.setProperty(name, value);
    }
    this.saveOverrides();

    // Update the companion input (color <-> text) without full re-render
    if (this.bodyEl) {
      const colorInput = this.bodyEl.querySelector<HTMLInputElement>(`[data-chisel="color"][data-var="${name}"]`);
      const textInput = this.bodyEl.querySelector<HTMLInputElement>(`[data-chisel="var-input"][data-var="${name}"]`);
      if (colorInput && value) {
        try {
          colorInput.value = hslToHex(value);
        } catch {
          // non-color value, ignore
        }
      }
      if (textInput) {
        textInput.value = value;
      }
    }
  }

  private getCurrentValue(name: string): string {
    return this.overrides[name] ?? this.getComputedVar(name);
  }

  private getComputedVar(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  // ---- Element picker ----

  private startPicking(): void {
    this.isPicking = true;

    const clearHighlight = () => {
      if (this.highlightedEl) {
        this.highlightedEl.style.outline = "";
        this.highlightedEl.style.outlineOffset = "";
        this.highlightedEl = null;
      }
    };

    this.pickMouseOver = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-chisel]")) return;
      clearHighlight();
      el.style.outline = "2px solid #60a5fa";
      el.style.outlineOffset = "2px";
      this.highlightedEl = el;
    };

    this.pickClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target as HTMLElement;
      if (el.closest("[data-chisel]")) return;
      clearHighlight();
      const text = el.innerText?.trim() || "";
      this.selectedEl = { el, text, tag: el.tagName.toLowerCase() };
      this.editText = text;
      this.isPicking = false;
      this.removePickListeners();
      this.renderBody();
    };

    this.pickKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearHighlight();
        this.isPicking = false;
        this.removePickListeners();
        this.renderBody();
      }
    };

    document.addEventListener("mouseover", this.pickMouseOver, true);
    document.addEventListener("click", this.pickClick, true);
    document.addEventListener("keydown", this.pickKeyDown, true);
  }

  private stopPicking(): void {
    if (!this.isPicking) return;
    if (this.highlightedEl) {
      this.highlightedEl.style.outline = "";
      this.highlightedEl.style.outlineOffset = "";
      this.highlightedEl = null;
    }
    this.isPicking = false;
    this.removePickListeners();
  }

  private removePickListeners(): void {
    if (this.pickMouseOver) {
      document.removeEventListener("mouseover", this.pickMouseOver, true);
      this.pickMouseOver = null;
    }
    if (this.pickClick) {
      document.removeEventListener("click", this.pickClick, true);
      this.pickClick = null;
    }
    if (this.pickKeyDown) {
      document.removeEventListener("keydown", this.pickKeyDown, true);
      this.pickKeyDown = null;
    }
  }

  // ---- Icon picker ----

  private startIconPicking(): void {
    this.isPickingIcon = true;

    const clearHighlight = () => {
      if (this.highlightedEl) {
        this.highlightedEl.style.outline = "";
        this.highlightedEl.style.outlineOffset = "";
        this.highlightedEl = null;
      }
    };

    this.iconPickMouseOver = (e: MouseEvent) => {
      const el = e.target as Element;
      if ((el as HTMLElement).closest?.("[data-chisel]")) return;
      const svg = findSVGIcon(el);
      if (!svg) return;
      clearHighlight();
      svg.style.outline = "2px solid #60a5fa";
      svg.style.outlineOffset = "2px";
      this.highlightedEl = svg as unknown as HTMLElement;
    };

    this.iconPickClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target as Element;
      if ((el as HTMLElement).closest?.("[data-chisel]")) return;
      const svg = findSVGIcon(el);
      if (!svg) {
        this.setStatus("No SVG icon found at click target");
        return;
      }
      clearHighlight();
      const detected = detectIcon(svg);
      if (!detected) {
        this.setStatus("Could not identify icon library (supported: Lucide, FontAwesome, Material)");
        this.isPickingIcon = false;
        this.removeIconPickListeners();
        this.renderBody();
        return;
      }
      this.detectedIcon = detected;
      this.iconReplacement = "";
      this.isPickingIcon = false;
      this.removeIconPickListeners();
      this.setStatus(`Detected: ${detected.componentName} (${detected.library})`);
      this.renderBody();
    };

    this.iconPickKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        clearHighlight();
        this.isPickingIcon = false;
        this.removeIconPickListeners();
        this.renderBody();
      }
    };

    document.addEventListener("mouseover", this.iconPickMouseOver, true);
    document.addEventListener("click", this.iconPickClick, true);
    document.addEventListener("keydown", this.iconPickKeyDown, true);
  }

  private stopIconPicking(): void {
    if (!this.isPickingIcon) return;
    if (this.highlightedEl) {
      this.highlightedEl.style.outline = "";
      this.highlightedEl.style.outlineOffset = "";
      this.highlightedEl = null;
    }
    this.isPickingIcon = false;
    this.removeIconPickListeners();
  }

  private removeIconPickListeners(): void {
    if (this.iconPickMouseOver) {
      document.removeEventListener("mouseover", this.iconPickMouseOver, true);
      this.iconPickMouseOver = null;
    }
    if (this.iconPickClick) {
      document.removeEventListener("click", this.iconPickClick, true);
      this.iconPickClick = null;
    }
    if (this.iconPickKeyDown) {
      document.removeEventListener("keydown", this.iconPickKeyDown, true);
      this.iconPickKeyDown = null;
    }
  }

  // ---- Content editing ----

  private applyContent(): void {
    if (!this.selectedEl) return;
    const original = this.selectedEl.text;
    const replacement = this.editText;
    if (original === replacement) return;

    this.selectedEl.el.innerText = replacement;
    this.contentChanges.push({ original, replacement, tagName: this.selectedEl.tag });
    this.setStatus(`Applied: <${this.selectedEl.tag}> text changed`);
    this.selectedEl = null;
    this.editText = "";
    this.renderBody();
  }

  // ---- Save ----

  private async save(commit: boolean): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    this.setStatus(commit ? "Saving & committing..." : "Saving...");
    this.updateSaveButtons(true);

    const hasStyleChanges = Object.keys(this.overrides).length > 0 || (this.customCSS && this.customCSS.trim());
    const hasContentChanges = this.contentChanges.length > 0;
    const hasIconChanges = this.iconChanges.length > 0;

    if (!hasStyleChanges && !hasContentChanges && !hasIconChanges) {
      this.setStatus("Nothing to save");
      this.saving = false;
      this.updateSaveButtons(false);
      return;
    }

    const prefix = this.options.apiPrefix;

    try {
      const messages: string[] = [];

      if (hasStyleChanges) {
        const commitStyles = commit && !hasContentChanges;
        const url = commitStyles ? `${prefix}/save-styles?commit=true` : `${prefix}/save-styles`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            variables: this.overrides,
            customCSS: this.customCSS || undefined,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed to save styles");
        messages.push(data.message);
      }

      if (hasContentChanges) {
        const commitContent = commit && !hasIconChanges;
        const url = commitContent ? `${prefix}/save-content?commit=true` : `${prefix}/save-content`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            replacements: this.contentChanges,
            alsoStageCSS: commitContent && !!hasStyleChanges,
          }),
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed to save content");
        messages.push(data.message);
        this.contentChanges = [];
      }

      if (hasIconChanges) {
        const url = commit ? `${prefix}/save-icons?commit=true` : `${prefix}/save-icons`;
        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            changes: this.iconChanges,
            alsoStageCSS: commit && !!hasStyleChanges,
          }),
        });
        const ct = resp.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          throw new Error("Server returned HTML instead of JSON — restart your dev server to pick up the new chisel middleware");
        }
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Failed to save icon changes");
        messages.push(data.message);
        this.iconChanges = [];
      }

      this.setStatus(messages.join(" | "));
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.saving = false;
      this.updateSaveButtons(false);
      if (hasContentChanges || hasIconChanges) this.renderBody();
    }
  }

  // ---- Reset ----

  private reset(): void {
    for (const group of this.varGroups) {
      for (const v of group.vars) {
        document.documentElement.style.removeProperty(v.name);
      }
    }
    // Also remove any overrides for vars not in groups
    for (const name of Object.keys(this.overrides)) {
      document.documentElement.style.removeProperty(name);
    }
    this.overrides = {};
    this.customCSS = "";
    this.contentChanges = [];
    this.selectedEl = null;
    this.editText = "";
    this.stopPicking();
    this.stopIconPicking();
    this.detectedIcon = null;
    this.iconReplacement = "";
    this.iconChanges = [];
    if (this.overlay) {
      this.overlay.clear();
      this.overlay.hide();
    }
    this.markResult = "";
    if (this.customStyleEl) {
      this.customStyleEl.textContent = "";
    }
    localStorage.removeItem(this.options.storageKey);
    this.setStatus("Reset");
    this.renderBody();
  }

  // ---- Helpers ----

  private setStatus(msg: string): void {
    this.status = msg;
    if (this.statusEl) {
      this.statusEl.textContent = msg;
    }
  }

  private updateSaveButtons(disabled: boolean): void {
    if (!this.panelEl) return;
    const saveBtn = this.panelEl.querySelector<HTMLButtonElement>('[data-chisel="save"]');
    const commitBtn = this.panelEl.querySelector<HTMLButtonElement>('[data-chisel="save-commit"]');
    if (saveBtn) {
      saveBtn.disabled = disabled;
      saveBtn.style.opacity = disabled ? "0.5" : "1";
    }
    if (commitBtn) {
      commitBtn.disabled = disabled;
      commitBtn.style.opacity = disabled ? "0.5" : "1";
    }
  }

  private loadOverrides(): Record<string, string> {
    try {
      const raw = localStorage.getItem(this.options.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  private saveOverrides(): void {
    localStorage.setItem(this.options.storageKey, JSON.stringify(this.overrides));
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private escapeAttr(s: string): string {
    return s.replace(/"/g, "&quot;").replace(/&/g, "&amp;");
  }
}
