/**
 * A stand-in for the Fullscreen API, installed in every page the browse tab loads. An embedded
 * `WebContentsView` never answers `requestFullscreen`: the request neither resolves nor rejects,
 * and Electron's `enter-html-full-screen` never fires, so a video player's fullscreen button
 * appears dead. Rather than hand the page to the real browser, which loses a video found by
 * scrolling a feed, this moves the element into a pane-sized host of its own and reports the state
 * the player expects. Escape leaves, and leaving puts the element back exactly where it was.
 *
 * Moving it is what keeps the rest of the page intact. Styling it `fixed` where it sits reads
 * simpler and was tried first, but a transform or paint containment on any ancestor anchors a fixed
 * element to that ancestor instead of the pane, and clearing those to get around it collapses a feed
 * that positions its items with transforms. Inside a host of our own there is nothing to escape.
 *
 * Every style goes through the elements' style properties rather than a stylesheet, because the
 * strict `style-src` these sites send blocks an injected `<style>` and leaves these alone.
 *
 * Known limit: a player's own minimise button may still do nothing, so Escape is the way out. The
 * prefixed names below cover the ones a player might call, including the iOS video methods that a
 * mobile layout reaches for, but Chromium's built-in video controls do not go through any of them.
 */
export const fullscreenShim = `(function () {
  if (window.__scallopFullscreen) return;
  window.__scallopFullscreen = true;

  var current = null;
  var host = null;
  var origin = null;
  var saved = [];

  // The host is ours, so it owes the page nothing and needs no restoring.
  function hostStyles() {
    return [
      ["position", "fixed"], ["top", "0px"], ["left", "0px"],
      ["width", window.innerWidth + "px"], ["height", window.innerHeight + "px"],
      ["margin", "0px"], ["padding", "0px"], ["border", "0px"], ["background", "#000"],
      ["display", "flex"], ["align-items", "center"], ["justify-content", "center"],
      ["z-index", "2147483647"]
    ];
  }

  // Inside the host a percentage resolves against the host, so these need no pixel sizes.
  var FILL = [
    ["position", "static"], ["inset", "auto"], ["width", "100%"], ["height", "100%"],
    ["min-width", "0px"], ["min-height", "0px"], ["max-width", "none"], ["max-height", "none"],
    ["margin", "0px"], ["transform", "none"], ["display", "block"]
  ];

  var VIDEO = [["width", "100%"], ["height", "100%"], ["max-height", "none"], ["object-fit", "contain"]];

  function assign(node, declarations) {
    for (var i = 0; i < declarations.length; i++) {
      node.style.setProperty(declarations[i][0], declarations[i][1], "important");
    }
  }

  /** Styles an element the page owns, remembering what to put back. */
  function apply(node, declarations) {
    var previous = [];
    for (var i = 0; i < declarations.length; i++) {
      var name = declarations[i][0];
      previous.push([name, node.style.getPropertyValue(name), node.style.getPropertyPriority(name)]);
    }
    saved.push([node, previous]);
    assign(node, declarations);
  }

  function restore() {
    for (var i = saved.length - 1; i >= 0; i--) {
      var node = saved[i][0];
      var previous = saved[i][1];
      for (var j = 0; j < previous.length; j++) {
        if (previous[j][1]) node.style.setProperty(previous[j][0], previous[j][1], previous[j][2]);
        else node.style.removeProperty(previous[j][0]);
      }
    }
    saved = [];
  }

  function announce(node) {
    var events = ["fullscreenchange", "webkitfullscreenchange"];
    for (var i = 0; i < events.length; i++) {
      node.dispatchEvent(new Event(events[i], { bubbles: true }));
    }
  }

  function enter(node) {
    if (current === node) return Promise.resolve();
    if (current) leave();
    if (!node.parentElement || !document.body) return Promise.resolve();
    origin = { parent: node.parentElement, next: node.nextSibling };
    host = document.createElement("div");
    assign(host, hostStyles());
    document.body.appendChild(host);
    host.appendChild(node);
    apply(node, FILL);
    var videos = node.tagName === "VIDEO" ? [node] : node.querySelectorAll("video");
    for (var i = 0; i < videos.length; i++) apply(videos[i], VIDEO);
    apply(document.documentElement, [["overflow", "hidden"]]);
    current = node;
    announce(node);
    return Promise.resolve();
  }

  function leave() {
    var previous = current;
    current = null;
    restore();
    // Back into the exact gap it came from, so the page carries on as though nothing moved.
    if (previous && origin) {
      try {
        origin.parent.insertBefore(previous, origin.next);
      } catch (error) {
        origin.parent.appendChild(previous);
      }
    }
    origin = null;
    if (host) host.remove();
    host = null;
    announce(previous || document);
    return Promise.resolve();
  }

  function define(target, name, get) {
    Object.defineProperty(target, name, { configurable: true, get: get });
  }

  function currentElement() { return current; }
  function isFullscreen() { return current !== null; }
  function supported() { return true; }

  // A control that calls a name we missed reaches the dead Electron path, and one that reads a flag
  // we missed decides it is not fullscreen and does nothing.
  var ENTERS = ["requestFullscreen", "webkitRequestFullscreen", "webkitRequestFullScreen"];
  var LEAVES = ["exitFullscreen", "webkitExitFullscreen", "webkitCancelFullScreen"];

  for (var e = 0; e < ENTERS.length; e++) {
    Element.prototype[ENTERS[e]] = function () { return enter(this); };
  }
  for (var l = 0; l < LEAVES.length; l++) {
    Document.prototype[LEAVES[l]] = function () { return leave(); };
  }

  define(Document.prototype, "fullscreenElement", currentElement);
  define(Document.prototype, "webkitFullscreenElement", currentElement);
  define(Document.prototype, "fullscreen", isFullscreen);
  define(Document.prototype, "webkitIsFullScreen", isFullscreen);
  define(Document.prototype, "fullscreenEnabled", supported);
  define(Document.prototype, "webkitFullscreenEnabled", supported);

  if (window.HTMLVideoElement) {
    HTMLVideoElement.prototype.webkitEnterFullscreen = function () { return enter(this); };
    HTMLVideoElement.prototype.webkitExitFullscreen = function () { return leave(); };
    define(HTMLVideoElement.prototype, "webkitSupportsFullscreen", supported);
    define(HTMLVideoElement.prototype, "webkitDisplayingFullscreen", function () { return current === this; });
  }

  window.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && current) leave();
  }, true);

  // Resizing the overlay while fullscreen has to take the host with it.
  window.addEventListener("resize", function () {
    if (host) assign(host, hostStyles());
  });
})();`
