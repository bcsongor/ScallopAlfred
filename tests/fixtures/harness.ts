import type { Session } from "../../sidecar/codex.ts";
import type { WoWRequest } from "../../sidecar/protocol.ts";
import type { TrayItem } from "../../sidecar/tray.ts";

export type CodexCall = { request: WoWRequest; session?: Session };

/** State the desktop fixture shares with tests, which read it through Playwright's `evaluate`. */
type Harness = {
  clipboard: string;
  codexCalls: CodexCall[];
  iconRequests: string[];
  openedUrls: string[];
  windowOperations: string[];
  ignoresMouse: boolean;
  skipsTaskbar: boolean;
  trayItem: (labels: string[]) => TrayItem;
  clickTrayIcon: () => void;
  createFavicons: () => (target: unknown) => Promise<string | undefined>;
};

declare global {
  var harness: Harness;
}
