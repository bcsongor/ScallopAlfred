import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { webUrl } from "./address.ts";

/** A link's icon as a data URL, with the item quality when the link points at a WoW item. */
export type LinkIcon = { icon: string; quality?: number };

/** What the cache stores: the same icon as bare base64. */
type CachedIcon = { icon: string; quality?: number };

const maxDownloadBytes = 256 * 1024;

/** `/item=228721`, `/item/228721` and `/item=228721/hearty-feast`, optionally behind a locale like `/de`. */
const itemPath = /^(?:\/[a-z]{2})?\/item[=/](\d{1,9})(?:\/|$)/i;

const tooltipSchema = z.object({
  icon: z.string().regex(/^[a-z0-9_-]+$/i),
  quality: z.number().int().min(0).max(8).optional(),
});

const cachedSchema: z.ZodType<CachedIcon> = z.object({ icon: z.string(), quality: z.number().optional() });

async function download(fetch: typeof globalThis.fetch, url: URL): Promise<Buffer | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: "omit" });
  if (!response.ok || !response.body) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxDownloadBytes) return undefined;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toPng(bytes: Buffer | undefined): string | undefined {
  if (!bytes) return undefined;
  const image = nativeImage.createFromBuffer(bytes);
  return image.isEmpty() ? undefined : image.resize({ width: 16, height: 16 }).toPNG().toString("base64");
}

/**
 * Fetches link icons through fixed providers, never from model-supplied image URLs: hostnames go to
 * Google's favicon service, and item links reach Wowhead's tooltip and icon hosts by ID alone.
 */
export function createIcons(directory: string, fetch: typeof globalThis.fetch) {
  const icons = new Map<string, Promise<LinkIcon | undefined>>();

  async function fetchFavicon(hostname: string): Promise<CachedIcon | undefined> {
    const url = new URL("https://www.google.com/s2/favicons");
    url.search = new URLSearchParams({ domain: hostname, sz: "32" }).toString();
    const icon = toPng(await download(fetch, url));
    return icon === undefined ? undefined : { icon };
  }

  async function fetchItem(id: string): Promise<CachedIcon | undefined> {
    const body = await download(fetch, new URL(`https://nether.wowhead.com/tooltip/item/${id}?dataEnv=1&locale=0`));
    const tooltip = body && tooltipSchema.safeParse(JSON.parse(body.toString("utf8")));
    if (!tooltip?.success) return undefined;
    const source = new URL(`https://wow.zamimg.com/images/wow/icons/small/${tooltip.data.icon.toLowerCase()}.jpg`);
    const icon = toPng(await download(fetch, source));
    return icon === undefined ? undefined : { icon, quality: tooltip.data.quality };
  }

  async function load(key: string, fetchIcon: () => Promise<CachedIcon | undefined>): Promise<LinkIcon | undefined> {
    const path = join(directory, `${createHash("sha256").update(key).digest("hex")}.json`);
    const cached = await readFile(path, "utf8")
      .then(text => cachedSchema.parse(JSON.parse(text)))
      .catch(async () => {
        const fetched = await fetchIcon();
        if (fetched) {
          await mkdir(directory, { recursive: true });
          await writeFile(path, JSON.stringify(fetched));
        }
        return fetched;
      })
      .catch(() => undefined);
    return cached && { icon: `data:image/png;base64,${cached.icon}`, quality: cached.quality };
  }

  return (target: unknown): Promise<LinkIcon | undefined> => {
    const url = webUrl(target);
    if (!url) return Promise.resolve(undefined);
    const { hostname, pathname } = new URL(url);
    const wowhead = hostname === "wowhead.com" || hostname.endsWith(".wowhead.com");
    const item = wowhead ? itemPath.exec(pathname)?.[1] : undefined;
    const key = item ? `item:${item}` : `favicon:${hostname}`;
    const icon = icons.get(key) ?? load(key, item ? () => fetchItem(item) : () => fetchFavicon(hostname));
    icons.set(key, icon);
    return icon;
  };
}
