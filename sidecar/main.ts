import { app, clipboard, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { startApp } from "./app.ts";
import { createCodex } from "./codex.ts";
import { errorMessage } from "./errors.ts";
import { iconPath } from "./overlay.ts";
import type { SystemTray } from "./tray.ts";

app.setName("Scallop Alfred");
// Chromium's visibility animation can flash transparent windows on Windows.
if (process.platform === "win32") app.commandLine.appendSwitch("wm-window-animations-disabled");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady()
    .then(() => startApp({
      userData: app.getPath("userData"),
      clipboard,
      tray: createTray(),
      createCodex,
      fetch,
      openExternal: url => shell.openExternal(url),
    }))
    .catch((error: unknown) => {
      dialog.showErrorBox("Scallop Alfred", errorMessage(error));
      app.quit();
    });
}

function createTray(): SystemTray {
  const tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 }));
  tray.setToolTip("Scallop Alfred");
  return {
    setMenu: items => tray.setContextMenu(Menu.buildFromTemplate(items)),
    onClick: listener => { tray.on("click", listener); },
    destroy: () => tray.destroy(),
  };
}
