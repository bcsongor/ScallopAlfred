/** Only web URLs can leave the overlay; local files and application schemes cannot. */
export function webUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !URL.canParse(value)) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
}

/**
 * Turns what the player typed in the address bar into a URL to load. A bare hostname gets https,
 * and only http(s) ever loads, so `file:` and `javascript:` go nowhere.
 */
export function browseUrl(input: string): string | undefined {
  const text = input.trim();
  const direct = webUrl(text);
  if (direct) return direct;
  // Without a scheme the text only parses once https is added. Requiring a dot keeps stray words out.
  return /^[^\s/:]+\.[^\s/:?#]/.test(text) ? webUrl(`https://${text}`) : undefined;
}
