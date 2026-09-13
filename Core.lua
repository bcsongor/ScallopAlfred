local _, addon = ...

-- Returns a value only when it is readable and of the expected Lua type.
-- Restricted values are never inspected or exported.
function addon.Public(value, kind)
    if not issecretvalue(value) and type(value) == kind then return value end
end

-- Returns a non-negative number that survives a round trip through JSON.
function addon.Count(value)
    value = addon.Public(value, "number")
    if value and value >= 0 and value <= 9007199254740991 then return value end
end

-- Calls a game API that may be unavailable, fail, or return a restricted value.
function addon.Read(getter, ...)
    local ok, value = pcall(getter, ...)
    if ok and not issecretvalue(value) then return value end
end
