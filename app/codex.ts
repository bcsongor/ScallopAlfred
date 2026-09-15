import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { z } from "zod";
import { connect, type Connection } from "./codex-connection.ts";
import { applyEvent, type Run } from "./codex-events.ts";
import type { WoWRequest } from "./protocol.ts";

export type Session = { context: string; id: string };
export type Answer = { text: string; session: Session };
type TurnResult = { text: string; threadId: string };
export type AskOptions = { signal: AbortSignal; session?: Session; onText?: (text: string) => void };
export type Ask = (request: WoWRequest, options: AskOptions) => Promise<Answer>;
export type CodexOptions = { codexPath: string; model: string; workspace: string };
type RunOptions = {
  executable: string;
  args: readonly string[];
  cwd: string;
  prompt: string;
  signal: AbortSignal;
  /** A Codex thread to resume instead of starting a new one. */
  threadId?: string;
  model?: string;
  /** Receives the answer so far whenever it grows. */
  onText?: (text: string) => void;
};
type ThreadSettings = {
  cwd: string;
  approvalPolicy: "never";
  sandbox: "read-only";
  model?: string;
  config: Record<string, boolean>;
};
export type ServerRequests = {
  initialize: { clientInfo: { name: string; title: string; version: string } };
  "config/read": { includeLayers: boolean };
  "thread/start": ThreadSettings;
  "thread/resume": ThreadSettings & { threadId: string };
  "turn/start": { threadId: string; input: { type: "text"; text: string }[]; effort: "medium" };
};

const threadResult = z.object({ thread: z.object({ id: z.string().min(1) }) });
const configResult = z.object({ config: z.object({ mcp_servers: z.record(z.string(), z.unknown()).nullish() }) });
const promptTemplate = readFileSync(join(import.meta.dirname, "prompt.md"), "utf8").trimEnd();
const apiKeyVariables = new Set(["OPENAI_API_KEY", "CODEX_API_KEY"]);

export function createCodex({ codexPath, model, workspace }: CodexOptions): Ask {
  return async (request, { signal, session, onText }) => {
    const { text, threadId } = await runCodex({
      executable: findCodex(codexPath),
      args: codexArguments,
      prompt: buildPrompt(request),
      cwd: workspace,
      signal,
      model,
      threadId: resumableSession(request, session)?.id,
      onText,
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

export function resumableSession(request: WoWRequest, session?: Session): Session | undefined {
  return request.thread === "continue" && session?.context === request.context ? session : undefined;
}

export const codexArguments: readonly string[] = [
  "app-server", "--listen", "stdio://",
  "-c", 'sandbox_mode="read-only"',
  "-c", 'approval_policy="never"',
  "-c", 'web_search="live"',
  "-c", 'model_reasoning_effort="medium"',
  "-c", 'service_tier="fast"',
  "-c", "features.shell_tool=false",
  "-c", "features.apps=false",
  "-c", "features.plugins=false",
  "-c", "features.remote_plugin=false",
  "-c", "features.hooks=false",
];

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

/** One App Server per question, so cancelling the question ends the process. */
export async function runCodex({ executable, args, cwd, prompt, signal, threadId, model, onText }: RunOptions): Promise<TurnResult> {
  const child = spawn(executable, args, { cwd, env: codexEnvironment(), windowsHide: true, signal, killSignal: "SIGKILL" });
  const server = connect<ServerRequests>(child);
  try {
    await server.request("initialize", { clientInfo: { name: "scallop_alfred", title: "Scallop Alfred", version: "0.1.0" } });
    server.notify("initialized");
    const settings = await threadSettings(server, cwd, model);
    const { thread } = threadResult.parse(threadId
      ? await server.request("thread/resume", { ...settings, threadId })
      : await server.request("thread/start", settings));
    await server.request("turn/start", { threadId: thread.id, input: [{ type: "text", text: prompt }], effort: "medium" });
    let run: Run = { threadId: thread.id };
    for await (const notification of server.notifications) {
      const next = applyEvent(run, notification);
      if (next.message?.text && next.message.text !== run.message?.text) onText?.(next.message.text);
      run = next;
      if (run.status) break;
    }
    return answerFrom(run);
  } catch (error) {
    if (signal.aborted) throw new Error(String(signal.reason), { cause: error });
    throw error;
  } finally {
    await server.close();
  }
}

/** App Server merges the user's config, so each configured MCP server is disabled by name. */
async function threadSettings(server: Connection<ServerRequests>, cwd: string, model?: string): Promise<ThreadSettings> {
  const { config } = configResult.parse(await server.request("config/read", { includeLayers: false }));
  const disabledServers = Object.keys(config.mcp_servers ?? {}).map(name => [`mcp_servers.${name}.enabled`, false] as const);
  return { cwd, approvalPolicy: "never", sandbox: "read-only", ...(model ? { model } : {}), config: Object.fromEntries(disabledServers) };
}

/** A turn succeeds only when Codex completes it with a finished, nonempty answer. */
function answerFrom(run: Run): TurnResult {
  const text = run.message?.text.trim();
  if (run.status === "completed" && run.message?.completed && text) return { text, threadId: run.threadId };
  if (run.failure) throw new Error(run.failure);
  throw new Error(run.status === "interrupted" ? "Codex interrupted the reply." : "Codex returned no answer. Check that codex login is complete.");
}
