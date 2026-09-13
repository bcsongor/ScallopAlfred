import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { Config } from "./config.ts";
import type { WoWRequest } from "./protocol.ts";

const eventSchema = z.object({
  type: z.string(),
  thread_id: z.string().optional(),
  item: z.object({ type: z.string(), text: z.string().optional() }).optional(),
  error: z.object({ message: z.string() }).nullish(),
  message: z.string().optional(),
});

type Session = { context: string; id: string };
type Answer = { text: string; session: Session };

/** Resolve npm's Windows shim to the native binary so no shell interprets arguments. */
function findCodex(configuredPath: string): string {
  if (configuredPath) return configuredPath;
  if (process.platform !== "win32") return "codex";

  const folders = (process.env.PATH ?? "").split(delimiter);
  for (const folder of folders) {
    const executable = join(folder, "codex.exe");
    if (existsSync(executable)) return executable;
    const manifest = join(folder, "node_modules", "@openai", "codex", "package.json");
    if (!existsSync(manifest)) continue;
    try {
      const platformPackage = createRequire(manifest).resolve(`@openai/codex-win32-${process.arch}/package.json`);
      const target = process.arch === "arm64" ? "aarch64" : "x86_64";
      for (const directory of ["bin", "codex"]) {
        const binary = join(dirname(platformPackage), "vendor", `${target}-pc-windows-msvc`, directory, "codex.exe");
        if (existsSync(binary)) return binary;
      }
    } catch {
      // Another PATH entry may contain a working installation.
    }
  }
  throw new Error("Codex was not found. Install Codex CLI or set codexPath to its native executable in settings.");
}

export function codexArguments(request: WoWRequest, model: string, session?: Session): string[] {
  const args = [
    "exec", "--json", "--skip-git-repo-check", "--ignore-user-config",
    "--sandbox", "read-only",
    "-c", 'approval_policy="never"',
    "-c", 'web_search="live"',
    "-c", 'model_reasoning_effort="medium"',
    "-c", 'service_tier="fast"',
    "-c", "features.shell_tool=false",
  ];
  if (model) args.push("--model", model);
  if (request.thread === "continue" && session?.context === request.context) {
    args.push("resume", session.id);
  }
  return [...args, "-"];
}

const promptTemplate = readFileSync(join(import.meta.dirname, "prompt.md"), "utf8").trimEnd();

/** Instructions first, then the request as JSON on the final line. */
export function buildPrompt(request: WoWRequest): string {
  return `${promptTemplate.replace("{{date}}", new Date().toISOString().slice(0, 10))}\n\n${JSON.stringify(request)}`;
}

/** Read the documented JSONL stream; only successful turns advance the conversation. */
function runCodex(
  executable: string,
  args: string[],
  prompt: string,
  cwd: string,
  signal: AbortSignal,
): Promise<{ text: string; threadId: string }> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new Error(String(signal.reason))); return; }
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.CODEX_API_KEY;
    // GUI launches on macOS and Linux may not inherit the shell's PATH.
    if (process.platform !== "win32") {
      env.PATH = [env.PATH, join(homedir(), ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(delimiter);
    }
    const child = spawn(executable, args, { cwd, env, windowsHide: true, stdio: "pipe" });
    let text = "";
    let threadId = "";
    let failure = "";
    let diagnostic = "";
    let stderr = "";
    let completed = false;
    const cancel = () => { failure = String(signal.reason); child.kill("SIGKILL"); };
    signal.addEventListener("abort", cancel, { once: true });
    const lines = createInterface({ input: child.stdout });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr = (stderr + chunk).slice(-1500); });
    child.stdin.on("error", () => { /* The exit/error event reports an early child shutdown. */ });
    child.on("error", (error) => { failure = `Could not start Codex: ${error.message}`; });
    lines.on("line", (line) => {
      let value: unknown;
      try { value = JSON.parse(line); } catch { return; }
      const parsed = eventSchema.safeParse(value);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "thread.started" && event.thread_id) threadId = event.thread_id;
      if (event.type === "item.completed" && event.item?.type === "agent_message") text = event.item.text ?? "";
      if (event.type === "turn.completed") completed = true;
      if (event.type === "turn.failed") failure = event.error?.message ?? "Codex could not answer this question.";
      if (event.type === "error") diagnostic = event.message ?? "Codex reported an error.";
    });
    child.on("close", (code) => {
      signal.removeEventListener("abort", cancel);
      lines.close();
      if (failure || code !== 0 || !completed || !text.trim() || !threadId) {
        reject(new Error(failure || diagnostic || stderr.trim() || "Codex returned no answer. Check that codex login is complete."));
      } else {
        resolve({ text: text.trim(), threadId });
      }
    });
    child.stdin.end(prompt);
  });
}

export async function askCodex(
  request: WoWRequest,
  config: Config,
  cwd: string,
  signal: AbortSignal,
  session?: Session,
): Promise<Answer> {
  const result = await runCodex(findCodex(config.codexPath), codexArguments(request, config.model, session), buildPrompt(request), cwd, signal);
  return { text: result.text, session: { context: request.context, id: result.threadId } };
}
