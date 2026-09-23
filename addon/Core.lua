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

-- Strips WoW's colour, texture, atlas and link escapes. The |n escape becomes a real line break in the copy
-- box, which JSON forbids, so it is made a newline here and escaped with the rest.
function addon.PlainText(text)
    text = addon.Public(text, "string")
    if not text then return end
    return (text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
        :gsub("|T.-|t", ""):gsub("|A.-|a", "")
        :gsub("|H.-|h(.-)|h", "%1"):gsub("|n", "\n"))
end

function addon.Notify(message)
    print("|cffe2c180Scallop Alfred:|r " .. message)
end

-- The dialog's buttons, in the order their files load. A topic has `text`, which may depend on the subject, a
-- `category` and either a `question` to copy straight away or none to open the editor. `kind` is "subject" for
-- a hovered-subject preset, "target" for the targeted NPC, or "topic". An `itemOnly` subject preset shows only
-- for items. A topic with `available` shows only while it returns true, an `always` topic also shows beside a
-- subject or target, and `snapshot` maps request fields to the readers that fill them. Subject presets share the
-- snapshot of the topic with their category.
addon.Topics = {}

function addon.AddTopic(topic)
    topic.kind = topic.kind or "topic"
    addon.Topics[#addon.Topics + 1] = topic
end
