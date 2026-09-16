import type { Session } from "../../app/codex.ts";
import type { LinkIcon } from "../../app/icons.ts";
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
  skipsTaskbar: boolean;
  stream?: { update: (text: string) => void; activity: (text: string) => void; finish: () => void };
  trayItem: (labels: string[]) => TrayItem;
  clickTrayIcon: () => void;
  createIcons: () => (target: unknown) => Promise<LinkIcon | undefined>;
};

declare global {
  var harness: Harness;
}
