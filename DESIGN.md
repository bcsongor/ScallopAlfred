# Scallop Alfred design

WoW addons can't reach the network or the file system. The clipboard is the one channel out. The addon builds a JSON request and the player copies it. An Electron app picks it up, runs Codex CLI and shows the answer in an overlay. The app never sends input to WoW, injects code or draws inside the game.

## Files

The addon lives under `addon/`, and its TOC lists the files in dependency order. Two kinds of module exist: readers and topics.

- `addon/Core.lua` holds the helpers for reading game values safely, plus the topic list. It loads first.
- `addon/Readers/` answers "what does the game say". Each reader returns plain tables or nil and knows nothing about topics: `Subjects` for anything the player can ask about, `Equipment`, `Professions`, `Talents`, `Achievements`, `Inventory`, `Recipes`, `GreatVault` and `Codex`, and two thin wrappers over frames Blizzard reuses across systems, `TraitTree` for the generic trait window and `PlayerChoice` for the player choice window.
- `addon/Topics/` answers "when do we ask and what do we send". Each file registers its buttons with `addon.AddTopic`, usually one, each with its text, category, optional question, an optional `available` check that also makes it green, and a `snapshot` mapping request fields to readers. Files load in menu order, contextual topics first. Adding a system is one topic file and a TOC line; retiring it is deleting both.
- `addon/Request.lua` builds the request: the player, subjects, the chosen topic's snapshot, and the profession skills and comparison slots every question carries. It also encodes the JSON.
- `addon/Dialog.lua` owns the menu, the editor and the copy box, `addon/Minimap.lua` the minimap button, and `addon/Main.lua` the slash command, the keybinding and the login handler.
- `Bindings.xml` defines the keybind. WoW loads it by file name, and listing it in the TOC would run it through the wrong parser. The binding fires on key release so the keystroke can't land in the question box.
- `app/main.ts` is the Electron entry point. It creates the real tray and passes it, the clipboard, Codex, `fetch` and the browser opener to `app.ts`.
- `app/app.ts` wires the modules together and owns the app's state: what the overlay shows, the running request and the follow-up editor. The clipboard, tray, Codex, network and browser arrive as ports, so tests run the real app with fakes. Electron's own APIs are imported directly.
- `app/threads.ts` holds the pure thread logic: starting and finishing turns, and what the overlay shows for a view.
- `app/clipboard.ts` watches the clipboard for requests, and `app/tray.ts` builds the tray menu from the app's state.
- `app/overlay.ts` owns the window: focus, raising, resizing, moving and fading. It answers those controls and the browse tab's itself and hands `app.ts` only what the settings should save. `app/browse.ts` owns the browse tab's web view, and `app/address.ts` holds the web URL check every link and address passes, and the address-bar parsing.
- `app/ipc.ts` types every message between the main process and the overlay, and validates the ones coming from the overlay.
- `app/preload.cjs` renders `overlay.html`, which `overlay.css` styles.
- `app/snapshots/` mirrors the addon's readers: one module per data shape with its schema and, where its fields need explaining, the prompt notes. A reader that returns an existing shape, like `GreatVault`'s subjects, needs none. `app/topics/` mirrors the addon's topics: one module per button with its category, the request fields it adds and its prompt paragraph, listed once in `index.ts`, which builds the request fields, categories and prompt paragraphs from them.
- `app/protocol.ts` validates clipboard requests, composing the request schema and the category list from the topics. `prompt.ts` builds the prompt from `prompt.md`, the general rules, plus every snapshot's notes and topic's paragraph. `codex.ts` runs Codex and names threads, `history.ts` stores threads, `icons.ts` resolves link icons, `config.ts` loads and saves settings and `markdown.ts` renders answers.
- `app/codex-events.ts` validates App Server notifications and updates the active answer with a pure reducer.
- `app/codex-connection.ts` routes RPC responses and notifications, and owns process cleanup.

Electron runs the TypeScript directly with `--experimental-strip-types`. There is no build step.

## Addon

The addon reads game data only when the player submits a question outside combat. It uses no timers, frame polling, inspect requests, auction scans or addon messages.

