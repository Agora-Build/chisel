import type { Annotation, AnnotationTool } from "./types";

// ============================================================
// SVG Annotation Overlay
// ============================================================

let nextAnnId = 1;

function genId(): string {
  return `ann_${nextAnnId++}`;
}

export class AnnotationOverlay {
  private svg: SVGSVGElement | null = null;
  private annotations: Annotation[] = [];
  private activeTool: AnnotationTool = "circle";
  private color = "#ef4444";

  // Drawing state
  private drawing = false;
  private startX = 0;
  private startY = 0;
  private activeElement: SVGElement | null = null;
  private pendingAnnotation: Partial<Annotation> | null = null;

  // Bound handlers for cleanup
  private onMouseDown: ((e: MouseEvent) => void) | null = null;
  private onMouseMove: ((e: MouseEvent) => void) | null = null;
  private onMouseUp: ((e: MouseEvent) => void) | null = null;
  private onClick: ((e: MouseEvent) => void) | null = null;

  // Arrow marker defs
  private defs: SVGDefsElement | null = null;

  show(tool: AnnotationTool): void {
    this.activeTool = tool;
    if (!this.svg) {
      this.createSVG();
    }
    this.svg!.style.display = "block";
    this.detachHandlers();
    this.attachHandlers();
  }

  hide(): void {
    if (this.svg) {
      this.svg.style.display = "none";
    }
    this.detachHandlers();
    this.drawing = false;
  }

  setTool(tool: AnnotationTool): void {
    this.activeTool = tool;
    this.detachHandlers();
    this.attachHandlers();
  }

  setColor(color: string): void {
    this.color = color;
  }

  clear(): void {
    this.annotations = [];
    if (this.svg) {
      // Keep defs, remove everything else
      while (this.svg.lastChild && this.svg.lastChild !== this.defs) {
        this.svg.removeChild(this.svg.lastChild);
      }
    }
  }

  undo(): void {
    if (this.annotations.length === 0) return;
    this.annotations.pop();
    this.redraw();
  }

  getAnnotations(): Annotation[] {
    return [...this.annotations];
  }

  getAnnotationCount(): number {
    return this.annotations.length;
  }

  destroy(): void {
    this.detachHandlers();
    if (this.svg) {
      this.svg.remove();
      this.svg = null;
    }
    this.defs = null;
    this.annotations = [];
  }

  async captureScreenshot(): Promise<string> {
    // Hide overlay + any chisel panels
    const overlayDisplay = this.svg?.style.display;
    if (this.svg) this.svg.style.display = "none";
    const chiselRoot = document.querySelector('[data-chisel="root"]') as HTMLElement | null;
    const chiselDisplay = chiselRoot?.style.display;
    if (chiselRoot) chiselRoot.style.display = "none";

    try {
      return await captureWithForeignObject(this.annotations);
    } finally {
      // Restore visibility
      if (this.svg && overlayDisplay !== undefined) this.svg.style.display = overlayDisplay;
      if (chiselRoot && chiselDisplay !== undefined) chiselRoot.style.display = chiselDisplay;
    }
  }

  // ---- Private ----

  private createSVG(): void {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("data-chisel", "overlay");
    svg.style.cssText = `position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:99997;pointer-events:auto;cursor:crosshair;`;

    // Arrow marker defs
    this.defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(this.defs);

    document.body.appendChild(svg);
    this.svg = svg;
  }

  private ensureArrowMarker(color: string): string {
    const id = `chisel-arrow-${color.replace("#", "")}`;
    if (this.defs && !this.defs.querySelector(`#${id}`)) {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      marker.setAttribute("id", id);
      marker.setAttribute("markerWidth", "10");
      marker.setAttribute("markerHeight", "7");
      marker.setAttribute("refX", "10");
      marker.setAttribute("refY", "3.5");
      marker.setAttribute("orient", "auto");
      const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
      polygon.setAttribute("points", "0 0, 10 3.5, 0 7");
      polygon.setAttribute("fill", color);
      marker.appendChild(polygon);
      this.defs!.appendChild(marker);
    }
    return id;
  }

