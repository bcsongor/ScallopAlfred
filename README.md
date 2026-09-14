# Scallop Alfred

Ask Codex about World of Warcraft without leaving the game. Press Alt+Q in WoW, pick a question and copy the request. The answer appears in a small window above the game.

Addons can't reach the network, so the clipboard carries the request. The desktop app watches the clipboard, runs Codex CLI with your login and shows the reply.

## Setup

You need [Node.js](https://nodejs.org) 24 or later and [Codex CLI](https://developers.openai.com/codex/cli/). It was tested with Codex CLI 0.154.0.

1. Put this folder at `World of Warcraft/_retail_/Interface/AddOns/ScallopAlfred`.
2. Run `codex login`.
3. In this folder, run `npm install`, then `npm start`. Keep the app running while you play.
4. Enable Scallop Alfred in WoW's addon list. Restart WoW if it was already open.
5. Set WoW to windowed or windowed fullscreen, otherwise the overlay can't sit above it.

## Asking a question

Press Alt+Q outside combat.

- Hover an item, spell, currency, achievement or quest link first to get presets for it, plus **Custom question**. Quests also work from the quest log and map, but not from the objective tracker.
- Without a tooltip, choose **Game mechanics**, **Professions**, **My gear** or **Custom question**, then type your question. With an NPC targeted, the menu also offers **What should I know about my target?**

Shift-click links into the question box to ask about up to eight things at once. Press Enter, then Ctrl+C (Cmd+C on macOS) to copy the request. The box closes when you let go of the keys.

Every request includes your class, spec, level, profession skills and the equipment slots that matter for the question. **My gear** and **Is it an upgrade?** add all your equipped items and active talents. **Professions** adds your specialisation points. If they're missing, open that profession's Specializations tab and ask again. With TradeSkillMaster installed, items also carry TSM's cached prices.

To follow up from the game, type `/q` and your question in chat, Shift-clicking any links into the line, then copy the request as usual. The overlay continues the thread it's showing, or starts a new one if you're on the thread list. WoW's 255-character chat limit leaves room for two or three links. If another addon already uses `/q`, type `/alfred` instead.

If Alt+Q is already taken, bind **Scallop Alfred: Ask about a tooltip or link** in WoW's keybindings.

## Using the overlay

- **Follow up** continues the thread with the same game data. Ask again from WoW to refresh it.
- **←** lists your saved threads. Items in thread titles keep their in-game quality colours. The box icon archives a thread. Archived threads are read-only and collapsed at the bottom. Open the heading to see them five at a time.
- **Hide** hides the overlay while replies keep running. Click the tray icon to bring it back.
- Drag the bottom edge to change the height.

After typing a follow-up, click back into WoW to give it the keyboard.

The tray menu copies the answer, retries, cancels, switches between the Original and WoWhead themes and opens the settings.

## Settings

**Open settings** in the tray opens `settings.json` in the app's data folder, `%APPDATA%\Scallop Alfred` on Windows. Restart the app after editing it.

| Setting | Default | Notes |
| --- | --- | --- |
| `model` | `gpt-6-astra` | Leave empty for the Codex CLI default |
| `codexPath` | empty | Set it if Codex isn't found. On Windows, point at `codex.exe`, not a `.cmd` or `.ps1` shim |
| `width` | `380` | 280 to 800 pixels |
| `height` | `640` | 320 to 900 pixels |
| `x`, `y` | `null` | Window position. `null` puts it near the top right, clear of the minimap and quest tracker |
| `fontSize` | `14` | 12 to 28 pixels |
| `theme` | `original` | `original` or `wowhead` |
| `timeoutSeconds` | `180` | 10 to 600 |

The same folder holds `threads.sqlite`, with your threads and the game data sent with them, and a `favicons` cache. Favicons for source links come from Google's favicon service, which only sees the site's hostname.

## Troubleshooting

If nothing happens after copying, check that the app is running. It ignores whatever was on the clipboard when it started, so copy some other text and then copy the request again.

After updating, run `/reload` in WoW and restart the app. Both sides must speak the same request format.

## Development

`npm run check` type-checks the app and the tests. `npm test` runs the addon's Lua against mocked WoW APIs, unit-tests the pure modules and the Codex process runner, and drives the real Electron app with a fake clipboard, tray and Codex, so tests never touch your clipboard or a model.

Only Windows has been tested, and in-game capture still needs checking in WoW itself. [DESIGN.md](DESIGN.md) explains how it works.
