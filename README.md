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
- Without a tooltip, choose **Game mechanics**, **Professions**, **My gear** or **Custom question**, then type your question, or **Make gold** to copy a request straight away. **Great Vault** appears while the vault is open with rewards to pick and copies one too, **Selected achievement** while one is clicked in the Achievements window, **Altar of Corrosion** while the Altar's talent window is open, and **Corrosive Codex** while the Codex is open. With an NPC targeted, the menu shows its name and offers **What should I know about my target?** instead of the other topics. **Game mechanics**, **Professions** and **My gear** stay in every menu, and ask about the hovered subject or target too. A custom question then asks about it too. Where WoW hides the target, as in delves, the dialog says so and you can ask by name.

Shift-click links into the question box to ask about up to eight things at once. Press Enter, then Ctrl+C (Cmd+C on macOS) to copy the request. The box closes when you let go of the keys.

Every request includes your character name, class, spec, level, equipped item level, profession skills for every expansion and the equipment slots that matter for the question. **My gear** and **Is it an upgrade?** add all your equipped items and active talents. **Professions** adds your specialisation points. If they're missing, open that profession's Specializations tab and ask again. With TradeSkillMaster installed, items also carry TSM's cached prices.

**Great Vault** asks which vault reward to pick. It adds every option on offer, including the Nebulous Voidcore and Tokens of Merit, your equipped items and your active talents. Open the vault first. The option only shows while its window is open and has rewards to claim.

**Selected achievement** asks how to earn the achievement you clicked. It adds its criteria and how far along each one is. Open the Achievements window and click one first.

**Altar of Corrosion** asks what to buy next at the Altar. It adds every talent in the Altar's tree with what you own and what's next in line, and your unspent Spirit Corrosion. Open the Altar's talent window first.

**Corrosive Codex** asks which power to unlock or equip next. It adds every power with whether it's locked, unlocked or equipped, and your Corrosive Souls. Open the Codex at the Altar or at the projection at the start of a Delve first.

**Make gold** asks how to make gold with what you have. It adds your gold, everything in your bags, your profession specialisations and the recipes of whichever profession window is open. Bank and Warband bank stacks only come through while those windows are open, and the request says whether each was included. With no profession window open there are no recipes. Open the bank or the profession you want to craft from, then ask again.

To follow up from the game, type `/q` and your question in chat, Shift-clicking any links into the line, then copy the request as usual. The overlay continues the thread it's showing, or starts a new one if you're on the thread list. WoW's 255-character chat limit leaves room for two or three links. If another addon already uses `/q`, type `/alfred` instead.

If Alt+Q is already taken, bind **Scallop Alfred: Ask about a tooltip or link** in WoW's keybindings.

## Using the overlay

Replies appear as Codex writes them. A line under the reply shows what Codex is doing, such as the search it is running. The overlay follows new text while you're at the bottom. Scroll up to keep your place. Cancelling or failing a request replaces the unfinished reply with an error you can retry.

- **Follow up** continues the thread with the same game data. Ask again from WoW to refresh it. Click the reply, then press Enter to open the editor and Enter again to send.
- **Double-click the title** to rename the thread. Enter keeps the name and Escape drops it. Leave it empty and Codex names the thread from the conversation.
- **←** lists your saved threads. Items in thread titles keep their in-game quality colours. The box icon archives a thread. Archived threads are read-only and collapsed at the bottom. Open the heading to see them five at a time, then use the arrow to unarchive one or the bin to delete it.
- **Hide** hides the overlay while replies keep running. Click the tray icon to bring it back, or without leaving the game click Alfred's minimap button and press Ctrl+C. Drag that button to move it around the minimap.
- **Browse** switches the overlay to a browser with an address bar, for reading Wowhead, X or anything else without leaving the game. It keeps you signed in between sessions, and asks sites for their dark theme with no scrollbar. Scroll with the wheel. A video's fullscreen button fills the browse pane; press Escape to come back, because the player's own minimise button doesn't respond. Browsing takes the keyboard, so press **Ask** to hand it straight back to WoW, or click into the game. A new question from WoW switches back to Ask on its own, so an answer never hides behind a page.
- Drag the header to move the overlay. It stays on screen and reopens where you left it.
- Drag the grip on the bottom edge to change the height, or the one on the left edge to change the width. It widens to the left, so the right edge stays where you put it.
- Tick **Fade** in the header to let the game show through the overlay while your pointer is elsewhere. It comes back as soon as you point at it.

After typing a follow-up, click back into WoW to give it the keyboard.

The tray menu copies the answer, retries, cancels, switches between the Original and WoWhead themes and opens the settings.

## Settings

**Open settings** in the tray opens `settings.json` in the app's data folder, `%APPDATA%\Scallop Alfred` on Windows. Restart the app after editing it.

| Setting | Default | Notes |
| --- | --- | --- |
| `model` | `gpt-6-astra` | Leave empty for the Codex CLI default |
| `codexPath` | empty | Set it if Codex isn't found. On Windows, point at `codex.exe`, not a `.cmd` or `.ps1` shim |
| `width` | `380` | 280 to 1600 pixels |
| `height` | `640` | 320 to 1600 pixels |
| `x`, `y` | `null` | Window position. `null` puts it near the top right, clear of the minimap and quest tracker. Dragging the header saves both, and changing the width updates `x`, since the window widens to the left |
| `fontSize` | `14` | 12 to 28 pixels |
| `theme` | `original` | `original` or `wowhead` |
| `fade` | `false` | Fades the overlay while the pointer is elsewhere. The **Fade** box sets it |
| `browseUrl` | `https://x.com` | Where the Browse tab opens. The app rewrites it to the last page you visited |
| `timeoutSeconds` | `180` | 10 to 600 |

The same folder holds `threads.sqlite`, with your threads and the game data sent with them, and a `favicons` cache. Icons for plain source links come from Google's favicon service, which only sees the site's hostname. Item links show the item's icon and quality colour from Wowhead, which only sees the item ID.

Other Codex user settings still apply. See [Codex configuration overrides](DESIGN.md#codex) for the settings the app controls.

## Troubleshooting

If nothing happens after copying, check that the app is running. It ignores whatever was on the clipboard when it started, so copy some other text and then copy the request again.

After updating, run `/reload` in WoW and restart the app. Both sides must speak the same request format.

## Development

`npm run check` type-checks the app and the tests. `npm test` runs the addon's Lua against mocked WoW APIs, unit-tests the pure modules and the Codex process runner, and drives the real Electron app with a fake clipboard, tray and Codex, so tests never touch your clipboard or a model.

Only Windows has been tested, and in-game capture still needs checking in WoW itself. [DESIGN.md](DESIGN.md) explains how it works.
