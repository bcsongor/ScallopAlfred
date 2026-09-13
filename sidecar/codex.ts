import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { text as streamText } from "node:stream/consumers";
import { z } from "zod";
import { errorMessage } from "./errors.ts";
import type { WoWRequest } from "./protocol.ts";

export type Session = { context: string; id: string };
export type Answer = { text: string; session: Session };
export type Ask = (request: WoWRequest, options: { signal: AbortSignal; session?: Session }) => Promise<Answer>;
export type CodexOptions = { codexPath: string; model: string; workspace: string };
type RunOptions = { executable: string; args: string[]; prompt: string; cwd: string; signal: AbortSignal };

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("thread.started"), thread_id: z.string() }),
  z.object({ type: z.literal("item.completed"), item: z.object({ type: z.string(), text: z.string().optional() }) }),
  z.object({ type: z.literal("turn.completed") }),
  z.object({ type: z.literal("turn.failed"), error: z.object({ message: z.string() }).nullish() }),
  z.object({ type: z.literal("error"), message: z.string().optional() }),
]);

type CodexEvent = z.infer<typeof eventSchema>;
type Run = { threadId: string; text: string; completed: boolean; failure?: string; diagnostic?: string };

const promptTemplate = readFileSync(join(import.meta.dirname, "prompt.md"), "utf8").trimEnd();
const apiKeyVariables = new Set(["OPENAI_API_KEY", "CODEX_API_KEY"]);

export function createCodex({ codexPath, model, workspace }: CodexOptions): Ask {
  return async (request, { signal, session }) => {
    const { text, threadId } = await runCodex({
      executable: findCodex(codexPath),
      args: codexArguments(request, model, session),
      prompt: buildPrompt(request),
      cwd: workspace,
      signal,
    });
    return { text, session: { context: request.context, id: threadId } };
  };
}

function findCodex(configuredPath: string): string {
  if (configuredPath) return configuredPath;
  if (process.platform !== "win32") return "codex";
  const found = (process.env.PATH ?? "").split(delimiter).flatMap(windowsExecutables).find(path => existsSync(path));
  if (!found) throw new Error("Codex was not found. Install Codex CLI or set codexPath to its native executable in settings.");
  return found;
}

/** npm installs Codex behind a shim. Running the native binary instead keeps a shell from interpreting arguments. */
function windowsExecutables(folder: string): string[] {
  const executable = join(folder, "codex.exe");
  const manifest = join(folder, "node_modules", "@openai", "codex", "package.json");
  if (!existsSync(manifest)) return [executable];
  try {
    const platformPackage = createRequire(manifest).resolve(`@openai/codex-win32-${process.arch}/package.json`);
    const vendor = join(dirname(platformPackage), "vendor", `${process.arch === "arm64" ? "aarch64" : "x86_64"}-pc-windows-msvc`);
    return [executable, join(vendor, "bin", "codex.exe"), join(vendor, "codex", "codex.exe")];
  } catch {
    return [executable];
  }
}

export function codexArguments(request: WoWRequest, model: string, session?: Session): string[] {
  const resume = request.thread === "continue" && session?.context === request.context ? ["resume", session.id] : [];
  return [
    "exec", "--json", "--skip-git-repo-check", "--ignore-user-config",
    "--sandbox", "read-only",
    "-c", 'approval_policy="never"',
    "-c", 'web_search="live"',
    "-c", 'model_reasoning_effort="medium"',
    "-c", 'service_tier="fast"',
    "-c", "features.shell_tool=false",
    ...(model ? ["--model", model] : []),
    ...resume,
    "-",
  ];
}

export function buildPrompt(request: WoWRequest): string {
  return `${promptTemplate.replace("{{date}}", new Date().toISOString().slice(0, 10))}\n\n${JSON.stringify(request)}`;
}

function codexEnvironment(): NodeJS.ProcessEnv {
  // Without an API key, Codex uses the player's login.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !apiKeyVariables.has(name)));
  if (process.platform === "win32") return env;
  // GUI launches on macOS and Linux may not inherit the shell's PATH.
  return { ...env, PATH: [env.PATH, join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter) };
}

function parseEvent(line: string): CodexEvent[] {
  try {
    const parsed = eventSchema.safeParse(JSON.parse(line));
    return parsed.success ? [parsed.data] : [];
  } catch {
    return [];
  }
}

function applyEvent(run: Run, event: CodexEvent): Run {
  switch (event.type) {
    case "thread.started": return { ...run, threadId: event.thread_id };
    case "item.completed": return event.item.type === "agent_message" ? { ...run, text: event.item.text ?? "" } : run;
    case "turn.completed": return { ...run, completed: true };
    case "turn.failed": return { ...run, failure: event.error?.message ?? "Codex could not answer this question." };
    case "error": return { ...run, diagnostic: event.message ?? "Codex reported an error." };
  }
}

function exitCode(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => child.once("close", resolve).once("error", reject));
}

/** A run succeeds only when Codex completes the turn with an answer and a thread ID to resume. */
export async function runCodex({ executable, args, prompt, cwd, signal }: RunOptions): Promise<{ text: string; threadId: string }> {
  const child = spawn(executable, args, { cwd, env: codexEnvironment(), windowsHide: true, signal, killSignal: "SIGKILL" });
  child.stdin.on("error", () => { /* The process exit reports why input could not be written. */ });
  child.stdin.end(prompt);
  const [lines, stderr, code] = await Promise.all([
    Array.fromAsync(createInterface({ input: child.stdout })),
    streamText(child.stderr),
    exitCode(child),
  ]).catch((error: unknown) => {
    throw new Error(signal.aborted ? String(signal.reason) : `Could not start Codex: ${errorMessage(error)}`);
  });
  const run = lines.flatMap(parseEvent).reduce<Run>(applyEvent, { threadId: "", text: "", completed: false });
  const answer = run.text.trim();
  if (code !== 0 || run.failure || !run.completed || !answer || !run.threadId) {
    throw new Error(run.failure || run.diagnostic || stderr.slice(-1500).trim() || "Codex returned no answer. Check that codex login is complete.");
  }
  return { text: answer, threadId: run.threadId };
}
