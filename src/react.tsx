import { useEffect, useRef } from "react";
import { DevPanel } from "./panel";
import type { PanelOptions } from "./types";

export type { PanelOptions } from "./types";

export function ChiselPanel(props: PanelOptions = {}) {
  const ref = useRef<DevPanel | null>(null);
  useEffect(() => {
    ref.current = new DevPanel(props);
    ref.current.mount();
    return () => ref.current?.unmount();
  }, []);
  return null;
}
