declare module "fengari" {
  type LuaState = { readonly brand: "LuaState" };
  const fengari: {
    lua: {
      LUA_OK: number;
      lua_getglobal(state: LuaState, name: string): number;
      lua_tojsstring(state: LuaState, index: number): string | null;
      lua_pop(state: LuaState, count: number): void;
    };
    lauxlib: {
      luaL_newstate(): LuaState;
      luaL_dostring(state: LuaState, source: Uint8Array): number;
    };
    lualib: {
      luaL_openlibs(state: LuaState): void;
    };
    to_luastring(source: string): Uint8Array;
  };
  export default fengari;
}
