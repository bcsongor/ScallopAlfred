import { BrowserWindow, screen } from "electron";
import { join } from "node:path";
import { createBrowse, type BrowseState } from "./browse.ts";
import { heightRange, widthRange, type Config } from "./config.ts";
import { fromOverlay, overlayRequests, type FromOverlay, type OverlayRequests, type ToOverlay } from "./ipc.ts";

export const iconPath = join(import.meta.dirname, "..", "assets", "scallop.jpg");

/** Creates the always-on-top overlay window. It never takes focus from the game on its own. */
export function createOverlay(config: Config, onBrowseState: (state: BrowseState) => void) {
  const window = createWindow(config);
  const browse = createBrowse(window, onBrowseState);
  let dismissed = false;

  function keepOnTop(): void {
    if (!window.isAlwaysOnTop()) setTopmost(window);
  }

  function listen<K extends keyof FromOverlay>(channel: K, listener: (message: FromOverlay[K]) => void): void {
    const schema = fromOverlay[channel];
    window.webContents.ipc.on(channel, (_event, message: unknown) => {
      const parsed = schema.safeParse(message);
      if (parsed.success) listener(parsed.data);
    });
  }

  function handle<K extends keyof OverlayRequests>(
    channel: K,
    handler: (message: OverlayRequests[K]["message"]) => Promise<OverlayRequests[K]["result"]>,
  ): void {
    const schema = overlayRequests[channel];
    window.webContents.ipc.handle(channel, (_event, message: unknown) => {
      const parsed = schema.safeParse(message);
      return parsed.success ? handler(parsed.data) : undefined;
    });
  }

  // Windows can drop the native topmost flag from outside the app without any event, leaving the overlay behind WoW.
  const topmostCheck = setInterval(() => {
    if (window.isVisible()) keepOnTop();
  }, 1000);
  let fadeCheck: ReturnType<typeof setInterval> | undefined;
  let opacity = 1;
  window.on("closed", () => {
    clearInterval(topmostCheck);
    clearInterval(fadeCheck);
  });

  function pointerInside(): boolean {
    const pointer = screen.getCursorScreenPoint();
    const bounds = window.getBounds();
    return pointer.x >= bounds.x && pointer.x < bounds.x + bounds.width && pointer.y >= bounds.y && pointer.y < bounds.y + bounds.height;
  }

  return {
    listen,
    handle,
    browse,
    load: () => window.loadFile(join(import.meta.dirname, "overlay.html")),
    send<K extends keyof ToOverlay>(channel: K, message: ToOverlay[K]): void {
      window.webContents.send(channel, message);
    },
    isDismissed: () => dismissed,
    /** Shows a hidden overlay without taking focus or reordering an overlay that is already visible. */
    reveal(): void {
      dismissed = false;
      if (!window.isVisible()) window.showInactive();
      // Check after showing: a visible window may still have lost its topmost flag.
      keepOnTop();
    },
    /** Restores and raises the overlay, even when Electron reports it as visible behind the game. */
    raise(): void {
      dismissed = false;
      if (window.isMinimized()) window.restore();
      if (!window.isVisible()) window.showInactive();
      keepOnTop();
      window.moveTop();
    },
    hide(): void {
      dismissed = true;
      window.hide();
      window.setFocusable(false);
      window.setSkipTaskbar(true);
    },
    /** Takes the keyboard from the game. Nothing hands it back, so the player clicks into WoW. */
    focus(): void {
      window.setFocusable(true);
      // Electron changes taskbar visibility with focusability on Windows.
      window.setSkipTaskbar(true);
      window.focus();
    },
    /** Gives the keyboard up again without hiding, so the overlay stops competing with the game. */
    releaseFocus(): void {
      window.setFocusable(false);
      window.setSkipTaskbar(true);
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
    /**
     * Returns the width and the position after clamping the width to the settings range and the
     * space left of the window. The window grows leftwards, keeping its right edge where it is, so
     * widening never pushes the overlay across the game's minimap.
     */
    setWidth(width: number): { width: number; x: number } {
      const bounds = window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const right = bounds.x + bounds.width;
      const next = Math.min(Math.max(widthRange.min, Math.round(width)), widthRange.max, right - area.x);
      window.setBounds({ ...bounds, x: right - next, width: next });
      return { width: next, x: right - next };
    },
    /**
     * Fades the whole window, the browse tab's view included, while the pointer is elsewhere.
     * The page loses track of the pointer once it moves onto that view, so the main process
     * watches the pointer itself, and only while fading is on.
     */
    setFade(enabled: boolean): void {
      clearInterval(fadeCheck);
      fadeCheck = undefined;
      opacity = 1;
      window.setOpacity(opacity);
      if (!enabled) return;
      fadeCheck = setInterval(() => {
        if (!window.isVisible()) return;
        const target = pointerInside() ? 1 : fadedOpacity;
        if (opacity === target) return;
        opacity = opacity < target ? Math.min(target, opacity + fadeStep) : Math.max(target, opacity - fadeStep);
        window.setOpacity(opacity);
      }, fadeTickMs);
    },
    /** Returns the position after clamping it so the whole window stays on the display it lands on. */
    moveTo(x: number, y: number): { x: number; y: number } {
      const bounds = window.getBounds();
      const area = screen.getDisplayMatching({ ...bounds, x: Math.round(x), y: Math.round(y) }).workArea;
      const next = {
        x: Math.max(area.x, Math.min(Math.round(x), area.x + area.width - bounds.width)),
        y: Math.max(area.y, Math.min(Math.round(y), area.y + area.height - bounds.height)),
      };
      window.setBounds({ ...bounds, ...next });
      return next;
    },
  };
}

// Electron's default "floating" level does not always make the window topmost on Windows. "screen-saver" does.
function setTopmost(window: BrowserWindow): void {
  window.setAlwaysOnTop(true, "screen-saver");
}

// How far the overlay fades while the pointer is elsewhere, and how much each tick moves it, so it
// eases in and out over 50 ms.
const fadedOpacity = 0.6;
const fadeStep = 0.2;
const fadeTickMs = 25;

// Keeps the default position clear of WoW's minimap and objective tracker in the top-right corner.
const rightEdgeClearance = 420;

function createWindow(config: Config): BrowserWindow {
  const area = screen.getPrimaryDisplay().workArea;
  const requested = {
    x: config.x ?? area.x + area.width - config.width - rightEdgeClearance,
    y: config.y ?? area.y + 80,
    width: config.width,
    height: config.height,
  };
  const display = screen.getDisplayMatching(requested).workArea;
  const width = Math.min(config.width, display.width);
  const height = Math.min(config.height, display.height);
  const window = new BrowserWindow({
    width, height, icon: iconPath,
    x: Math.max(display.x, Math.min(requested.x, display.x + display.width - width)),
    y: Math.max(display.y, Math.min(requested.y, display.y + display.height - height)),
    show: false, frame: false, transparent: true, resizable: false,
    focusable: false, skipTaskbar: true,
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  setTopmost(window);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  if (process.platform === "darwin") window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  return window;
}
