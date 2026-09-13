import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { webUrl } from "./markdown.ts";

/** Fetch only hostnames through a fixed provider, never model-supplied image URLs. */
export function createFavicons(directory: string) {
  const icons = new Map<string, Promise<string | undefined>>();

  async function load(hostname: string): Promise<string | undefined> {
    const path = join(directory, createHash("sha256").update(hostname).digest("hex") + ".png");
    try {
      return "data:image/png;base64," + (await readFile(path)).toString("base64");
    } catch { /* A missing cache entry is fetched below. */ }
    try {
      const url = new URL("https://www.google.com/s2/favicons");
      url.search = new URLSearchParams({ domain: hostname, sz: "32" }).toString();
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: "omit" });
      if (!response.ok || !response.body) return;
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 256 * 1024) return;
        chunks.push(chunk);
      }
      const icon = nativeImage.createFromBuffer(Buffer.concat(chunks));
      if (icon.isEmpty()) return;
      const png = icon.resize({ width: 16, height: 16 }).toPNG();
      await mkdir(directory, { recursive: true });
      await writeFile(path, png);
      return "data:image/png;base64," + png.toString("base64");
    } catch {
      // Offline, missing or invalid icons leave an ordinary clickable link.
    }
  }

  return (target: unknown): Promise<string | undefined> => {
    const url = webUrl(target);
    if (!url) return Promise.resolve(undefined);
    const hostname = new URL(url).hostname;
    let icon = icons.get(hostname);
    if (!icon) {
      icon = load(hostname);
      icons.set(hostname, icon);
    }
    return icon;
  };
}
