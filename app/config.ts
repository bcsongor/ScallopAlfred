import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

export const heightRange = { min: 320, max: 1600 } as const;
// Wide enough to browse a site comfortably in the browse tab.
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
  /** Fades the overlay while the pointer is elsewhere, so the game shows through. */
  fade: z.boolean().default(false),
  timeoutSeconds: z.number().int().min(10).max(600).default(180),
  /** Where the browse tab opens. It records the last page so the tab returns there. */
  browseUrl: z.string().default("https://x.com"),
});

export type Config = z.infer<typeof configSchema>;

export type SettingsWriter = {
  save(changes: Partial<Config>): Promise<void>;
  /** Resolves once every save started so far has finished, so quitting doesn't cut one short. */
  settled(): Promise<void>;
};

/** Saves changes one at a time, so saving the theme and height together keeps both. */
export function createSettingsWriter(path: string): SettingsWriter {
  let queue = Promise.resolve();
  return {
    save(changes) {
      const saved = queue.then(async () => write(path, { ...await loadConfig(path), ...changes }));
      queue = saved.catch(() => undefined);
      return saved;
    },
    settled: () => queue,
  };
}

// A plain write rather than write-and-rename: on Windows, renaming over a file fails while anything,
// such as a virus scanner, has it open.
function write(path: string, config: Config): Promise<void> {
  return writeFile(path, JSON.stringify(config, null, 2) + "\n");
}

export async function loadConfig(path: string): Promise<Config> {
  try {
    return configSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      const defaults = configSchema.parse({});
      await write(path, defaults);
      return defaults;
    }
    throw new Error(`Fix the settings in ${path}, then restart Scallop Alfred.`, { cause: error });
  }
}
