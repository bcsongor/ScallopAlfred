# Scallop Alfred design

WoW addons can't reach the network or the file system. The clipboard is the one channel out. The addon builds a JSON request and the player copies it. An Electron app picks it up, runs Codex CLI and shows the answer in an overlay. The app never sends input to WoW, injects code or draws inside the game.

## Files

- `Core.lua` holds the helpers for reading game values safely. It loads first.
- `Professions.lua` and `Talents.lua` read profession and talent snapshots.
- `ScallopAlfred.lua` owns the dialog, builds requests and encodes them as JSON.
- `Bindings.xml` defines the keybind. WoW loads it by file name, and listing it in the TOC would run it through the wrong parser. The binding fires on key release so the keystroke can't land in the question box.
- `sidecar/main.ts` wires the app together: clipboard polling, the request lifecycle and the tray menu.
- `sidecar/overlay.ts` owns the window: focus, click-through, raising and resizing.
- `sidecar/ipc.ts` types every message between the main process and the overlay, and validates the ones coming from the overlay.
- `sidecar/preload.cjs` renders `overlay.html`.
- `sidecar/protocol.ts` validates clipboard requests. `codex.ts` runs Codex with `prompt.md`, `history.ts` stores threads, `favicons.ts` fetches link icons, `config.ts` loads settings and `markdown.ts` renders answers.

Electron runs the TypeScript directly with `--experimental-strip-types`. There is no build step.

## Addon

The addon reads game data only when the player submits a question outside combat. It uses no timers, frame polling, inspect requests, auction scans or addon messages.

Midnight marks some API values as secret. `addon.Public` drops them without looking inside, and `addon.Read` also treats a failing API call as missing data. Missing data never blocks a question and is never retried.

Subjects come from the hovered tooltip's original hyperlink when there is one, so item variants and link parameters survive. Otherwise the addon falls back to the tooltip's item, spell, quest, currency or achievement ID. Shift-clicked links arrive through a hook on `ChatFrameUtil.InsertLink` that only acts while the question box has focus.

Scans have fixed caps: 80 tooltip lines, 8 subjects, 256 child skill lines, 128 paths per profession tree, 256 talent nodes and 128 selected talents. Blizzard's [addon policy](https://eu.forums.blizzard.com/en/wow/t/wow-user-interface-add-on-development-policy/1642) forbids hurting performance but publishes no read quota. The caps are our own choice, not an approved allowance.

Profession specialisations only load for the Professions topic. A child skill line must match both the parent profession ID and the expansion-specific name, so an older expansion's tree never stands in for missing current data. Path ranks subtract the unlock tier to match [Blizzard's UI](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_Professions/Blizzard_ProfessionsSpecializationsTemplates.lua).

TSM prices come from `TSM_API.GetCustomPriceValue` with `DBMinBuyout`, `DBRegionMarketAvg`, `DBRegionSaleAvg`, `DBRegionSaleRate` and `VendorSell`, keyed by TSM's item string for the original link. Only subjects get prices, not equipped items. See [TSM's price sources](https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean).

## Clipboard protocol

A request is one line, `SCALLOPALFRED:` followed by JSON:

```json
{
  "id": "unique-request-id",
  "context": "thread-id",
  "thread": "new",
  "question": "Is it an upgrade?",
  "category": "gear",
  "player": { "class": "Druid", "spec": "Restoration", "level": 90 },
  "gameVersion": "12.1.0",
  "subjects": [{ "type": "item", "name": "Example ring", "link": "item:123", "tooltip": ["Tooltip text"] }],
  "equipped": []
}
```

`id` is new for every request. `context` names the thread a request started, and the addon makes a fresh one for each question. The addon always sends `thread: "new"`. Overlay follow-ups reuse the stored request with `thread: "continue"`, a new `id` and the new question.

The optional `equipped`, `professions`, `talents` and per-subject `tsm` fields are snapshots. Money is per-item copper, and `capturedAt` is the Unix time in seconds when the addon read the data, not when TSM last refreshed. `protocol.ts` defines every field and limit. A request from a mismatched addon fails validation, so update the addon and app together.

## Desktop app

### Clipboard polling

The app checks the clipboard every 250 ms. It ignores what was there at launch and anything that doesn't parse as a request. Polling pauses while Codex runs or the follow-up editor is open. When it resumes it only sees the latest clipboard contents, so copies made in between are dropped.

### Codex

Each run is `codex exec --json` in an empty workspace, with a read-only sandbox, approvals off, the shell tool off, live web search on and user config ignored. The app strips API key variables from the environment so Codex uses the player's login. The prompt goes over stdin and never through a shell. On Windows the app resolves npm's shim to the native `codex.exe` for the same reason.

From the JSONL stream the app reads `thread.started`, the last `agent_message` and `turn.completed`. Only a completed turn updates a thread's session. A follow-up resumes with `exec resume` only when its context matches that session, so a skipped or failed question can't resume the wrong thread. Codex keeps its own session files, and resume needs them.

### Overlay window

The window is transparent, frameless, always on top and not focusable, so it never takes the keyboard from WoW. Several quirks of Electron on Windows shape `overlay.ts`:

- Click-through uses `setIgnoreMouseEvents` with forwarding. The preload reports when the pointer is over a control or scrollable content, and the main process switches click-through off there. Linux has no forwarding, so the overlay stays clickable.
- Something outside the app can clear the native topmost flag without Electron emitting an event, which leaves the overlay behind WoW. While the overlay is visible, it checks the flag every second and restores it.
- New clipboard questions and the tray call `raise`, which also calls `moveTop`. Other updates only show a hidden window and restore the topmost flag, leaving focus and window order alone.
- The follow-up editor makes the window focusable and focuses it. Windows ties taskbar visibility to focusability, so the app reapplies `setSkipTaskbar(true)`. Closing the editor doesn't hand focus back, so the player clicks into WoW. Hiding makes the window non-focusable again.
- Chromium's window animations are off on Windows because they flash the transparent window.
- Native resizing is off. The drag handle sends heights to the main process, which clamps them to 320 to 900 pixels and the space below the window.

### Rendering

The page runs no scripts of its own (`script-src 'none'`). The sandboxed, context-isolated preload renders it. markdown-it turns answers into HTML in the main process with raw HTML and images disabled and only HTTP(S) links allowed. Clicking a link opens it in the default browser after a second URL check. The overlay never navigates.

Favicons are fetched in the main process from Google's favicon service by hostname only, with a 5 second timeout and a 256 KiB cap. They are re-encoded as 16 pixel PNGs and cached under hashed file names. Image URLs from the model are never loaded.

### History

Each thread is one SQLite row holding a JSON snapshot of its turns, the request with its game data and the last good Codex session. The app saves the row before a run starts and again when it ends. On startup, replies still marked as thinking become errors the player can retry. Lists sort by row ID, so new replies don't reorder threads.

Archiving sets `archived_at`. Archived threads are read-only, can't be found by context, and are never deleted. The overlay lists the latest 10.

### Settings

Settings live in Electron's user data folder, not the addon folder, which may sit under Program Files. Theme and height changes write `settings.json` through one queue, so saving both at once can't lose either. Other settings apply on restart.

## Limits

Only Windows has been tested. macOS should work, and Linux depends on the window manager. There is no installer, auto-updater or answer streaming. The tests mock the WoW API, so tooltip capture and copying still need checking in the game.
