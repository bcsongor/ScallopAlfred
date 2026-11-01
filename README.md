# Scallop Alfred

Ask an AI about World of Warcraft without alt-tabbing. Hover an item, press Alt+Q, pick a question, and the answer appears in a small window on top of the game.

Alfred sees what you see. Ask "Is it an upgrade?" and he knows your class, spec and the gear you're wearing. Ask how to make gold and he gets your bags, your professions and your recipes, plus auction prices if you use TradeSkillMaster. Answers come from [Codex](https://developers.openai.com/codex/cli/), OpenAI's assistant, which searches the web for current guides and patch notes.

## How it works

WoW addons can't talk to the internet. The one thing they can do is put text on your clipboard. So Scallop Alfred comes in two parts:

1. **The addon** runs inside WoW. When you ask a question, it gathers what the question needs, such as the item you hovered and the gear you're wearing, and shows it as a block of text for you to copy with Ctrl+C.
2. **The desktop app** runs next to WoW. It notices the copied question, asks Codex, and shows the reply in a window that floats above the game.

The app never presses keys, reads game memory or changes anything inside WoW. You copy a question, and it reads your clipboard.

## What you need

- **Windows.** It's only been tested there. macOS should work, Linux depends on your setup.
- **A ChatGPT account that includes Codex.** Codex uses your own login, so questions count against your ChatGPT plan's limits. There is no extra bill from this project.
- **[Node.js](https://nodejs.org) 24 or later.** The download page's LTS installer is fine.
- **WoW in windowed or windowed fullscreen mode.** In exclusive fullscreen, nothing can sit on top of the game.

## Install

1. **Get the files.** On GitHub, click **Code**, then **Download ZIP**, and unzip it.
2. **Put the folder in your addons.** GitHub names it `ScallopAlfred-main`, but WoW only loads it as `ScallopAlfred`, so rename it. Move it to `World of Warcraft\_retail_\Interface\AddOns\`.
3. **Open a command prompt in that folder.** In File Explorer, open the `ScallopAlfred` folder, click the address bar, type `cmd` and press Enter.
4. **Install Codex and sign in.** Run these two commands. The second one opens your browser to sign in to ChatGPT.
   ```
   npm install -g @openai/codex
   codex login
   ```
5. **Install and start the app.**
   ```
   npm install
   npm start
   ```
   A scallop icon appears in your system tray. Keep the app running while you play.
6. **Turn on the addon.** In WoW's character screen, open **AddOns** and tick **Scallop Alfred**. If WoW was already running, restart it.

Next time you play, you only need step 3 and `npm start`.

## Asking a question

Press **Alt+Q** in game. A menu opens. Pick a question, then press **Ctrl+C** to copy it. The menu closes when you let go, and the answer starts appearing in the overlay.

You can't ask during combat, because WoW locks addons down then.

What the menu offers depends on what you're doing.

**Hovering something.** Hover an item, spell, quest, currency or achievement before pressing Alt+Q, and you get ready-made questions about it. Items get "What's this for?", "Is it an upgrade?", "Keep, sell or disenchant?" and "Where does it drop?". Quests work from the quest log and the map too, but not from the objective tracker.

**Targeting an NPC.** With nothing hovered and an NPC targeted, you get "What should I know about my target?". In some places, like delves, WoW hides who the target is. Alfred tells you, and you can type its name in a custom question instead.

**Anything else.** These buttons are always there:

| Button | What it does |
| --- | --- |
| **Game mechanics** | Opens a box for any question about how the game works |
| **Professions** | Opens a box for profession questions, and sends your specialisation points for every expansion that has them |
| **My gear** | Opens a box for gear questions, and sends everything you're wearing plus your talents |
| **Make gold** | Asks straight away how to make gold with what you have |
| **Custom question** | Opens a box for anything at all |

**Green buttons** only show up when they apply:

| Button | Shows up when | What it asks |
| --- | --- | --- |
| **Great Vault** | The vault window is open and has rewards to claim | Which reward to pick, weighed against your gear and talents |
| **Selected achievement** | You've clicked an achievement in the Achievements window | How to earn it, step by step, with your progress on each part |
| **Altar of Corrosion** | The Altar's talent window is open | What to buy next with your Spirit Corrosion |
| **Corrosive Codex** | The Codex window is open, at the Altar or a Delve projection | Which power to unlock or equip next |

**Asking about several things at once.** In any question box, Shift-click links to add them, up to eight. Press Enter, then Ctrl+C to copy.

**If Alt+Q is taken,** bind **Scallop Alfred: Ask about a tooltip or link** in WoW's keybindings instead.

### Tips for better answers

- **Make gold** reads your bank and Warband bank only while those windows are open, and recipes only from the profession window you have open. Open the bank and the profession you want to craft with, then ask.
- **Professions** needs WoW to have loaded your specialisations. If the answer says they're missing, open that profession's Specializations tab and ask again.
- With [TradeSkillMaster](https://tradeskillmaster.com) installed, items come with TSM's saved auction prices. Without it, Alfred can't quote prices.

## Following up

Click the reply in the overlay and press Enter to open a follow-up box, then Enter again to send. Follow-ups reuse the game data from your first question. To send fresh data, ask again from WoW.

You can also follow up from WoW's chat. Type `/q` and your question, Shift-clicking any links into the line, then copy it as usual. It continues whatever thread the overlay is showing. WoW's 255-character chat limit leaves room for two or three links. If another addon already uses `/q`, use `/alfred`.

After typing in the overlay, click back into WoW so your keyboard goes to the game again.

## The overlay

- **Move it** by dragging the top bar. It remembers where you left it.
- **Resize it** with the grips on the bottom and left edges.
- **Fade** in the top bar makes it see-through until you point at it.
- **Hide** tucks it away. Replies keep coming in. To bring it back, click the tray icon, or click Alfred's button on the minimap and press Ctrl+C.
- **←** shows your past conversations. The box icon archives one. Archived ones sit at the bottom, where you can restore or delete them.
- **Double-click the title** to rename a conversation. Clear it and press Enter to let Codex pick a name.
- **Browse** turns the overlay into a small web browser for Wowhead, X or anything else. It stays signed in between sessions. While it's open it takes your keyboard, so click **Ask** or click into WoW to get it back.

Right-click the tray icon to copy the last answer, retry or cancel a question, switch between the Original and Wowhead colour themes, or open the settings.

## What leaves your computer

- **Your question and its game data go to OpenAI** through Codex, under your ChatGPT account. That includes your character's name, class, spec, level and item level, your profession skills, and whatever the question added: hovered items, your gear, your bags.
- **Link icons.** For a Wowhead item link, the app asks Wowhead for that item's icon, sending only the item number. For other links, it asks Google for the site's icon, sending only the site name.
- **Everything else stays local.** Conversations live in `threads.sqlite` in `%APPDATA%\Scallop Alfred`.

## Settings

Right-click the tray icon and choose **Open settings**. It opens `settings.json`. Save it and restart the app for changes to apply.

| Setting | Default | What it does |
| --- | --- | --- |
| `model` | `gpt-6-astra` | The Codex model. Leave it empty to use Codex's default |
| `codexPath` | empty | Where Codex is installed, if the app can't find it. On Windows, point it at `codex.exe` |
| `fontSize` | `14` | Text size, 12 to 28 |
| `theme` | `original` | `original` or `wowhead` |
| `fade` | `false` | Same as the Fade box |
| `timeoutSeconds` | `180` | How long to wait for an answer, 10 to 600 |
| `width`, `height` | `380`, `640` | Overlay size in pixels. Dragging the grips sets these |
| `x`, `y` | `null` | Overlay position. `null` puts it near the top right, clear of the minimap |
| `browseUrl` | `https://x.com` | Where Browse opens. The app updates it to the last page you visited |

The app runs Codex read-only with web search on. It turns off Codex's ability to run commands, and any plugins or MCP servers you've set up for Codex elsewhere. Your other Codex settings still apply.

## Troubleshooting

**Nothing happens after I copy.** Check the app is running. Its scallop icon should be in your system tray. The app ignores whatever was already on your clipboard when it started, so copy something else, then copy the question again.

**"Invalid Scallop Alfred request".** The addon and app are different versions. After updating, type `/reload` in WoW and restart the app.

**"Codex was not found".** Close and reopen your command prompt after installing Codex, or set `codexPath` in the settings.

**The overlay is behind the game.** Switch WoW to windowed or windowed fullscreen.

## For developers

`npm run check` type-checks the app and the tests. `npm test` runs the addon's Lua against a mocked WoW API, unit-tests the app, and drives the real Electron app with a fake clipboard, tray and Codex, so tests never touch your clipboard or a model. The mocks can't prove everything works in the real game, so check changes in WoW too.

## Licence

The code is [MIT licensed](LICENSE). The shell and coin icons in `assets` belong to Blizzard Entertainment and aren't covered by that licence. World of Warcraft is a trademark of Blizzard Entertainment. This project isn't affiliated with Blizzard, OpenAI, Wowhead or TradeSkillMaster.
