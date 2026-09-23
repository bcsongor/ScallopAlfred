local _, addon = ...
local Public, Read, PlainText = addon.Public, addon.Read, addon.PlainText

-- Blizzard's player choice window drives Torghast powers, Cyphers, the Corrosive Codex and other systems from
-- one frame.
local PlayerChoice = {}
addon.PlayerChoice = PlayerChoice

-- The tooltip repeats the button's name on its first line.
local function description(name, tooltip)
    local text = PlainText(tooltip)
    if not text then return end
    text = strtrim((text:gsub("\r\n", "\n"):gsub("^" .. name:gsub("%p", "%%%0"), "")))
    if text ~= "" and #text <= 1024 then return text end
end

-- The server marks a button's state with an atlas before its name, common-icon-checkmark on the active option
-- and activities-icon-lock on a locked one, while the button's own flags stay false.
local function button(info)
    local text = Public(info.text, "string")
    local name = text and strtrim(PlainText(text))
    if not name or name == "" then return end
    local icon = text:match("|A:([^:|]+)")
    local active = icon ~= nil and icon:find("check", 1, true) ~= nil
    return {
        name = name,
        description = description(name, info.tooltip),
        active = active or nil,
        locked = icon ~= nil and not active or nil,
    }
end

-- The buttons of the open choice's option whose question or header contains `title`, or nil when no such
-- option is open.
function PlayerChoice.Buttons(title)
    local choice = Read(C_PlayerChoice.GetCurrentPlayerChoiceInfo)
    if not choice then return end
    local question = Public(choice.questionText, "string") or ""
    for _, option in ipairs(choice.options or {}) do
        if question:find(title, 1, true) or (Public(option.header, "string") or ""):find(title, 1, true) then
            local buttons = {}
            for _, info in ipairs(option.buttons or {}) do
                local entry = button(info)
                if entry then buttons[#buttons + 1] = entry end
            end
            return buttons
        end
    end
end