  private attachHandlers(): void {
    if (!this.svg) return;

    if (this.activeTool === "circle" || this.activeTool === "arrow") {
      this.onMouseDown = (e: MouseEvent) => {
        if ((e.target as Element)?.closest?.("[data-chisel]:not([data-chisel=overlay])")) return;
        e.preventDefault();
        this.drawing = true;
        this.startX = e.clientX;
        this.startY = e.clientY;

        if (this.activeTool === "circle") {
          const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
          ellipse.setAttribute("cx", String(e.clientX));
          ellipse.setAttribute("cy", String(e.clientY));
          ellipse.setAttribute("rx", "0");
          ellipse.setAttribute("ry", "0");
          ellipse.setAttribute("fill", "none");
          ellipse.setAttribute("stroke", this.color);
          ellipse.setAttribute("stroke-width", "2");
          this.svg!.appendChild(ellipse);
          this.activeElement = ellipse;
          this.pendingAnnotation = {
            id: genId(),
            tool: "circle",
            color: this.color,
          };
        } else {
          const markerId = this.ensureArrowMarker(this.color);
          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.setAttribute("x1", String(e.clientX));
          line.setAttribute("y1", String(e.clientY));
          line.setAttribute("x2", String(e.clientX));
          line.setAttribute("y2", String(e.clientY));
          line.setAttribute("stroke", this.color);
          line.setAttribute("stroke-width", "2");
          line.setAttribute("marker-end", `url(#${markerId})`);
          this.svg!.appendChild(line);
          this.activeElement = line;
          this.pendingAnnotation = {
            id: genId(),
            tool: "arrow",
            x: e.clientX,
            y: e.clientY,
            color: this.color,
          };
        }
      };

      this.onMouseMove = (e: MouseEvent) => {
        if (!this.drawing || !this.activeElement) return;
        e.preventDefault();

        if (this.activeTool === "circle") {
          const rx = Math.abs(e.clientX - this.startX) / 2;
          const ry = Math.abs(e.clientY - this.startY) / 2;
          const cx = Math.min(this.startX, e.clientX) + rx;
          const cy = Math.min(this.startY, e.clientY) + ry;
          this.activeElement.setAttribute("cx", String(cx));
          this.activeElement.setAttribute("cy", String(cy));
          this.activeElement.setAttribute("rx", String(rx));
          this.activeElement.setAttribute("ry", String(ry));
        } else {
          this.activeElement.setAttribute("x2", String(e.clientX));
          this.activeElement.setAttribute("y2", String(e.clientY));
        }
      };

      this.onMouseUp = (e: MouseEvent) => {
        if (!this.drawing) return;
        this.drawing = false;

        if (this.activeTool === "circle" && this.pendingAnnotation) {
          const x = Math.min(this.startX, e.clientX);
          const y = Math.min(this.startY, e.clientY);
          const w = Math.abs(e.clientX - this.startX);
          const h = Math.abs(e.clientY - this.startY);
          if (w < 5 && h < 5) {
            // Too small — remove
            this.activeElement?.remove();
          } else {
            this.annotations.push({
              ...this.pendingAnnotation,
              x, y, width: w, height: h,
            } as Annotation);
          }
        } else if (this.activeTool === "arrow" && this.pendingAnnotation) {
          const dx = Math.abs(e.clientX - this.startX);
          const dy = Math.abs(e.clientY - this.startY);
          if (dx < 5 && dy < 5) {
            this.activeElement?.remove();
          } else {
            this.annotations.push({
              ...this.pendingAnnotation,
              endX: e.clientX,
              endY: e.clientY,
            } as Annotation);
          }
        }

        this.activeElement = null;
        this.pendingAnnotation = null;
      };

      this.svg.addEventListener("mousedown", this.onMouseDown);
      this.svg.addEventListener("mousemove", this.onMouseMove);
      this.svg.addEventListener("mouseup", this.onMouseUp);
    } else if (this.activeTool === "text") {
      this.onClick = (e: MouseEvent) => {
        if ((e.target as Element)?.closest?.("[data-chisel]:not([data-chisel=overlay])")) return;
        e.preventDefault();
        this.placeTextInput(e.clientX, e.clientY);
      };
      this.svg.addEventListener("click", this.onClick);
    }
  }

  private detachHandlers(): void {
    if (!this.svg) return;
    if (this.onMouseDown) { this.svg.removeEventListener("mousedown", this.onMouseDown); this.onMouseDown = null; }
    if (this.onMouseMove) { this.svg.removeEventListener("mousemove", this.onMouseMove); this.onMouseMove = null; }
    if (this.onMouseUp) { this.svg.removeEventListener("mouseup", this.onMouseUp); this.onMouseUp = null; }
    if (this.onClick) { this.svg.removeEventListener("click", this.onClick); this.onClick = null; }
  }

