import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import fengari from "fengari";
import { parseRequest, type WoWRequest } from "../../app/protocol.ts";

const { lua, lauxlib, lualib, to_luastring } = fengari;

/** Reads a file relative to the repository root. */
export const read = (file: string): string => readFileSync(join(import.meta.dirname, "..", "..", file), "utf8");

/** The addon's Lua files in load order. A misordered manifest fails every addon test. */
export const manifest = read("ScallopAlfred.toc").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

/** Runs the real addon files against the WoW API stand-ins in wow.lua. */
export function addon() {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const execute = (source: string): void => {
    const code = lauxlib.luaL_dostring(state, to_luastring(source));
    assert.equal(code, lua.LUA_OK, code === lua.LUA_OK ? undefined : lua.lua_tojsstring(state, -1) ?? undefined);
  };
  const value = (name: string): string | null => {
    lua.lua_getglobal(state, name);
    const result = lua.lua_tojsstring(state, -1);
    lua.lua_pop(state, 1);
    return result;
  };
  execute(read("tests/fixtures/wow.lua"));
  execute("addon = {}");
  for (const file of manifest) execute(`local function loadAddon(...) ${read(file)}\nend; loadAddon("ScallopAlfred", addon)`);
  const binding = read("Bindings.xml").match(/<Binding\s[^>]*>([\s\S]*?)<\/Binding>/)?.[1];
  execute(`function runAskBinding(keyState) local keystate = keyState; ${binding} end`);
  return {
    execute,
    value,
    /** The last request the addon copied, validated by the app's schema. */
    payload(): WoWRequest {
      const request = parseRequest(value("copied") ?? "");
      assert.ok(request, "The addon copied no request");
      return request;
    },
  };
}
