import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";

const configSchema = z.object({
  codexPath: z.string().default(""),
  model: z.string().default("gpt-6-astra"),
  width: z.number().int().min(280).max(800).default(380),
  height: z.number().int().min(160).max(900).default(640),
  x: z.number().int().nullable().default(null),
  y: z.number().int().nullable().default(null),
  fontSize: z.number().int().min(12).max(28).default(14),
  theme: z.enum(["original", "wowhead"]).default("original"),
  timeoutSeconds: z.number().int().min(10).max(600).default(180),
});

export type Config = z.infer<typeof configSchema>;

export async function saveAppearance(path: string, changes: Partial<Pick<Config, "height" | "theme">>): Promise<void> {
  const config = await loadConfig(path);
  await writeFile(path, JSON.stringify({ ...config, ...changes }, null, 2) + "\n");
}

/** Keep user settings outside the addon, which may live in Program Files. */
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