The minimap button is the addon's own 31 pixel frame on the minimap rather than a LibDBIcon button, since the addon ships no libraries. Its position is one angle in degrees anticlockwise from the minimap's right edge, kept in the `ScallopAlfredDB` saved variable and restored on login, which is the only state the addon stores. Dragging runs an `OnUpdate` that converts the cursor's screen pixels to the minimap's own units by its effective scale, and the radius comes from the minimap's current width so a resized minimap keeps the button on the ring.

Midnight marks some API values as secret. `addon.Public` drops them without looking inside, and `addon.Read` also treats a failing API call as missing data. Missing data never blocks a question and is never retried. A secret target GUID hides the NPC preset and adds a menu hint to type the creature's name in a custom question.

Subjects come from the hovered tooltip's original hyperlink when there is one, so item variants and link parameters survive. Otherwise the addon falls back to the tooltip's item, spell, quest, currency or achievement ID. With nothing hovered, a targeted NPC replaces the topics, except Game mechanics, Professions and My gear, with a question about it, as an `npc:<id>` subject with the ID taken from its GUID. Quest log entries and map pins build their tooltips line by line, so for those it reads `questID` from the tooltip's owner. Shift-clicked links arrive through a hook on `ChatFrameUtil.InsertLink` that only acts while the question box has focus. The `/q` slash command, or `/alfred`, builds a follow-up request from the chat line instead, with its links as subjects and no hovered subject.

Scans have fixed caps: 80 tooltip texts, counting left and right separately, 8 subjects, 256 child skill lines, 128 paths per profession tree, 256 talent nodes, 128 selected talents, 600 inventory entries after grouping, 12 Great Vault rewards, 40 achievement criteria, 64 Altar of Corrosion nodes with 8 entries each, 12 Corrosive Codex powers, 200 recipes and 12 reagent slots per recipe. Blizzard's [addon policy](https://eu.forums.blizzard.com/en/wow/t/wow-user-interface-add-on-development-policy/1642) forbids hurting performance but publishes no read quota. The caps are our own choice, not an approved allowance.