  private placeTextInput(x: number, y: number): void {
    if (!this.svg) return;
    const fo = document.createElementNS("http://www.w3.org/2000/svg", "foreignObject");
    fo.setAttribute("x", String(x));
    fo.setAttribute("y", String(y));
    fo.setAttribute("width", "300");
    fo.setAttribute("height", "40");

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Type annotation...";
    input.style.cssText = `width:280px;padding:4px 8px;font-size:14px;font-family:system-ui,sans-serif;background:rgba(0,0,0,0.7);color:#fff;border:1px solid ${this.color};border-radius:4px;outline:none;`;

    const color = this.color;

    const finalize = () => {
      const text = input.value.trim();
      fo.remove();
      if (text) {
        // Add SVG text element
        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.setAttribute("x", String(x));
        textEl.setAttribute("y", String(y + 18));
        textEl.setAttribute("fill", color);
        textEl.setAttribute("font-size", "16");
        textEl.setAttribute("font-family", "system-ui, sans-serif");
        textEl.textContent = text;

        // Background rect for readability
        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        this.svg!.appendChild(textEl);
        const bbox = textEl.getBBox();
        bg.setAttribute("x", String(bbox.x - 4));
        bg.setAttribute("y", String(bbox.y - 2));
        bg.setAttribute("width", String(bbox.width + 8));
        bg.setAttribute("height", String(bbox.height + 4));
        bg.setAttribute("fill", "rgba(0,0,0,0.6)");
        bg.setAttribute("rx", "3");
        this.svg!.insertBefore(bg, textEl);

        this.annotations.push({
          id: genId(),
          tool: "text",
          x,
          y,
          text,
          color,
        });
      }
    };

    input.addEventListener("blur", finalize);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        input.value = "";
        input.blur();
      }
    });

    fo.appendChild(input);
    this.svg.appendChild(fo);
    // Must defer focus so the foreignObject is rendered
    requestAnimationFrame(() => input.focus());
  }

  private redraw(): void {
    if (!this.svg) return;
    // Clear all elements except defs
    while (this.svg.lastChild && this.svg.lastChild !== this.defs) {
      this.svg.removeChild(this.svg.lastChild);
    }
    // Re-draw each annotation
    for (const ann of this.annotations) {
      if (ann.tool === "circle" && ann.width != null && ann.height != null) {
        const ellipse = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        const rx = ann.width / 2;
        const ry = ann.height / 2;
        ellipse.setAttribute("cx", String(ann.x + rx));
        ellipse.setAttribute("cy", String(ann.y + ry));
        ellipse.setAttribute("rx", String(rx));
        ellipse.setAttribute("ry", String(ry));
        ellipse.setAttribute("fill", "none");
        ellipse.setAttribute("stroke", ann.color);
        ellipse.setAttribute("stroke-width", "2");
        this.svg.appendChild(ellipse);
      } else if (ann.tool === "arrow" && ann.endX != null && ann.endY != null) {
        const markerId = this.ensureArrowMarker(ann.color);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", String(ann.x));
        line.setAttribute("y1", String(ann.y));
        line.setAttribute("x2", String(ann.endX));
        line.setAttribute("y2", String(ann.endY));
        line.setAttribute("stroke", ann.color);
        line.setAttribute("stroke-width", "2");
        line.setAttribute("marker-end", `url(#${markerId})`);
        this.svg.appendChild(line);
      } else if (ann.tool === "text" && ann.text) {
        const textEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
        textEl.setAttribute("x", String(ann.x));
        textEl.setAttribute("y", String(ann.y + 18));
        textEl.setAttribute("fill", ann.color);
        textEl.setAttribute("font-size", "16");
        textEl.setAttribute("font-family", "system-ui, sans-serif");
        textEl.textContent = ann.text;

        const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        this.svg.appendChild(textEl);
        const bbox = textEl.getBBox();
        bg.setAttribute("x", String(bbox.x - 4));
        bg.setAttribute("y", String(bbox.y - 2));
        bg.setAttribute("width", String(bbox.width + 8));
        bg.setAttribute("height", String(bbox.height + 4));
        bg.setAttribute("fill", "rgba(0,0,0,0.6)");
        bg.setAttribute("rx", "3");
        this.svg.insertBefore(bg, textEl);
      }
    }
  }
}

