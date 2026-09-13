# Scallop Alfred design

Scallop Alfred sends a WoW question and linked subjects to Codex through a manual clipboard copy. A separate desktop window displays the answer over WoW.

The display name is Scallop Alfred. The addon folder and Lua identifiers use `ScallopAlfred`. The addon uses WoW's built-in `Interface\Icons\INV_Misc_Shell_03` texture. The desktop app uses `assets/scallop.jpg`, the same Blizzard artwork downloaded from [Blizzard's icon CDN](https://render.worldofwarcraft.com/us/icons/56/inv_misc_shell_03.jpg).

## Architecture

The addon is Lua. The desktop app uses Electron and vanilla TypeScript. Bun manages dependencies and launch commands. Electron loads TypeScript directly with `--experimental-strip-types`; there is no build output. The sandboxed preload is plain CommonJS with JSDoc types, checked alongside TypeScript. Electron supplies the clipboard, tray, and window APIs across desktop platforms, so the app needs no native bindings or frontend framework. The trade-off is a larger runtime download.

The source is split by responsibility:

- `ScallopAlfred.lua` builds requests and owns the in-game menu and copy box.
- `Professions.lua` reads profession snapshots through the addon namespace. It loads before the request builder.
- `Talents.lua` reads the active player talent build for gear questions. It also loads before the request builder.
- `Bindings.xml` registers the keybind through WoW's dedicated binding loader. It opens the dialog on key release so the opening keystroke cannot enter the question box. It must stay out of `ScallopAlfred.toc`, whose XML entries use the UI parser.
- `sidecar/protocol.ts` validates clipboard requests and defines shared types.
- `sidecar/codex.ts` launches Codex and reads its JSONL output.
- `sidecar/history.ts` stores threads and session IDs in SQLite using Electron's built-in [`node:sqlite`](https://nodejs.org/api/sqlite.html). It adds no dependency or build step.
- `sidecar/favicons.ts` fetches and caches source icons by hostname. The renderer requests icons through IPC and receives PNG data URLs.
- `sidecar/main.ts` owns the overlay, tray, clipboard polling, and request lifecycle. `config.ts` loads settings; `markdown.ts` renders answers and validates web links. The sandboxed `preload.cjs` displays the result in `overlay.html`.

## Request flow

1. The player presses the Scallop Alfred keybind, `Alt+Q` when unassigned. Hovering a supported tooltip first supplies the subject; otherwise the addon offers **Game mechanics**, **Professions**, and **My gear**.
2. A topic opens the question box immediately. Hovered subjects retain their presets and custom question button. The question box accepts Shift-clicked links and selects the resulting request for copying.
3. The player copies it with `Ctrl+C`, or `Cmd+C` on macOS. The copy box closes on key release, after WoW handles the copy.
4. The desktop app validates the clipboard text and starts `codex exec --json`.
5. A successful answer appears in a window that stays on top and passes mouse input through to WoW.
6. The overlay's **Follow up** editor reuses the last copied request and thread. Each addon question refreshes game data and creates a new context. The addon does not track threads.

Addon requests are disabled during combat. The addon omits restricted tooltip values and includes both equipped rings or trinkets when relevant. Equipment is refreshed for each addon question. Overlay follow-ups reuse the last copied data; the desktop app does not read live game state.

Item subjects optionally include `tsm` data read when the question is prepared. `TSM_API.ToItemString` converts the original link, preserving TSM's handling of item variants. `TSM_API.GetCustomPriceValue` reads `DBMinBuyout`, `DBRegionMarketAvg`, `DBRegionSaleAvg`, `DBRegionSaleRate`, and `VendorSell`. Each call is protected so missing TSM data or an API error cannot block copying. Restricted, non-finite, negative, and out-of-range values are omitted. Other subject types and equipped comparison items do not trigger price lookups.

The snapshot stores monetary values in per-item copper, a fractional sale rate, and `capturedAt` as Unix seconds. That timestamp records the addon read, not the age of TSM's data. The protocol validates these fields, and SQLite retains them with the request for follow-ups. The prompt distinguishes listed prices from reported sales, treats missing values as unknown, and avoids presenting cached prices as live quotes. Price-source meanings follow [TSM's definitions](https://support.tradeskillmaster.com/which-price-sources-can-i-use-and-what-do-they-mean).

One subject reader handles link types. Hover capture uses the original hyperlink when available, then exposed item, spell, quest, currency or achievement data. Shift-click uses `ChatFrameUtil.InsertLink`, with the legacy `ChatEdit_InsertLink` hook on older clients. The hook only inserts into the focused question box. The hovered subject comes first, followed by explicit question links. Identical links are collected once; different item variants remain distinct. The eight-subject limit includes the hovered subject. Unsupported tooltip lookups retain the link and name. Equipment presets and comparisons apply only to items. The custom question button uses the same `UIPanelButtonTemplate` and size as the presets, with desaturated textures for a grey background.

The addon dialog is 320 UI units wide. Item names use `ITEM_QUALITY_COLORS` when cached item quality is available, with plain text as the fallback. Quality colours stay in the addon UI.

## Clipboard protocol

Optional `professions` data contains a capture timestamp and up to five primary or secondary professions. `GetProfessions` and `GetProfessionInfo` supply names, skill levels, bonuses and expansion-specific skill line names for every question. Sparse profession slots are preserved. Only the Professions topic reads child skill lines and specialisation trees. Child skill lines are matched by parent ID and the reported expansion-specific name, so an older expansion's tree is not substituted for missing current data.

For matching skill lines, the addon reads available knowledge and specialisation paths through Blizzard's [profession specialisation API](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/ProfessionSpecUIDocumentation.lua). Path ranks subtract the unlock tier, matching [Blizzard's displayed ranks](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_Professions/Blizzard_ProfessionsSpecializationsTemplates.lua). No profession window is opened and no points are staged or spent. Unavailable or restricted values are omitted; staged allocations are labelled. Older requests remain valid without this snapshot.

