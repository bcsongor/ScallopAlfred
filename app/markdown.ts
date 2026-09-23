import MarkdownIt, { type StateCore, type Token } from "markdown-it";
import { webUrl } from "./address.ts";

const coins = ["gold", "silver", "copper"] as const;

/** The digits for each coin, in `coins` order, with `undefined` where the amount omits one. */
type MoneyMeta = { amounts: (string | undefined)[] };

/**
 * Money as the prompt asks for it: whole gold with an optional silver and copper tail, such as
 * `1,234g 56s 7c`. Gold is required so seconds like `2s` never turn into coins.
 */
const money = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)g(?: (\d{1,2})s)?(?: (\d{1,2})c)?(?!\w)/g;

/** Splits a text token around each money amount, leaving the text between untouched. */
function moneyTokens(text: Token, state: StateCore): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const match of text.content.matchAll(money)) {
    if (match.index > last) tokens.push(plain(text.content.slice(last, match.index), state, text.level));
    const token = new state.Token("money", "", 0);
    token.level = text.level;
    token.meta = { amounts: match.slice(1, 4) } satisfies MoneyMeta;
    tokens.push(token);
    last = match.index + match[0].length;
  }
  if (!tokens.length) return [text];
  if (last < text.content.length) tokens.push(plain(text.content.slice(last), state, text.level));
  return tokens;
}

function plain(content: string, state: StateCore, level: number): Token {
  const token = new state.Token("text", "", 0);
  token.content = content;
  token.level = level;
  return token;
}

/** Runs after inline parsing so code spans and link URLs are already their own tokens. */
function moneyRule(state: StateCore): void {
  for (const block of state.tokens) {
    if (block.type !== "inline" || !block.children) continue;
    block.children = block.children.flatMap(child => child.type === "text" ? moneyTokens(child, state) : [child]);
  }
}

const markdown = new MarkdownIt({ html: false, linkify: true }).disable("image");
markdown.validateLink = url => webUrl(url) !== undefined;
markdown.core.ruler.push("money", moneyRule);
markdown.renderer.rules.money = (tokens, index) => {
  const { amounts } = tokens[index]?.meta as MoneyMeta;
  const parts = coins.flatMap((coin, position) => {
    const amount = amounts[position];
    return amount === undefined ? [] : [`${amount}<img class="coin" src="../assets/${coin}.gif" alt=" ${coin}">`];
  });
  return `<span class="money">${parts.join(" ")}</span>`;
};

export function renderMarkdown(text: string): string {
  return markdown.render(text);
}