Every request carries each profession's skill lines for all expansions, so legacy farming questions see those skills. Profession specialisations only load for the Professions and Make gold topics. A child skill line must match both the parent profession ID and the expansion-specific name, so an older expansion's tree never stands in for missing current data. Path ranks subtract the unlock tier to match [Blizzard's UI](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_Professions/Blizzard_ProfessionsSpecializationsTemplates.lua).

Make gold also reads gold on hand and every stack the player can see. Bags come from `C_Container`; bank and Warband bank tabs return no slots while their windows are closed, so the request records whether each was included. Stacks are grouped by item link, with a count per location, a soulbound flag and TSM's auction and mail counts. Recipes come from `C_TradeSkillUI` for the open profession only, learned ones only, with their skill-ups, whether they are craftable now, the output item and the basic reagents. Linked, guild and NPC crafting windows are skipped. No profession window open means no recipes, and the player opens one and asks again. Every read still happens once on submit.

The Great Vault topic only shows while `C_WeeklyRewards.HasAvailableRewards` is true, because reward links only exist once the vault has rolled. It sends every activity's rewards in `vault`, without checking `progress` against `threshold`, because after the reset `progress` already counts the new week while the rewards are from last week's unlocked slots. Items are sent by their `C_WeeklyRewards.GetItemHyperlink` link and currencies, such as the Nebulous Voidcore, as `currency:<id>`. That goes alongside the full equipped set and talents that gear questions get.

The Selected achievement topic shows while the Achievements window is open with an achievement clicked. That window keeps its selection in a local upvalue but exposes it through the global `AchievementFrameAchievements_GetSelectedAchievementId`, which returns 0 for no selection; both it and the frame exist only after the window has been opened once. The request carries the achievement's name, description, points, reward and criteria, with `quantity` and `required` only on criteria that count up.

The Altar of Corrosion topic shows while Blizzard's generic trait window is open on the Altar's tree, ID 1191 in [Blizzard_GenericTraitUtil.lua](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_GenericTraitUI/Blizzard_GenericTraitUtil.lua). It sends the whole tree in `altar` through `C_Traits`, bought or not, with each node's rank, whether its prerequisites are met, whether a condition still gates it, whether it is a choice, and its entries' names and descriptions. `canPurchaseRank` ignores the player's points, so the request calls it `reachable`.

The Corrosive Codex topic shows while the Codex window is open, at the Altar or a Delve projection. The window is a player choice with one button per power, and `C_PlayerChoice.GetCurrentPlayerChoiceInfo` supplies each button's text and tooltip. The server marks buttons with an atlas in their text, `common-icon-checkmark` on the active power and `activities-icon-lock` on a locked one, while the buttons' own flags stay false, so `PlayerChoice` reads `locked` and `active` from the text, and the `Codex` reader adds the Corrosive Soul count, item 273000, from `C_Item.GetItemCount`. Tooltips repeat the power's name first, which the request strips.

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
  "player": { "name": "Aeloria", "class": "Druid", "spec": "Restoration", "level": 90, "itemLevel": 310 },
  "gameVersion": "12.1.0",
  "subjects": [{ "type": "item", "name": "Example ring", "link": "item:123", "tooltip": ["Tooltip text"] }],
  "equipped": []
}
```

`id` is new for every request. `context` names the thread a request started, and the addon makes a fresh one for each question. The addon sends `thread: "new"`, or `thread: "followup"` from `/q`. The app turns a follow-up into `continue` for the thread on screen, with that thread's context, or into `new` when nothing can be continued. Overlay follow-ups reuse the stored request with `thread: "continue"`, a new `id` and the new question. A thread keeps the title of its first request.

The optional `equipped`, `professions`, `talents`, `inventory`, `recipes`, `vault`, `achievement`, `altar`, `codex` and per-subject `tsm` fields are snapshots, so follow-ups reuse them. `inventory` carries the player's copper and whether the bank and Warband bank were readable; `recipes` carries the open profession and its skill level. Money is in copper, and `capturedAt` is the Unix time in seconds when the addon read the data, not when TSM last refreshed. `protocol.ts` defines every field and limit. A request from a mismatched addon fails validation, so update the addon and app together.

The minimap button copies `SCALLOPALFRED:SHOW` followed by a fresh ID, so copying it twice in a row is seen twice. The app raises the overlay when it sees it and starts no question.

## Desktop app

### Clipboard polling

The app checks the clipboard every 250 ms. It ignores what was there at launch and anything that doesn't parse as a request. While Codex runs or the follow-up editor is open, requests stay on the clipboard unread, so only the latest is seen once polling resumes and copies made in between are dropped. The show command still comes through, so a hidden overlay can be brought back mid-reply.

### Codex

Each question starts `codex app-server --listen stdio://` in an empty workspace. The app keeps a read-only sandbox, approvals off, the shell tool off and live web search on. App Server has no `--ignore-user-config` flag, so the app disables apps, plugins and hooks explicitly, then reads the configuration and disables each configured MCP server before starting or resuming the thread. Other Codex preferences still apply. The app strips API key variables from the environment so Codex uses the player's login. Requests go over stdin and never through a shell. On Windows the app resolves npm's shim to the native `codex.exe` for the same reason.

The app completes the initialization handshake, calls `thread/start` or `thread/resume`, then submits the prompt with `turn/start`. The connection queues notifications that arrive before an RPC response and skips non-JSON diagnostic lines on stdout. `turn/started` identifies the active turn. `item/agentMessage/delta` extends its answer, and `item/completed` supplies the authoritative text. Commentary, tool output and events from other threads or turns stay out of the reply. They do feed a one-line activity: a web search item names its query or the page it reads, `item/reasoning/summaryTextDelta` supplies the first line of the current summary part, commentary supplies its first line, and the final message reports that the reply is being written. Only a successful `turn/completed` with a completed, nonempty answer updates the stored session.

Naming a thread runs the same App Server with a short prompt holding the thread's questions and answers, each answer cut to 1500 characters, and always starts a fresh Codex thread so the player's own session never contains the naming turn. The reply's first line becomes the title, stripped of quotes and Markdown and cut to 80 characters.

A follow-up resumes only when its context matches that session. Codex keeps its own session files, and resume needs them. After a turn, the app closes stdin so Codex can flush its session, then kills the process if it has not exited within one second. Cancellation and timeouts stop the process immediately. Unsupported interactive requests fail with an error instead of waiting for a dialog the overlay cannot show.

### Overlay window

The window is transparent, frameless, always on top and not focusable, so it never takes the keyboard from WoW. Several quirks of Electron on Windows shape `overlay.ts`:

