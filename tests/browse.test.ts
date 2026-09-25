import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { launch, request, until } from "./fixtures/launch.ts";

/** Two pages on localhost, so the browse tab has somewhere real to go without touching the network. */
async function serve(t: TestContext): Promise<string> {
  const server = createServer((incoming, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    // The first page is tall enough to overflow, so a scrollbar would show if one were not hidden.
    response.end(incoming.url === "/second"
      ? "<title>Second</title><h1>Second page</h1>"
      : '<title>First</title><h1>First page</h1><a id="popup" href="/second" target="_blank">Second</a>'
        + "<p>Filler.</p>".repeat(200));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return `http://127.0.0.1:${address.port}/`;
}

test("the browse tab opens web pages beside the threads", { timeout: 60000 }, async t => {
  const home = await serve(t);
  const desktop = await launch(t, { width: 520, height: 520, x: 80, y: 80, browseUrl: home });
  await desktop.waitForStatus("ready");
  const askTab = desktop.page.getByRole("tab", { name: "Ask" });
  const browseTab = desktop.page.getByRole("tab", { name: "Browse" });
  const address = desktop.page.getByRole("textbox", { name: "Address" });
  const title = (expected: string) => until(async () => (await desktop.browse()).title === expected, `No browsed page titled ${expected}`);

  // Nothing is created until the tab is opened, so answering questions never pays for the browser.
  assert.deepEqual(await desktop.browse(), { exists: false, attached: false, url: "", title: "", bounds: undefined });
  assert.equal(await askTab.getAttribute("aria-selected"), "true");
  assert.equal(await desktop.page.locator("#browse").isVisible(), false);

  // Opening it loads the configured page and takes the keyboard, which a web page needs.
  await browseTab.click();
  await title("First");
  assert.equal((await desktop.browse()).url, home);
  assert.equal(await address.inputValue(), home);
  assert.equal((await desktop.window()).focusable, true);
  assert.equal(await desktop.page.locator("#answer").isVisible(), false);

  // Sites see a plain desktop Chrome that agrees with its own platform, asked for its dark theme.
  const agent = await desktop.inBrowsedPage("navigator.userAgent") as string;
  assert.doesNotMatch(agent, /Electron|Mobile/);
  assert.equal(await desktop.inBrowsedPage('matchMedia("(prefers-color-scheme: dark)").matches'), true);

  // A scrollbar would cost real width in a pane this narrow, so it is hidden. Scrolling still works.
  assert.ok(await desktop.inBrowsedPage("document.documentElement.scrollHeight > innerHeight"), "the page does not overflow");
  // Hiding it happens once the document exists, so it is a moment behind the first paint.
  await until(async () => await desktop.inBrowsedPage("innerWidth - document.documentElement.clientWidth") === 0, "the scrollbar stayed");
  await desktop.inBrowsedPage("scrollTo(0, 200)");
  assert.ok((await desktop.inBrowsedPage("scrollY") as number) > 0, "the page did not scroll");

  // The native view covers the box the page laid out for it.
  const box = await desktop.page.locator("#browse-view").boundingBox();
  const { bounds } = await desktop.browse();
  assert.ok(box && bounds);
  for (const edge of ["x", "y", "width", "height"] as const) {
    assert.ok(Math.abs(box[edge] - bounds[edge]) <= 1, `${edge}: page ${box[edge]}, view ${bounds[edge]}`);
  }

  // Typing an address navigates, and the history buttons follow the page.
  await address.fill(`${home}second`);
  await address.press("Enter");
  await title("Second");
  const back = desktop.page.getByRole("button", { name: "Back", exact: true });
  const forward = desktop.page.getByRole("button", { name: "Forward", exact: true });
  await until(async () => await back.isEnabled() && !(await forward.isEnabled()));
  await back.click();
  await title("First");
  await until(() => forward.isEnabled());
  assert.equal(await address.inputValue(), home);

  // There is one pane, so a link that asks for its own window loads in place instead.
  await desktop.inBrowsedPage('document.getElementById("popup").click()');
  await title("Second");
  assert.equal(await desktop.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);

  // Only web addresses load, so the pane can't be pointed at the local disk or a script.
  for (const target of ["file:///C:/Windows/win.ini", "javascript:document.title='hijacked'", "not a url"]) {
    await desktop.emit("browse-navigate", target);
  }
  assert.equal((await desktop.browse()).title, "Second");

  // Leaving the tab puts the page away and hands the keyboard back to the game.
  await askTab.click();
  await until(async () => !(await desktop.browse()).attached);
  assert.equal((await desktop.window()).focusable, false);
  assert.equal(await desktop.page.locator("#answer").isVisible(), true);
  assert.equal((await desktop.browse()).exists, true);

  // A question arriving while browsing brings its own pane back, so the answer is never hidden.
  await browseTab.click();
  await until(async () => (await desktop.browse()).attached);
  await desktop.copy(request("While browsing"));
  await desktop.waitForAnswer("Answer: While browsing");
  assert.equal(await askTab.getAttribute("aria-selected"), "true");
  assert.equal((await desktop.browse()).attached, false);

  // The last page is remembered, so the tab reopens where it was left, even after a restart.
  await until(async () => (await desktop.settings()).browseUrl === `${home}second`);
  await desktop.restart();
  // The answered question means the restart opens the history, not a thread.
  await desktop.waitForStatus("history");
  await desktop.page.getByRole("tab", { name: "Browse" }).click();
  await title("Second");

  // Quitting from the tab saves its page before the app exits.
  await desktop.emit("browse-navigate", home);
  await title("First");
  await desktop.restart();
  assert.equal((await desktop.settings()).browseUrl, home);
});
