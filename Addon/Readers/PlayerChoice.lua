local _, addon = ...
local Public, Read, PlainText = addon.Public, addon.Read, addon.PlainText

-- Blizzard's player choice window drives Torghast powers, Cyphers, the Corrosive Codex and other systems from
-- one frame. Each option's buttons carry their state as an atlas in the button text.
local PlayerChoice = {}
addon.PlayerChoice = PlayerChoice

-- The tooltip repeats the button's name on its first line.
local function description(name, tooltip)
    local text = PlainText(tooltip)
    if not text then return end
    text = strtrim((text:gsub("\r\n", "\n"):gsub("^" .. name:gsub("%p", "%%%0"), "")))
    if text ~= "" and #text <= 1024 then return text end
end

local function button(info)
    local text = Public(info.text, "string")
    local name = text and strtrim(PlainText(text))
    if not name or name == "" then return end
    return { name = name, icon = text:match("|A:([^:|]+)"), description = description(name, info.tooltip) }
end

-- The open choice's option whose question or header contains `title`, with its buttons reduced to a name,
-- the atlas shown before it and the tooltip's description.
function PlayerChoice.Current(title)
    local choice = Read(function() return C_PlayerChoice.GetCurrentPlayerChoiceInfo() end)
    if not choice then return end
    local question = Public(choice.questionText, "string") or ""
    for _, option in ipairs(choice.options or {}) do
        if question:find(title, 1, true) or (Public(option.header, "string") or ""):find(title, 1, true) then
            local buttons = {}
            for _, info in ipairs(option.buttons or {}) do
                local entry = button(info)
                if entry then buttons[#buttons + 1] = entry end
            end
            return { buttons = buttons }
        end
    end
end
