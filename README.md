# Scallop Alfred

Ask Codex about WoW items, spells, quests and other links, then read the answer in a desktop overlay.

## Start Scallop Alfred

Install [Bun](https://bun.sh), Node.js 24 or later, and [Codex CLI](https://developers.openai.com/codex/cli/). The integration has been tested with Codex CLI 0.154.0.

1. Put this folder at `World of Warcraft/_retail_/Interface/AddOns/ScallopAlfred`.
2. Run `codex login` and sign in with your personal account.
3. Open a terminal in this folder and run:

   ```sh
   bun install
   bun start
   ```

4. Enable **Scallop Alfred** in WoW's addon list. Restart WoW if it was already open when you installed or renamed the folder.
5. Set WoW's display mode to windowed fullscreen or windowed.

The desktop app opens a small overlay and adds a tray icon. Keep it running while you play. On subsequent launches, use `bun start`. Electron loads the TypeScript source directly; there is no build step.

## Ask a question

1. Outside combat, press and release `Alt+Q`. Hover an item, spell or another supported tooltip first for questions about that subject.
2. With a tooltip, choose a preset or the grey **Custom question** button. Otherwise, choose **Game mechanics**, **Professions**, or **My gear** to open the question box. Type your question and press Enter.
3. Copy the selected request with `Ctrl+C`. On macOS, use `Cmd+C`. The copy box closes when you release the shortcut.
4. Read the answer in the overlay. To dismiss the copy box without copying, press `Esc`.

To ask about a link, choose **Game mechanics** without hovering a tooltip, or **Custom question** from a subject's menu. Shift-click a spell, quest, achievement or other link while the question box has focus. Add your question and press Enter. You can include up to eight distinct subjects, including the hovered subject. Added links keep the hovered subject, and identical links appear once. Item questions include equipment from the relevant slots.

**My gear** and the **Is it an upgrade?** preset include available items from all 19 equipment slots and your active talent build, with spell names and ranks when available. Empty or unavailable slots are omitted. The addon does not inspect other players or change your equipment or talents.

Alt+Q captures items, spells, hyperlinks and exposed quest, currency or achievement IDs from the visible game tooltip. Some UI elements do not expose a usable tooltip or route Shift-click through WoW's link insertion API. For those, type the name in your question. Links without available tooltip data still include their name and link.

With TradeSkillMaster enabled, item questions also include its available minimum buyout, region market average, region sale average, sale rate, and vendor value. Alfred uses these for selling advice. Prices come from TSM's cached data, so minimum buyout is not a live quote. Missing values are omitted. Follow-ups retain the copied snapshot; prepare a new question in WoW to read TSM again. No extra setup is required.

To continue the thread, click **Follow up** in the overlay. Each question copied from the addon starts a fresh thread. To start a general question, press `Alt+Q` without hovering a supported tooltip and choose **Game mechanics**.

General questions can cover mechanics, seasonal systems and profession choices. Alfred checks current sources for patch-dependent advice and asks for your goal when that changes the recommendation. Answers stay brief where possible, with more detail for explanations and point allocations.

Each copied question includes available profession skill levels, skill bonuses and expansion names. Only the **Professions** topic also reads unspent knowledge, path ranks and whether there are uncommitted changes. Open your profession's **Specializations** tab before asking about point allocation if those details are missing. Alfred only reads this data. Follow-ups keep the same snapshot; copy a new question through **Professions** after spending points to refresh the allocation.

Snapshots are collected when you submit a question, with no background WoW API polling. Scans have fixed limits and reuse profession metadata within the request. Blizzard's [addon policy](https://eu.forums.blizzard.com/en/wow/t/wow-user-interface-add-on-development-policy/1642) prohibits negative performance impact but states no numeric read quota. These limits are implementation choices, not Blizzard-approved allowances. This manual, out-of-combat workflow is not an assurance of Blizzard approval.

If `Alt+Q` already has a binding, assign **Scallop Alfred: Ask about a tooltip or link** in WoW's keybinding settings.

After updating from the item-only version, run `/reload` in WoW and restart the desktop app with `bun start`.

## Use the overlay

After an answer, click **Follow up**, type your question, and press Enter or click **Send**. Shift+Enter adds a line. **Cancel** or Esc closes the editor. Follow-ups use the last copied game data and thread without another clipboard copy. Use the addon again to refresh equipment or ask about a new linked subject.

Your questions and Alfred's replies are saved automatically, including pending replies and errors. A retry replaces the failed reply. A new question copied from WoW starts a fresh thread.

Click the **←** button beside the thread title to browse saved threads in creation order, newest first. Replies do not change that order. Select one to read it or ask a follow-up. Browsing does not interrupt a running reply. After a restart, the overlay opens the thread list. Follow-ups retain the saved game data; copy a new question from WoW to refresh it.

Click a thread's archive box icon to archive it immediately. The 10 newest archived threads appear in creation order as grey titles in a section pinned to the bottom of the overlay. Archiving an older thread does not move it ahead of newer threads. Active threads scroll above it; the archive section scrolls separately if needed. Click a title to read the thread. Archived threads cannot be continued or restored yet. All messages remain in the database, including older archives outside the list. A running reply finishes without moving the thread out of the archive.

History lives in `conversations.sqlite` beside the desktop settings. On Windows, this is `%APPDATA%\Scallop Alfred\conversations.sqlite`. It stores questions, replies, copied game data, and session IDs locally. Recording starts with this version; earlier threads were kept only in memory.

Questions have a muted blue background; replies use the panel background. Both are left-aligned, without speaker headings. Scrollbars use the same dark grey palette as the overlay.

The overlay stays open until you click **Hide** in its header. A running answer continues in the background. Click the scallop tray icon or choose **Show overlay** from its menu to restore and bring the overlay to the front. This works while idle, answering, or editing a follow-up. Copying a new question also restores and brings the overlay to the front when Alfred starts processing it. If an answer is running, the new question waits until it finishes.

Open the tray menu to copy the answer, retry, cancel a question, or change settings. On macOS, use the menu bar icon.

Choose **Theme → Original** or **Theme → WoWhead** in the tray menu. WoWhead uses charcoal panels, gold headings and links, red action buttons, and a sans-serif font. Switching applies immediately and keeps your current thread and draft open. Your choice is saved for the next launch.

Answers support Markdown, including lists, emphasis, code, tables and clickable source links. Links use blue text without underlines and open in your default browser. **Copy answer** copies the latest answer, preserving its Markdown and link destinations.

Source links display a small favicon when available. The app sends only the site's hostname to Google's favicon service and caches the icon in the `favicons` folder beside settings. Icon loading does not delay replies; failed downloads leave plain links. Saved threads use the same cache.

On Windows and macOS, clicks pass through to the game except over buttons, links, the resize handle, and the thread when it needs scrolling. Scroll directly over the thread to read earlier messages. New replies keep your place when you have scrolled up; otherwise the view follows the latest reply. Opening **Follow up** lets the overlay receive keyboard and mouse input. Submitting or cancelling closes the editor and restores click-through. Click back into WoW to return keyboard control to the game. New clipboard requests wait while you type. Linux keeps the overlay clickable because mouse forwarding is unavailable.

The overlay defaults to 380 × 640 pixels with 14-pixel Berkeley Mono text. It uses the locally installed font, with a monospace fallback. Drag the handle at the bottom to change its height while keeping the width fixed. The height is saved when you release the handle and restored on the next launch. Choose **Open settings** to edit the window position, width, text size, or request timeout. Restart the desktop app after editing settings. The old `hideAfterSeconds` setting is ignored.

Requests use GPT-6 Astra with medium reasoning and fast mode. Set `model` to change the model, or leave it empty to use the CLI default. Reasoning and speed are passed explicitly using [Codex configuration overrides](https://learn.chatgpt.com/docs/config-file/config-reference).

If Codex cannot be found, set `codexPath` to its executable. On Windows, use the native `codex.exe`, rather than a `.cmd` or `.ps1` shim.

Start the desktop app before copying a request. If you copied too early, copy ordinary text first, then copy the request again. While Codex is busy, only the latest copied request is retained.

## Check changes

Run `bun run check` for type checking and `bun run test` for the addon payloads and Electron clipboard flow. Neither command emits JavaScript. The test script uses Node's runner because Playwright's Electron launcher hangs under Bun's runner on Windows. Desktop tests open an overlay with an isolated clipboard and a fake Codex process. They do not change your system clipboard or make model requests.

The Windows desktop flow and a real Codex thread have been tested locally. Test the addon in WoW before relying on it; macOS and Linux have not been verified. See [the design](PLAN.md) for the protocol and platform limits.
