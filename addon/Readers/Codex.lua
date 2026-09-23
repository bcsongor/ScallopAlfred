local _, addon = ...
local Count, Read = addon.Count, addon.Read
local PlayerChoice = addon.PlayerChoice

-- The Corrosive Codex is a player choice opened at the Altar of Corrosion or a Delve projection.
local TITLE = "Corrosive Codex"
-- Corrosive Souls are Warbound items; each power costs eight.
local CORROSIVE_SOUL = 273000

local Codex = {}
addon.Codex = Codex

function Codex.IsOpen()
    return PlayerChoice.Buttons(TITLE) ~= nil
end

-- Every power as its button shows it, and the souls across the Warband that unlock more.
function Codex.Read()
    local buttons = PlayerChoice.Buttons(TITLE)
    if not buttons then return end
    local powers = {}
    for index = 1, math.min(#buttons, 12) do powers[index] = buttons[index] end
    return {
        capturedAt = GetServerTime(),
        souls = Count(Read(C_Item.GetItemCount, CORROSIVE_SOUL, true, false, true, true)),
        powers = powers,
    }
end
