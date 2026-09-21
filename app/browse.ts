import { app, session, WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { browseUrl } from "./address.ts";
import { fullscreenShim } from "./fullscreen.ts";

/** Cookies and logins for the browse tab live here, under the app's user data, so sites stay signed in. */
const partition = "persist:browse";

export type BrowseState = { url: string; canGoBack: boolean; canGoForward: boolean };

/** Where the browse pane sits in the window, as the overlay page measured it. */
export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Chrome's reduced Android user agent, built from the Chromium version Electron ships. The pane is
 * about as wide as a phone, so sites are asked for their mobile layout, and it names no Electron.
 */
function mobileUserAgent(): string {
  const chrome = /Chrome\/(\d+)/.exec(app.userAgentFallback)?.[1] ?? "140";
  return `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome}.0.0.0 Mobile Safari/537.36`;
}

/**
 * Dark, no scrollbar and a working fullscreen button, applied to a document once it exists. A
 * devtools command sent before the target has a document is dropped outright, which is why this
 * runs for every document rather than once, and it is never waited on, because `sendCommand` does
 * not answer while another devtools client holds the same target. The dark preference needs the
 * protocol because `nativeTheme.themeSource` does not reach a renderer's `prefers-color-scheme`;
 * the rest is plain script. None of it is worth failing over, so it all gives up quietly.
 */
function preparePage(contents: WebContents): void {
  void contents.debugger
    .sendCommand("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] })
    .catch(() => undefined);
  // Hiding the root scroller through the style property, because a strict `style-src` blocks a
  // stylesheet. The devtools command for this reaches scrollbars inside a page too, but it does not
  // reliably apply, and the root one is what shows.
  const hideScrollbar = 'document.documentElement.style.setProperty("scrollbar-width", "none", "important")';
  for (const script of [hideScrollbar, fullscreenShim]) {
    void contents.executeJavaScript(script).catch(() => undefined);
  }
}

/**
 * The browse tab's web view: a real browser in its own session, layered over the overlay page.
 * It is created on first use, so an overlay that only ever answers questions never pays for it.
 */
export function createBrowse(window: BrowserWindow, onState: (state: BrowseState) => void) {
  let view: WebContentsView | undefined;
  let bounds: Bounds | undefined;
  let attached = false;

  function report(): void {
    const contents = view?.webContents;
    onState(contents
      ? { url: contents.getURL(), canGoBack: contents.navigationHistory.canGoBack(), canGoForward: contents.navigationHistory.canGoForward() }
      : { url: "", canGoBack: false, canGoForward: false });
  }

  function create(): WebContentsView {
    const browsing = session.fromPartition(partition);
    browsing.setUserAgent(mobileUserAgent());
    // Chromium keeps sending desktop client hints, which sites trust over the user agent string.
    // The colour scheme goes with them, for pages that pick their theme on the server.
    browsing.webRequest.onBeforeSendHeaders((details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          "Sec-CH-UA-Mobile": "?1",
          "Sec-CH-UA-Platform": '"Android"',
          "Sec-CH-Prefers-Color-Scheme": "dark",
        },
      });
    });
    // The overlay never needs the camera, microphone, location or notifications, so nothing gets to ask.
    browsing.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    browsing.setPermissionCheckHandler(() => false);
    const created = new WebContentsView({
      webPreferences: { session: browsing, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false },
    });
    // Pages paint over the overlay's panel, so the view needs its own opaque background. Dark,
    // so loading a page over a dark overlay doesn't flash white.
    created.setBackgroundColor("#000000");
    // There is one browsing pane, so a link that asks for a new window loads in place instead.
    created.webContents.setWindowOpenHandler(({ url }) => {
      const target = browseUrl(url);
      if (target) void created.webContents.loadURL(target).catch(() => report());
      return { action: "deny" };
    });
    try {
      created.webContents.debugger.attach("1.3");
    } catch {
      // Only the dark preference rides on this, so the pane still works without it.
    }
    // Both events, because the first gets the page ready as early as possible and the second
    // covers a document that was not ready at the first. Applying twice is harmless.
    created.webContents.on("dom-ready", () => preparePage(created.webContents));
    created.webContents.on("did-finish-load", () => preparePage(created.webContents));
    // Every navigation moves the address bar and its buttons.
    created.webContents.on("did-navigate", report);
    created.webContents.on("did-navigate-in-page", report);
    created.webContents.on("did-fail-load", report);
    return created;
  }

  function place(): void {
    if (!view || !bounds) return;
    view.setBounds({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)),
    });
  }

  return {
    /** Loads `url` in the view, creating it the first time the player opens the browse tab. */
    show(url: string): void {
      const created = (view ??= create());
      if (!attached) {
        window.contentView.addChildView(created);
        attached = true;
      }
      place();
      // The stored page goes through the same check as a typed one, so a hand-edited setting
      // cannot point the pane at the local disk either.
      const target = browseUrl(url);
      if (target && !created.webContents.getURL()) void created.webContents.loadURL(target).catch(() => report());
      report();
    },
    /** Takes the view off the window, leaving the page loaded for the next visit. */
    hide(): void {
      if (view && attached) window.contentView.removeChildView(view);
      attached = false;
    },
    /** The overlay page owns the layout, so it reports where the pane ended up. */
    setBounds(next: Bounds): void {
      bounds = next;
      place();
    },
    navigate(target: string): void {
      const url = browseUrl(target);
      if (url && view) void view.webContents.loadURL(url).catch(() => report());
    },
    back(): void {
      view?.webContents.navigationHistory.goBack();
    },
    forward(): void {
      view?.webContents.navigationHistory.goForward();
    },
    reload(): void {
      view?.webContents.reload();
    },
    /** The page on screen, saved so the tab reopens where the player left it. */
    url: (): string | undefined => view?.webContents.getURL() || undefined,
    destroy(): void {
      view?.webContents.close();
      view = undefined;
      attached = false;
    },
  };
}
