import type { Session } from "../../app/codex.ts";
import type { WoWRequest } from "../../app/protocol.ts";
import type { TrayItem } from "../../app/tray.ts";

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