- Electron's default always-on-top level doesn't always make the window topmost on Windows, so the overlay uses the `"screen-saver"` level. Something outside the app can also clear the flag without Electron emitting an event, which leaves the overlay behind WoW. While the overlay is visible, it checks the flag every second and restores it.
- New clipboard questions, the show command and the tray call `raise`, which also calls `moveTop`. Other updates only show a hidden window and restore the topmost flag, leaving focus and window order alone.
- The follow-up editor makes the window focusable and focuses it, and so does a plain click on a reply that can be followed up, so Enter can open the editor. Windows ties taskbar visibility to focusability, so the app reapplies `setSkipTaskbar(true)`. Nothing hands focus back, so the player clicks into WoW. Hiding makes the window non-focusable again.
- Chromium's window animations are off on Windows because they flash the transparent window.
- Native resizing is off. Each dimension has its own edge handle, so neither drag can change the other: the bottom one sends heights and the left one widths. The main process clamps them to 320 to 1600 pixels tall and 280 to 1600 wide, and to the space below and left of the window. Height grows downwards from a fixed top edge. Width grows leftwards from a fixed right edge, so widening never pushes the overlay across the game's minimap, which is why the width is saved with the `x` it implies.
- Dragging the header, outside its buttons, moves the window the same way: the page sends where the top-left corner should go, and the main process keeps the whole window on the display it lands on and saves `x` and `y` when the drag ends.
- The Fade box in the header fades the overlay to 60% while the pointer is elsewhere. It uses the window's opacity rather than CSS, because the browse tab's view is a native child the page can't style, and the main process watches the pointer every 25 ms while fading is on, because the page stops seeing the pointer once it moves onto that view.
- The browse tab holds the keyboard for as long as it is open, since a web page needs it for its own fields. Switching back to Ask hands it to the game again.

### Browse tab

The overlay has two panes. Ask holds the threads; Browse is an ordinary browser for reading Wowhead, X or anything else without leaving the game. It is a `WebContentsView` layered over the overlay page, created the first time the tab is opened, so an overlay that only answers questions never pays for it. The page measures the box the view should cover and reports it over `browse-bounds`, which keeps the layout in CSS where the rest of it lives.

The view runs in its own `persist:browse` session, so logins survive a restart. It reports Chrome's reduced Android user agent, built from the Chromium version Electron ships, and overrides the `Sec-CH-UA-Mobile` and `Sec-CH-UA-Platform` client hints to match, because Chromium keeps sending desktop ones and sites trust those over the user agent string. The pane is about as wide as a phone, so a mobile layout is the one that fits, and it names no Electron, which some sites refuse. Pages are asked for their dark theme over the devtools protocol, because `nativeTheme.themeSource` does not reach a renderer's `prefers-color-scheme`, with `Sec-CH-Prefers-Color-Scheme` alongside the other hints for pages that pick their theme on the server. They also get no scrollbar, which would cost real width in a pane this narrow: the protocol hides the ones inside a page, and the root scroller, the one actually on show, is hidden through the CSSOM as well, because that command is the unreliable half of the pair. Pages still scroll with the wheel. None of it is worth failing over, so it all gives up quietly. The view paints black until a page loads, so nothing flashes white over the overlay.

It is sandboxed and context-isolated with no preload and no Node integration, and its session denies every permission request, so nothing can ask for the camera, microphone, location or notifications. There is one pane, so a link that asks for its own window loads in place instead. `address.ts` only ever returns an http(s) URL, adding `https` to a bare hostname, so the pane cannot be pointed at the local disk or a script.

`fullscreen.ts` stands in for the Fullscreen API. An embedded view never answers `requestFullscreen`: it neither resolves nor rejects, and `enter-html-full-screen` never fires, so a player's fullscreen button looks dead. The stand-in moves the element into a pane-sized host appended to the body and reports the state a player expects, putting the element back in the gap it came from on the way out. Moving it is the point: styling it `fixed` where it sits is anchored by any ancestor with a transform or paint containment, and clearing those collapses a feed that positions its items with transforms. Its styles go through style properties, because the strict `style-src` these sites send blocks an injected `<style>`.

Escape is the way out. The stand-in covers every name a player might call and reports the legacy `fullscreen` and `webkitIsFullScreen` flags a control reads to decide whether to minimise, but a player's own minimise button can still do nothing. Chromium's built-in video controls take an internal path rather than any of these, which is the likeliest reason and is unconfirmed: diagnosing it needs devtools on the pane, which the app does not expose.