Each request is one line prefixed with `SCALLOPALFRED:`:

```json
{
	"v": 2,
	"id": "unique-request-id",
	"context": "thread-id",
	"thread": "new",
	"question": "Is it an upgrade?",
	"player": { "class": "Druid", "spec": "Restoration", "level": 90 },
	"gameVersion": "12.1.0",
	"subjects": [{ "type": "item", "name": "Example ring", "link": "item:123", "tooltip": ["Tooltip text"] }],
	"equipped": []
}
```

`thread` is `new` or `continue`. Optional `category` is `mechanics`, `professions`, or `gear`. Both **My gear** and the **Is it an upgrade?** preset use `gear`. `subjects` contains up to eight distinct links and is empty for general questions without links. Each subject has a link type, name, link and tooltip lines. `equipped` contains the full available equipped set for gear requests, or comparison slots for other linked-item questions. Each slot is read once and included as an optional `slot` ID. Entries use the subject shape, restricted to `item`, with a limit of 19. The schema defines the remaining field and size limits. Version 1 requests are rejected, so an update requires both a WoW UI reload and a desktop app restart.

Gear questions optionally include `talents`, containing a timestamp, the active talent export string and selected spell IDs, names and ranks. `hasStagedChanges` identifies uncommitted edits. The addon uses the active player config through [Blizzard's trait API](https://github.com/Gethe/wow-ui-source/blob/live/Interface/AddOns/Blizzard_APIDocumentationGenerated/SharedTraitsDocumentation.lua), not inspection requests. Follow-ups and SQLite retain the original category, gear and talent snapshot.

Snapshots run only when preparing a question outside combat. No addon timers, frame polling, inspect requests, auction scans, addon messages or talent mutations are used. Profession metadata is read once per child skill line per request, with at most 256 lines considered. Profession trees visit at most 128 distinct paths each; the active talent scan visits at most 256 distinct nodes and exports at most 128 selections. Missing data does not trigger retries. These application limits do not represent a published Blizzard read allowance. The [addon policy](https://eu.forums.blizzard.com/en/wow/t/wow-user-interface-add-on-development-policy/1642) addresses performance impact and requires compliance with the broader terms. Its existence does not certify this addon or the external overlay.

The desktop app ignores the clipboard contents present at startup, unrelated text, and the last 128 processed request IDs. It polls every 250 ms when idle. Only one Codex process runs at a time; after it finishes, polling considers the latest clipboard contents. Intermediate copies are discarded.

## Codex integration

The prompt supports general mechanics and progression questions as well as linked subjects. It asks for current sources for seasonal systems and profession builds, distinguishes live changes from announcements or test realms, and asks one focused question when a missing goal changes the advice. Response length follows the question rather than a fixed word cap. Profession skill, bonus skill and knowledge points remain distinct; missing fields are unknown, and follow-ups retain the original snapshot.

The app uses the installed Codex CLI and existing login. It removes API-key environment variables and ignores user configuration for each run. It runs in a separate empty directory with a read-only sandbox, approvals disabled, shell tools disabled, and live web search enabled. Prompts travel through stdin, without a command shell.

The JSONL parser reads `thread.started`, the final `agent_message`, and `turn.completed`. A failed or cancelled run leaves the previous successful session unchanged. Follow-ups use `exec resume` only when the request context matches that session. This prevents an uncopied or skipped question from resuming the wrong thread.

Each thread retains its successful session mapping in SQLite. Reopening it after a desktop restart allows follow-ups to resume that session. Codex manages its own session files, which must remain available for resume to work.

## Desktop behaviour

The overlay starts non-focusable. On Windows and macOS, clicks pass through except over buttons, links, the resize handle, and an overflowing thread, using Electron's mouse forwarding. Linux keeps the overlay clickable. **Follow up** enables keyboard focus and mouse input. Submit, Cancel, Esc and Hide close the editor and restore the configured click-through behaviour. Clipboard polling pauses while the editor is open so the thread cannot change while the player types. The main process validates the question before sending it with a new request ID and the captured context.

Hiding a running answer lets it finish without reopening the window. Clicking the tray icon or choosing **Show overlay** restores a hidden or minimised window and raises it, including when Electron reports it as visible. This preserves the thread content and leaves keyboard focus and taskbar visibility alone. A second launch uses the same action. Only the overlay header's **Hide** button dismisses the window. There is no auto-hide timer; old `hideAfterSeconds` settings are ignored. The tray also controls copying the latest answer, retry, cancellation, and settings. The thread accepts scrolling directly.

The main process saves each thread to `conversations.sqlite` in the user data directory before starting a request and after it finishes. A single atomic SQLite row update stores the JSON snapshot, including turns, game data, and the last successful session. Both history lists sort by descending row ID, preserving thread creation order through updates and archiving. The latest-activity index supports context lookups. Interrupted replies become retryable errors on startup. Follow-ups append turns; retries update the existing turn. A new addon question starts another saved thread.

The back button opens the saved thread list. Selecting a thread opens its messages and follow-up context. Browsing during a request does not redirect its reply or change the selected view when it finishes. On restart, existing history opens as a list. The renderer displays questions as plain text and successful replies as sanitised Markdown. Errors and pending replies stay beside their questions. New questions scroll into view; answer updates preserve the reader's position unless already at the bottom. Hiding and showing the overlay retains the thread and scroll position.

Each active history entry has an archive box button that archives immediately. The database stores the archive time separately from reply updates. The 10 newest archived threads appear in creation order as grey titles without previews or dates in a section pinned to the bottom of the overlay. Active threads scroll independently above it. The archive section occupies at most half the available history height and scrolls when needed. Opening one allows reading and copying, but not follow-ups, retries or restoration. Context lookups exclude archived threads. Reply saves and interrupted-reply recovery preserve the archive time. Existing hidden threads become archived using their last update time. Messages are never deleted, including archives outside the displayed 10.

An accepted clipboard question uses the same restore-and-raise action as the tray before processing starts. A window reported as visible and topmost can still sit behind WoW. Other request and answer updates show a hidden overlay, then restore its topmost flag if needed. These updates leave native focus and window order alone when the overlay is already visible and topmost.

Submitting or cancelling a follow-up leaves native keyboard focus and window order alone. The player clicks back into WoW to return keyboard control to the game. Hiding the overlay resets it to non-focusable after it is hidden. On Windows, Chromium's window visibility animations are disabled to prevent the transparent overlay flashing when shown.

The tray's Theme submenu switches between Original and WoWhead. Existing settings default to Original. A theme message changes CSS variables without replacing the current thread or draft, or showing a hidden overlay. WoWhead uses charcoal panels, gold headings and links, red action buttons, and Arial text. Theme and height saves share a queue to preserve both settings when changed together.

The bottom handle changes only the height. Pointer capture keeps dragging active outside the window, with click-through disabled until release. The main process clamps the height to 320–900 pixels and the available space below the window. Releasing the handle saves the height in settings, preserving other configured values. Native resizing stays disabled for the transparent window.

The overlay stays out of the taskbar when the follow-up editor opens. Electron's Windows implementation changes taskbar visibility with focusability, so the app reapplies `setSkipTaskbar(true)` after each focusability change.

Answers use Markdown. `markdown-it` runs in the main process with raw HTML and images disabled; the preload receives the rendered HTML. Only HTTP and HTTPS links are accepted, checked again before opening in the default browser. Links have no underline. The overlay never navigates to a source. Progress and errors remain plain text. Copying the latest answer preserves its original Markdown.

The preload adds decorative 16-pixel favicons to rendered links asynchronously. The main process sends only hostnames to Google's favicon service, with a five-second timeout and a 256 KiB download limit. It decodes and resizes images to PNG before caching them under hashed filenames in the user data directory. Requests for the same hostname share one promise, including failures for the current run. Saved PNGs survive restarts. Missing icons leave the link unchanged. The renderer permits local and data images through CSP; model-supplied images remain disabled.

Requests default to `gpt-6-astra`. Each CLI invocation explicitly sets `model_reasoning_effort="medium"` and `service_tier="fast"`, including follow-ups.

Settings live in Electron's user data directory. Position is clamped to a connected display. Settings changes take effect on restart.

Windows and macOS are the intended platforms. WoW must use windowed or windowed fullscreen mode. The app remains over other applications until hidden; it does not monitor game focus. Linux desktop support depends on the window manager, particularly under Wayland, and WoW itself has no native Linux client.

## Scope and verification

The app does not send input to WoW, inject code into the client, or draw answers inside the game's UI. It has no answer streaming, auto-updater, or installer.

Automated checks exercise the real Lua payload builder with mocked WoW APIs and the real Electron window with an isolated clipboard and a fake Codex process. Test requests cannot reach a running production overlay through the system clipboard. Earlier manual smoke checks verified fresh requests, thread resume, and live web search against Codex CLI 0.154.0.

Actual WoW tooltip rendering, copying, and overlay placement still need an in-game check. macOS and Linux have not been tested. Setup and test commands are in [README.md](README.md).
