import type { Config } from "./config.ts";

/** A menu entry, structurally compatible with Electron's menu templates. */
export type TrayItem = {
  label?: string;
  type?: "normal" | "separator" | "checkbox" | "radio";
  enabled?: boolean;
  checked?: boolean;
  click?: () => void;
  submenu?: TrayItem[];
};

export type SystemTray = {
  setMenu(items: TrayItem[]): void;
  onClick(listener: () => void): void;
  destroy(): void;
};

type TrayState = {
  theme: Config["theme"];
  clickThrough: boolean;
  clickThroughAvailable: boolean;
  canCopyAnswer: boolean;
  canRetry: boolean;
  canCancel: boolean;
};

type TrayActions = {
  show(): void;
  setTheme(theme: Config["theme"]): void;
  setClickThrough(enabled: boolean): void;
  copyAnswer(): void;
  retry(): void;
  cancel(): void;
  openSettings(): void;
  quit(): void;
};

export function trayMenu(state: TrayState, actions: TrayActions): TrayItem[] {
  return [
    { label: "Show overlay", click: actions.show },
    { label: "Theme", submenu: [
      { label: "Original", type: "radio", checked: state.theme === "original", click: () => actions.setTheme("original") },
      { label: "WoWhead", type: "radio", checked: state.theme === "wowhead", click: () => actions.setTheme("wowhead") },
    ] },
    {
      label: "Click-through", type: "checkbox", checked: state.clickThrough, enabled: state.clickThroughAvailable,
      click: () => actions.setClickThrough(!state.clickThrough),
    },
    { label: "Copy answer", enabled: state.canCopyAnswer, click: actions.copyAnswer },
    { label: "Retry last question", enabled: state.canRetry, click: actions.retry },
    { label: "Cancel question", enabled: state.canCancel, click: actions.cancel },
    { type: "separator" },
    { label: "Open settings", click: actions.openSettings },
    { label: "Quit", click: actions.quit },
  ];
}
