# Scallop Alfred design

WoW addons can't reach the network or the file system. The clipboard is the one channel out. The addon builds a JSON request and the player copies it. An Electron app picks it up, runs Codex CLI and shows the answer in an overlay. The app never sends input to WoW, injects code or draws inside the game.

## Files

- `Core.lua` holds the helpers for reading game values safely. It loads first.
- `Professions.lua` and `Talents.lua` read profession and talent snapshots.
- `Inventory.lua` and `Recipes.lua` read inventory and recipe snapshots.
- `ScallopAlfred.lua` owns the dialog, builds requests and encodes them as JSON.
- `Bindings.xml` defines the keybind. WoW loads it by file name, and listing it in the TOC would run it through the wrong parser. The binding fires on key release so the keystroke can't land in the question box.
- `app/main.ts` is the Electron entry point. It creates the real tray and passes it, the clipboard, Codex, `fetch` and the browser opener to `app.ts`.
- `app/app.ts` wires the modules together and owns the app's state: what the overlay shows, the running request and the follow-up editor. The clipboard, tray, Codex, network and browser arrive as ports, so tests run the real app with fakes. Electron's own APIs are imported directly.
- `app/threads.ts` holds the pure thread logic: starting and finishing turns, and what the overlay shows for a view.
- `app/clipboard.ts` watches the clipboard for requests, and `app/tray.ts` builds the tray menu from the app's state.
- `app/overlay.ts` owns the window: focus, raising and resizing.
- `app/ipc.ts` types every message between the main process and the overlay, and validates the ones coming from the overlay.
- `app/preload.cjs` renders `overlay.html`, which `overlay.css` styles.
- `app/protocol.ts` validates clipboard requests. `codex.ts` runs Codex with `prompt.md` and names threads, `history.ts` stores threads, `icons.ts` resolves link icons, `config.ts` loads and saves settings and `markdown.ts` renders answers.
- `app/codex-events.ts` validates App Server notifications and updates the active answer with a pure reducer.
- `app/codex-connection.ts` routes RPC responses and notifications, and owns process cleanup.

Electron runs the TypeScript directly with `--experimental-strip-types`. There is no build step.

## Addon

The addon reads game data only when the player submits a question outside combat. It uses no timers, frame polling, inspect requests, auction scans or addon messages.

Midnight marks some API values as secret. `addon.Public` drops them without looking inside, and `addon.Read` also treats a failing API call as missing data. Missing data never blocks a question and is never retried. A secret target GUID hides the NPC preset and adds a menu hint to type the creature's name in a custom question.

Subjects come from the hovered tooltip's original hyperlink when there is one, so item variants and link parameters survive. Otherwise the addon falls back to the tooltip's item, spell, quest, currency or achievement ID. With nothing hovered, a targeted NPC replaces the topics with a question about it, as an `npc:<id>` subject with the ID taken from its GUID. Quest log entries and map pins build their tooltips line by line, so for those it reads `questID` from the tooltip's owner. Shift-clicked links arrive through a hook on `ChatFrameUtil.InsertLink` that only acts while the question box has focus. The `/q` slash command, or `/alfred`, builds a follow-up request from the chat line instead, with its links as subjects and no hovered subject.

Scans have fixed caps: 80 tooltip lines, 8 subjects, 256 child skill lines, 128 paths per profession tree, 256 talent nodes, 128 selected talents, 600 inventory entries after grouping, 200 recipes and 12 reagent slots per recipe. Blizzard's [addon policy](https://eu.forums.blizzard.com/en/wow/t/wow-user-interface-add-on-development-policy/1642) forbids hurting performance but publishes no read quota. The caps are our own choice, not an approved allowance.

Every request carries each profession's skill lines for all expansions, so legacy farming questions see those skills. Profession specialisations only load for the Professions and Make gold topics. A child skill line must match both the parent profession ID and the expansion-specific name, so an older expansion's tree never stands in for missing current data. Path ranks subtract the unlock tier to match [Blizzard's UI](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_Professions/Blizzard_ProfessionsSpecializationsTemplates.lua).

Make gold also reads gold on hand and every stack the player can see. Bags come from `C_Container`; bank and Warband bank tabs return no slots while their windows are closed, so the request records whether each was included. Stacks are grouped by item link, with a count per location, a soulbound flag and TSM's auction and mail counts. Recipes come from `C_TradeSkillUI` for the open profession only, learned ones only, with their skill-ups, whether they are craftable now, the output item and the basic reagents. Linked, guild and NPC crafting windows are skipped. No profession window open means no recipes, and the player opens one and asks again. Every read still happens once on submit.

TSM prices come from `TSM_API.GetCustomPriceValue` with `DBMinBuyout`, `DBMarket`, `DBRegionMarketAvg`, `DBRegionSaleAvg`, `DBRegionSaleRate`, `VendorSell`, `Destroy` and `Crafting`, keyed by TSM's item string for the original link. Subjects, inventory stacks and recipe outputs get that set, reagents only market prices, and equipped items none. See [TSM's price sources](https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean).

