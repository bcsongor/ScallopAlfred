import MarkdownIt from "markdown-it";

/** Only web URLs can leave the overlay; local files and application schemes cannot. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {
    // Malformed destinations stay inert.
  }
}

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
markdown.validateLink = (url) => webUrl(url) !== undefined;

/** Render formatting without raw HTML or embedded images. */
export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
