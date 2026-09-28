// Launches Electron without ELECTRON_RUN_AS_NODE. Electron-based hosts (VS Code, T3 Code)
// set it for their terminals, and it makes Electron run as plain Node, so importing
// anything from "electron" fails.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

// Outside Electron, the "electron" package exports the path to its binary.
const electronPath: string = createRequire(import.meta.url)("electron");
const { ELECTRON_RUN_AS_NODE: _, ...env } = process.env;

spawn(electronPath, ["--experimental-strip-types", "."], { stdio: "inherit", env })
  .on("exit", (code) => process.exit(code ?? 1));