## Clipboard protocol

A request is one line, `SCALLOPALFRED:` followed by JSON:

```json
{
  "id": "unique-request-id",
  "context": "thread-id",
  "thread": "new",
  "question": "Is it an upgrade?",
  "category": "gear",
  "player": { "class": "Druid", "spec": "Restoration", "level": 90, "itemLevel": 310 },
  "gameVersion": "12.1.0",
  "subjects": [{ "type": "item", "name": "Example ring", "link": "item:123", "tooltip": ["Tooltip text"] }],
  "equipped": []
}
```

`id` is new for every request. `context` names the thread a request started, and the addon makes a fresh one for each question. The addon sends `thread: "new"`, or `thread: "followup"` from `/q`. The app turns a follow-up into `continue` for the thread on screen, with that thread's context, or into `new` when nothing can be continued. Overlay follow-ups reuse the stored request with `thread: "continue"`, a new `id` and the new question. A thread keeps the title of its first request.

The optional `equipped`, `professions`, `talents`, `inventory`, `recipes` and per-subject `tsm` fields are snapshots, so follow-ups reuse them. `inventory` carries the player's copper and whether the bank and Warband bank were readable; `recipes` carries the open profession and its skill level. Money is in copper, and `capturedAt` is the Unix time in seconds when the addon read the data, not when TSM last refreshed. `protocol.ts` defines every field and limit. A request from a mismatched addon fails validation, so update the addon and app together.

## Desktop app

### Clipboard polling

The app checks the clipboard every 250 ms. It ignores what was there at launch and anything that doesn't parse as a request. Polling pauses while Codex runs or the follow-up editor is open. When it resumes it only sees the latest clipboard contents, so copies made in between are dropped.

### Codex

Each question starts `codex app-server --listen stdio://` in an empty workspace. The app keeps a read-only sandbox, approvals off, the shell tool off and live web search on. App Server has no `--ignore-user-config` flag, so the app disables apps, plugins and hooks explicitly, then reads the configuration and disables each configured MCP server before starting or resuming the thread. Other Codex preferences still apply. The app strips API key variables from the environment so Codex uses the player's login. Requests go over stdin and never through a shell. On Windows the app resolves npm's shim to the native `codex.exe` for the same reason.

The app completes the initialization handshake, calls `thread/start` or `thread/resume`, then submits the prompt with `turn/start`. The connection queues notifications that arrive before an RPC response and skips non-JSON diagnostic lines on stdout. `turn/started` identifies the active turn. `item/agentMessage/delta` extends its answer, and `item/completed` supplies the authoritative text. Commentary, tool output and events from other threads or turns stay out of the reply. They do feed a one-line activity: a web search item names its query or the page it reads, `item/reasoning/summaryTextDelta` supplies the first line of the current summary part, commentary supplies its first line, and the final message reports that the reply is being written. Only a successful `turn/completed` with a completed, nonempty answer updates the stored session.

Naming a thread runs the same App Server with a short prompt holding the thread's questions and answers, each answer cut to 1500 characters, and always starts a fresh Codex thread so the player's own session never contains the naming turn. The reply's first line becomes the title, stripped of quotes and Markdown and cut to 80 characters.

A follow-up resumes only when its context matches that session. Codex keeps its own session files, and resume needs them. After a turn, the app closes stdin so Codex can flush its session, then kills the process if it has not exited within one second. Cancellation and timeouts stop the process immediately. Unsupported interactive requests fail with an error instead of waiting for a dialog the overlay cannot show.

### Overlay window

The window is transparent, frameless, always on top and not focusable, so it never takes the keyboard from WoW. Several quirks of Electron on Windows shape `overlay.ts`:

- Electron's default always-on-top level doesn't always make the window topmost on Windows, so the overlay uses the `"screen-saver"` level. Something outside the app can also clear the flag without Electron emitting an event, which leaves the overlay behind WoW. While the overlay is visible, it checks the flag every second and restores it.
- New clipboard questions and the tray call `raise`, which also calls `moveTop`. Other updates only show a hidden window and restore the topmost flag, leaving focus and window order alone.
- The follow-up editor makes the window focusable and focuses it, and so does a plain click on a reply that can be followed up, so Enter can open the editor. Windows ties taskbar visibility to focusability, so the app reapplies `setSkipTaskbar(true)`. Nothing hands focus back, so the player clicks into WoW. Hiding makes the window non-focusable again.
- Chromium's window animations are off on Windows because they flash the transparent window.
- Native resizing is off. The drag handle sends heights to the main process, which clamps them to 320 to 900 pixels and the space below the window.

### Rendering

The page runs no scripts of its own (`script-src 'none'`). The sandboxed, context-isolated preload renders it. markdown-it turns answers into HTML in the main process with raw HTML and images disabled and only HTTP(S) links allowed. A core rule then replaces money written as `1,234g 56s 7c` in text with coin icons from `assets`; gold is required so seconds such as `2s` stay text. Clicking a link opens it in the default browser after a second URL check. The overlay never navigates.

Partial answers stay in memory. Codex sends text in bursts, so the app reveals it at a steady pace: every 30 ms it renders a slightly longer prefix of the draft as Markdown and sends only the active reply to the overlay. Earlier turns stay in place. Each update replaces the reply's HTML, so the overlay remembers where the last few updates began and wraps that text in spans whose fade-in resumes where the previous render left it. The final render fades in whatever the pacing had not shown yet. The animation is off under `prefers-reduced-motion`. Updates follow the bottom of the reply only while the reader is there. A status line under a thinking reply shows the latest activity, or "Thinking…" before there is one, and the time since the question was sent, which the overlay counts from the start time the main process supplies. Opening a running thread restores its current draft and status line, and streaming never raises a hidden window. Failures replace the draft with an error. Link icons load after the answer finishes.

The prompt asks Codex to link every item it names to Wowhead as `https://www.wowhead.com/item=ID`, with the ID taken from the game data. The main process resolves the icons over the `link-icon` channel, which answers with the icon and, for an item, its quality. A plain link gets a favicon from Google's favicon service by hostname only. An item link is recognised by the item ID in the URL, and the app reads the icon name and quality from Wowhead's tooltip endpoint (`nether.wowhead.com/tooltip/item/<id>`), then the image from Wowhead's icon CDN at `wow.zamimg.com`. Only the digits of the item ID reach the network. Both downloads keep a 5 second timeout and a 256 KiB cap. Icons are re-encoded as 16 pixel PNGs and cached as JSON per hashed key in the `favicons` folder. The overlay puts the icon before the link and colours item links with the quality palette thread titles use. Image URLs from the model are never loaded.

### History

`threads.sqlite` has a `threads` table and a `turns` table. The latest request and the title subjects stay as JSON on the thread: the request keeps its game data for retries and follow-ups, and the subjects are only ever read with their thread. A thread stores its Codex session ID only when the session matches the request's context. The app saves the thread and its turns in one transaction before a run starts and again when it ends.

On startup, replies still marked as thinking become errors the player can retry. Lists sort by an explicit creation sequence that survives `VACUUM`, so replies and database maintenance don't reorder threads. Title subjects retain each item's quality so titles can use their in-game colours.

The database owns the title. A save writes it only when it inserts the thread, and returns the stored title, so a rename applied while a reply was running is not undone when that reply saves its copy of the thread. Renaming clears the title subjects, since the new title is plain text, and is refused for archived threads. The overlay allows a rename only where a follow-up is possible: a thread on screen that is neither archived nor running. Codex naming runs in the background, a newer rename of the same thread cancels it, and its result goes through the same rename.

Archiving sets `archived_at`. Archived threads are read-only, can't be found by context, and are never deleted. The overlay lists them all under a collapsed heading, five at a time.

### Settings

Settings live in Electron's user data folder, not the addon folder, which may sit under Program Files. Theme and height changes write `settings.json` through one queue, so saving both at once can't lose either. Other settings apply on restart.

## Limits

Only Windows has been tested. macOS should work, and Linux depends on the window manager. There is no installer or auto-updater. The tests mock the WoW API, so tooltip capture and copying still need checking in the game.