// ---- Screenshot via SVG foreignObject ----
// Uses the browser's native rendering engine — supports oklab(), oklch(),
// and all modern CSS that html2canvas chokes on.

async function captureWithForeignObject(annotations: Annotation[]): Promise<string> {
  const width = window.innerWidth;
  const height = window.innerHeight;

  // Clone the full document element
  const clone = document.documentElement.cloneNode(true) as HTMLElement;

  // Remove chisel elements from the clone
  clone.querySelectorAll("[data-chisel]").forEach((el) => el.remove());

  // Inline all stylesheets (same-origin only) so the SVG foreignObject renders correctly
  const styles = await collectStyles();

  // Scroll the clone to match current viewport
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;

  // Build SVG with foreignObject
  const xmlns = "http://www.w3.org/1999/xhtml";
  const serialized = new XMLSerializer().serializeToString(clone);

  // Build annotation SVG elements
  let annotationsSvg = "";
  for (const ann of annotations) {
    if (ann.tool === "circle" && ann.width != null && ann.height != null) {
      const cx = ann.x + ann.width / 2;
      const cy = ann.y + ann.height / 2;
      const rx = ann.width / 2;
      const ry = ann.height / 2;
      annotationsSvg += `<ellipse cx="${cx}" cy="${cy}" rx="${Math.abs(rx)}" ry="${Math.abs(ry)}" fill="none" stroke="${ann.color}" stroke-width="3"/>`;
    } else if (ann.tool === "arrow" && ann.endX != null && ann.endY != null) {
      const angle = Math.atan2(ann.endY - ann.y, ann.endX - ann.x);
      const headLen = 12;
      const x2 = ann.endX, y2 = ann.endY;
      const ax = x2 - headLen * Math.cos(angle - Math.PI / 6);
      const ay = y2 - headLen * Math.sin(angle - Math.PI / 6);
      const bx = x2 - headLen * Math.cos(angle + Math.PI / 6);
      const by = y2 - headLen * Math.sin(angle + Math.PI / 6);
      annotationsSvg += `<line x1="${ann.x}" y1="${ann.y}" x2="${x2}" y2="${y2}" stroke="${ann.color}" stroke-width="3"/>`;
      annotationsSvg += `<polygon points="${x2},${y2} ${ax},${ay} ${bx},${by}" fill="${ann.color}"/>`;
    } else if (ann.tool === "text" && ann.text) {
      const escaped = ann.text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      annotationsSvg += `<rect x="${ann.x - 4}" y="${ann.y - 2}" width="${ann.text.length * 9 + 8}" height="22" fill="rgba(0,0,0,0.6)" rx="3"/>`;
      annotationsSvg += `<text x="${ann.x}" y="${ann.y + 16}" fill="${ann.color}" font-size="16" font-family="system-ui, sans-serif">${escaped}</text>`;
    }
  }

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><style type="text/css">${escapeStyleForSvg(styles)}</style></defs>
    <foreignObject width="${width}" height="${height}" x="0" y="0">
      <div xmlns="${xmlns}" style="width:${width}px;height:${height}px;overflow:hidden;">
        <div style="margin-top:${-scrollY}px;margin-left:${-scrollX}px;">
          ${serialized}
        </div>
      </div>
    </foreignObject>
    ${annotationsSvg}
  </svg>`;

  const svgBlob = new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to render screenshot"));
    };
    img.src = url;
  });
}

async function collectStyles(): Promise<string> {
  const parts: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const rules = sheet.cssRules;
      for (const rule of Array.from(rules)) {
        parts.push(rule.cssText);
      }
    } catch {
      // Cross-origin stylesheet — try fetching it
      if (sheet.href) {
        try {
          const resp = await fetch(sheet.href);
          if (resp.ok) parts.push(await resp.text());
        } catch {
          // Skip inaccessible stylesheets
        }
      }
    }
  }
  return parts.join("\n");
}

function escapeStyleForSvg(css: string): string {
  // CDATA-wrap to avoid XML parsing issues with CSS special chars
  return `<![CDATA[\n${css}\n]]>`;
}