All of the above is applied per document, from both `dom-ready` and `did-finish-load`, because a devtools command sent before the target has a document is dropped. Applying twice is harmless.

The last page is saved to `browseUrl` in the settings when the tab closes and on quit, so the tab reopens where it was left. A question arriving from the clipboard switches back to Ask, so an answer is never hidden behind a web page.

### Rendering

The Ask pane runs no scripts of its own (`script-src 'none'`); that policy covers the overlay page, not the browse tab's view, which is ordinary web content isolated by its own session and sandbox. The sandboxed, context-isolated preload renders it. markdown-it turns answers into HTML in the main process with raw HTML and images disabled and only HTTP(S) links allowed. A core rule then replaces money written as `1,234g 56s 7c` in text with coin icons from `assets`; gold is required so seconds such as `2s` stay text. Clicking a link opens it in the default browser after a second URL check. The overlay never navigates.

Partial answers stay in memory. Codex sends text in bursts, so the app reveals it at a steady pace: every 30 ms it renders a slightly longer prefix of the draft as Markdown and sends only the active reply to the overlay. Earlier turns stay in place. Each update replaces the reply's HTML, so the overlay remembers where the last few updates began and wraps that text in spans whose fade-in resumes where the previous render left it. The final render fades in whatever the pacing had not shown yet. The animation is off under `prefers-reduced-motion`. Updates follow the bottom of the reply only while the reader is there. A status line under a thinking reply shows the latest activity, or "Thinking…" before there is one. Opening a running thread restores its current draft and status line, and streaming never raises a hidden window. Failures replace the draft with an error. Link icons load after the answer finishes.

The prompt asks Codex to link every item it names to Wowhead as `https://www.wowhead.com/item=ID`, with the ID taken from the game data. The main process resolves the icons over the `link-icon` channel, which answers with the icon and, for an item, its quality. A plain link gets a favicon from Google's favicon service by hostname only. An item link is recognised by the item ID in the URL, and the app reads the icon name and quality from Wowhead's tooltip endpoint (`nether.wowhead.com/tooltip/item/<id>`), then the image from Wowhead's icon CDN at `wow.zamimg.com`. Only the digits of the item ID reach the network. Both downloads keep a 5 second timeout and a 256 KiB cap. Icons are re-encoded as 16 pixel PNGs and cached as JSON per hashed key in the `favicons` folder. The overlay puts the icon before the link and colours item links with the quality palette thread titles use. Image URLs from the model are never loaded.

### History

`threads.sqlite` has a `threads` table and a `turns` table. The latest request and the title subjects stay as JSON on the thread: the request keeps its game data for retries and follow-ups, and the subjects are only ever read with their thread. A thread stores its Codex session ID only when the session matches the request's context. The app saves the thread and its turns in one transaction before a run starts and again when it ends.

On startup, replies still marked as thinking become errors the player can retry. Lists sort by an explicit creation sequence that survives `VACUUM`, so replies and database maintenance don't reorder threads. Title subjects retain each item's quality so titles can use their in-game colours.

The database owns the title. A save writes it only when it inserts the thread, and returns the stored title, so a rename applied while a reply was running is not undone when that reply saves its copy of the thread. Renaming clears the title subjects, since the new title is plain text, and is refused for archived threads. The overlay allows a rename only where a follow-up is possible: a thread on screen that is neither archived nor running. Codex naming runs in the background, a newer rename of the same thread cancels it, and its result goes through the same rename.

Archiving sets `archived_at`. Archived threads are read-only and are the only threads that can be deleted. The overlay lists them all under a collapsed heading, five at a time, each with unarchive and delete buttons. Unarchiving clears `archived_at`, so the thread returns to the list in its creation order and can be continued again. Deleting sets `deleted_at` and nothing is removed from the database, but no query returns a deleted thread, and a reply that finishes afterwards saves without bringing it back.

### Settings

Settings live in Electron's user data folder, not the addon folder, which may sit under Program Files. Theme, size, position, fade and browsed-page changes write `settings.json` through one queue, so saving several at once can't lose any. Other settings apply on restart.

## Limits

Only Windows has been tested. macOS should work, and Linux depends on the window manager. There is no installer or auto-updater. The tests mock the WoW API, so tooltip capture and copying still need checking in the game.
