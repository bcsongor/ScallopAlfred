import { nativeImage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { webUrl } from "./markdown.ts";

const maxDownloadBytes = 256 * 1024;

async function download(hostname: string): Promise<Buffer | undefined> {
  const url = new URL("https://www.google.com/s2/favicons");
  url.search = new URLSearchParams({ domain: hostname, sz: "32" }).toString();
  const response = await fetch(url, { signal: AbortSignal.timeout(5000), credentials: "omit" });
  if (!response.ok || !response.body) return undefined;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxDownloadBytes) return undefined;
    chunks.push(chunk);
  }
  const icon = nativeImage.createFromBuffer(Buffer.concat(chunks));
  return icon.isEmpty() ? undefined : icon.resize({ width: 16, height: 16 }).toPNG();
}

/** Fetches icons by hostname through a fixed provider, never from model-supplied image URLs. */
export function createFavicons(directory: string) {
  const icons = new Map<string, Promise<string | undefined>>();

  async function load(hostname: string): Promise<string | undefined> {
    const path = join(directory, `${createHash("sha256").update(hostname).digest("hex")}.png`);
    const png = await readFile(path)
      .catch(async () => {
        const downloaded = await download(hostname);
        if (downloaded) {
          await mkdir(directory, { recursive: true });
          await writeFile(path, downloaded);
        }
        return downloaded;
      })
      .catch(() => undefined);
    return png && `data:image/png;base64,${png.toString("base64")}`;
  }

  return (target: unknown): Promise<string | undefined> => {
    const url = webUrl(target);
    if (!url) return Promise.resolve(undefined);
    const { hostname } = new URL(url);
    const icon = icons.get(hostname) ?? load(hostname);
    icons.set(hostname, icon);
    return icon;
  };
}
