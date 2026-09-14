import MarkdownIt from "markdown-it";

/** Only web URLs can leave the overlay; local files and application schemes cannot. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
markdown.validateLink = url => webUrl(url) !== undefined;

export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
