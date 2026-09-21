import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test, type TestContext } from "node:test";
import { launch, until } from "./fixtures/launch.ts";

/** A player the size of a feed video, with a listener recording what the page is told. */
const player = '<title>F</title><body style="margin:0;padding:0">'
  // A transformed wrapper, the way a feed nests its player. It would otherwise trap a fixed element.
  + '<div id="feed" style="transform:translateY(0);width:240px;overflow:hidden">'
  + '<div id="player" style="width:200px;height:100px;background:#333"><video id="video"></video></div></div>'
  + '<script>window.changes=[];document.addEventListener("fullscreenchange",function(){'
  + 'window.changes.push(document.fullscreenElement?document.fullscreenElement.id:null)});</script></body>';

async function serve(t: TestContext): Promise<string> {
  const server = createServer((_incoming, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(player);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); }));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  return `http://127.0.0.1:${address.port}/`;
}

test("a player's fullscreen button fills the pane", { timeout: 60000 }, async t => {
  const home = await serve(t);
  const desktop = await launch(t, { width: 500, height: 420, browseUrl: home });
  await desktop.waitForStatus("ready");
  await desktop.page.getByRole("tab", { name: "Browse" }).click();
  await until(async () => (await desktop.browse()).title === "F", "the test page never loaded");

  const state = async () => JSON.parse(await desktop.inBrowsedPage(`JSON.stringify({
    element: document.fullscreenElement ? document.fullscreenElement.id : null,
    parent: document.getElementById("player").parentElement.id || "host",
    width: Math.round(document.getElementById("player").getBoundingClientRect().width),
    pane: innerWidth,
    // The feed positions its items with this. Clearing it is what collapses a real feed.
    feed: document.getElementById("feed").style.transform,
    // A player's own controls read these to decide whether its button should minimise.
    flags: [document.fullscreen, document.webkitIsFullScreen],
    changes: window.changes,
  })`) as string);

  /**
   * Fires a call that this Electron version leaves pending forever when unpatched, and reports
   * whether it settled. Awaiting it directly would hang the test instead of failing it.
   */
  const settles = (expression: string) => desktop.inBrowsedPage(`Promise.race([
    (${expression}).then(function () { return "settled"; }, function () { return "rejected"; }),
    new Promise(function (resolve) { setTimeout(function () { resolve("pending"); }, 5000); }),
  ])`);

  // Read from the window rather than written down, so the pane's insets are free to change.
  const pane = await desktop.inBrowsedPage("innerWidth") as number;
  const settled = {
    element: null, parent: "feed", width: 200, pane, feed: "translateY(0px)", flags: [false, false], changes: [],
  };
  assert.deepEqual(await state(), settled);

  // Electron never answers this in an embedded view, so the stand-in has to settle it itself. The
  // player moves into a host of its own and fills the pane, and the feed's own layout is left alone.
  assert.equal(await settles('document.getElementById("player").requestFullscreen()'), "settled");
  assert.deepEqual(await state(), {
    ...settled, element: "player", parent: "host", width: pane, flags: [true, true], changes: ["player"],
  });

  // Leaving puts the player back in the gap it came from and tells the page, so its controls follow.
  assert.equal(await settles("document.exitFullscreen()"), "settled");
  assert.deepEqual(await state(), { ...settled, changes: ["player", null] });

  // A minimise button may call the older name for leaving, so that has to work too.
  assert.equal(await settles('document.getElementById("player").requestFullscreen()'), "settled");
  assert.equal(await settles("document.webkitCancelFullScreen()"), "settled");
  assert.deepEqual(await state(), { ...settled, changes: ["player", null, "player", null] });

  // The pane asks for mobile layouts, whose players reach for the iOS video methods instead.
  assert.equal(await settles('document.getElementById("video").webkitEnterFullscreen()'), "settled");
  await until(async () => (await state()).element === "video", "the video never went fullscreen");
  assert.equal(await desktop.inBrowsedPage("document.getElementById('video').webkitDisplayingFullscreen"), true);

  // Escape leaves, the way a real fullscreen would.
  await desktop.inBrowsedPage('window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); "sent"');
  await until(async () => (await state()).element === null, "Escape did not leave fullscreen");

  // A second page gets the stand-in too, because it is installed for every document.
  await desktop.emit("browse-navigate", `${home}again`);
  await until(async () => (await desktop.browse()).url.includes("again"), "the second page never loaded");
  await until(async () => await desktop.inBrowsedPage("!!window.__scallopFullscreen"), "the stand-in never installed");
  assert.equal(await settles('document.getElementById("player").requestFullscreen()'), "settled");
  assert.equal((await state()).parent, "host");
});
