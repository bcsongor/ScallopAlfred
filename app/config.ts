import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

export const heightRange = { min: 320, max: 1600 } as const;
// Wide enough to browse a site comfortably, since the same window now holds the browse tab.
export const widthRange = { min: 280, max: 1600 } as const;

const configSchema = z.object({
  codexPath: z.string().default(""),
  model: z.string().default("gpt-6-astra"),
  width: z.number().int().min(widthRange.min).max(widthRange.max).default(380),
  height: z.number().int().min(heightRange.min).max(heightRange.max).default(640),
  x: z.number().int().nullable().default(null),
  y: z.number().int().nullable().default(null),
  fontSize: z.number().int().min(12).max(28).default(14),
  theme: z.enum(["original", "wowhead"]).default("original"),
  timeoutSeconds: z.number().int().min(10).max(600).default(180),
  /** Where the browse tab opens. It records the last page so the tab returns there. */
  browseUrl: z.string().default("https://x.com"),
});

export type Config = z.infer<typeof configSchema>;

export type AppearanceChanges = Partial<Pick<Config, "width" | "height" | "x" | "y" | "theme" | "browseUrl">>;

/** Returns a writer that saves changes one at a time, so saving the theme and height together keeps both. */
export function createSettingsWriter(path: string): (changes: AppearanceChanges) => Promise<void> {
  let queue = Promise.resolve();
  return changes => {
    const saved = queue.then(async () => {
      const config = await loadConfig(path);
      await writeFile(path, JSON.stringify({ ...config, ...changes }, null, 2) + "\n");
    });
    queue = saved.catch(() => undefined);
    return saved;
  };
}

export async function loadConfig(path: string): Promise<Config> {
  try {
    return configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const defaults = configSchema.parse({});
      await writeFile(path, JSON.stringify(defaults, null, 2) + "\n");
      return defaults;
    }
    throw new Error(`Fix the settings in ${path}, then restart Scallop Alfred.`, { cause: error });
  }
}
