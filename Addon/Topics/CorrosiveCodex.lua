local _, addon = ...
local Count, Read = addon.Count, addon.Read
local PlayerChoice = addon.PlayerChoice

-- The Codex is a player choice opened at the Altar of Corrosion or a Delve projection.
local CODEX = "Corrosive Codex"
-- Corrosive Souls are Warbound items; each power costs eight.
local CORROSIVE_SOUL = 273000

-- The server marks a button with common-icon-checkmark on the active power and activities-icon-lock on a
-- locked one; a power with neither is unlocked and idle.
local function power(button)
    local active = button.icon ~= nil and button.icon:find("check", 1, true) ~= nil
    return {
        name = button.name,
        description = button.description,
        active = active or nil,
        locked = button.icon ~= nil and not active or nil,
    }
end

local function codex()
    local choice = PlayerChoice.Current(CODEX)
    if not choice then return end
    local powers = {}
    for index, button in ipairs(choice.buttons) do
        if index <= 12 then powers[index] = power(button) end
    end
    return {
        capturedAt = GetServerTime(),
        souls = Count(Read(function() return C_Item.GetItemCount(CORROSIVE_SOUL, true, false, true, true) end)),
        powers = powers,
    }
end

addon.AddTopic({
    text = "Corrosive Codex",
    category = "codex",
    question = "Which Corrosive Codex power should I unlock or equip next?",
    available = function() return PlayerChoice.Current(CODEX) ~= nil end,
    snapshot = { codex = codex },
})
