local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read

-- The Corrosive Codex window, opened at the Altar of Corrosion or a Delve projection, is a player choice with
-- one button per power.
local CODEX = "Corrosive Codex"
-- Corrosive Souls are Warbound items; each power costs eight.
local CORROSIVE_SOUL = 273000

-- The Codex's player choice option while its window is open.
local function codexOption()
    local choice = Read(function() return C_PlayerChoice.GetCurrentPlayerChoiceInfo() end)
    if not choice then return end
    local title = Public(choice.questionText, "string") or ""
    for _, option in ipairs(choice.options or {}) do
        if title:find(CODEX, 1, true) or (Public(option.header, "string") or ""):find(CODEX, 1, true) then return option end
    end
end

function addon.CodexAvailable()
    return codexOption() ~= nil
end

local function souls()
    return Count(Read(function() return C_Item.GetItemCount(CORROSIVE_SOUL, true, false, true, true) end))
end

-- The tooltip repeats the power's name on its first line.
local function tooltipDescription(name, tooltip)
    local description = addon.PlainText(tooltip)
    if not description then return end
    description = strtrim((description:gsub("\r\n", "\n"):gsub("^" .. name:gsub("%p", "%%%0"), "")))
    if description ~= "" and #description <= 1024 then return description end
end

-- Every power the window lists. The server marks buttons with an atlas in their text, common-icon-checkmark
-- on the active power and activities-icon-lock on a locked one; the button flags themselves stay false.
local function powers(option)
    local result = {}
    for _, button in ipairs(option.buttons or {}) do
        local text = Public(button.text, "string")
        local name = text and strtrim(addon.PlainText(text))
        if name and name ~= "" and #result < 12 then
            local icon = text:match("|A:([^:|]+)")
            local active = icon ~= nil and icon:find("check", 1, true) ~= nil
            result[#result + 1] = {
                name = name,
                description = tooltipDescription(name, button.tooltip),
                active = active or nil,
                locked = icon ~= nil and not active or nil,
            }
        end
    end
    return result
end

function addon.GetCodex()
    local option = codexOption()
    if not option then return end
    return { capturedAt = GetServerTime(), souls = souls(), powers = powers(option) }
end
