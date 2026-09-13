import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { heightRange, type Config } from "./config.ts";
import { fromOverlay, type FromOverlay, type ToOverlay } from "./ipc.ts";

/**
 * Creates the always-on-top overlay window. It never takes focus from the game on its own and passes
 * mouse input through, except over controls or while the player edits a follow-up.
 */
export function createOverlay(config: Config, icon: string) {
  const window = createWindow(config, icon);
  let clickThrough = process.platform !== "linux";
  let overControl = false;
  let editing = false;
  let dismissed = false;

  // Forward mouse movement so controls and links stay clickable above the game.
  function updateMouseEvents(): void {
    window.setIgnoreMouseEvents(clickThrough && !overControl && !editing, { forward: true });
  }

  function listen<K extends keyof FromOverlay>(channel: K, listener: (message: FromOverlay[K]) => void): void {
    const schema = fromOverlay[channel];
    window.webContents.ipc.on(channel, (_event, message: unknown) => {
      const parsed = schema.safeParse(message);
      if (parsed.success) listener(parsed.data);
    });
  }

  listen("hover-control", hovered => {
    overControl = hovered;
    updateMouseEvents();
  });
  updateMouseEvents();

  return {
    window,
    listen,
    load: () => window.loadFile(join(import.meta.dirname, "overlay.html")),
    send<K extends keyof ToOverlay>(channel: K, message: ToOverlay[K]): void {
      window.webContents.send(channel, message);
    },
    isDismissed: () => dismissed,
    isClickThrough: () => clickThrough,
    setClickThrough(enabled: boolean): void {
      clickThrough = enabled;
      updateMouseEvents();
    },
    /** Shows a hidden overlay without taking focus or reordering an overlay that is already visible. */
    reveal(): void {
      dismissed = false;
      if (!window.isVisible()) window.showInactive();
      // Check after showing: a visible window may still have lost its topmost flag.
      if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true);
    },
    /** Restores and raises the overlay, even when Electron reports it as visible behind the game. */
    raise(): void {
      dismissed = false;
      if (window.isMinimized()) window.restore();
      if (!window.isVisible()) window.showInactive();
      if (!window.isAlwaysOnTop()) window.setAlwaysOnTop(true);
      window.moveTop();
    },
    hide(): void {
      dismissed = true;
      window.hide();
      window.setFocusable(false);
      window.setSkipTaskbar(true);
    },
    /** Takes keyboard focus while the follow-up editor is open. Closing it leaves focus alone. */
    setEditing(enabled: boolean): void {
      editing = enabled;
      updateMouseEvents();
      if (!enabled) return;
      window.setFocusable(true);
      // Electron changes taskbar visibility with focusability on Windows.
      window.setSkipTaskbar(true);
      window.focus();
    },
    /** Returns the height after clamping it to the settings range and the space below the window. */
    setHeight(height: number): number {
      const bounds = window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const next = Math.min(Math.max(heightRange.min, Math.round(height)), heightRange.max, area.y + area.height - bounds.y);
      // setSize can retain the previous minimum height on a non-resizable window.
      window.setBounds({ ...bounds, height: next });
      return next;
    },
  };
}

function createWindow(config: Config, icon: string): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const requested = {
    x: config.x ?? area.x + area.width - config.width - 24,
    y: config.y ?? area.y + 80,
    width: config.width,
    height: config.height,
  };
  const display = screen.getDisplayMatching(requested).workArea;
  const width = Math.min(config.width, display.width);
  const height = Math.min(config.height, display.height);
  const window = new BrowserWindow({
    width, height, icon,
    x: Math.max(display.x, Math.min(requested.x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(requested.y, display.y + display.height - height)),
    show: false, frame: false, transparent: true, resizable: false,
    focusable: false, alwaysOnTop: true, skipTaskbar: true,
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return window;
}
