local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read

-- The Corrosive Codex window, opened at the Altar of Corrosion or a Delve projection, is a player choice with
-- one button per power.
local CODEX = "Corrosive Codex"
-- Corrosive Souls are Warbound items; each power costs eight.
local CORROSIVE_SOUL = 273000
-- The twelve powers with every spell ID Blizzard has given each name. The equipped power is an aura on the
-- player, but which of its spells carries the aura is undocumented, so the addon probes them all and also
-- matches the auras it can enumerate by name. That corroborates the window's checkmark.
local POWERS = {
    ["Accursed Poison"] = { 1302580, 1302758, 1302763, 1303474 },
    ["Gorgoneion Gaze"] = { 1291725, 1292117, 1302040, 1302873, 1303469, 1303487, 1303502 },
    ["Insidious Venom"] = { 1302568, 1302621, 1302624, 1302625, 1302662, 1303478 },
    ["Lithic Plumage"] = { 1292159, 1292166, 1303467 },
    ["Mephitic Cloud"] = { 1291724, 1292064, 1302009, 1302014, 1302015, 1303470 },
    ["Miasma Geyser"] = { 1302600, 1302831, 1302840, 1302844, 1302845, 1303476 },
    ["Ophidian Maw"] = { 1291580, 1291657, 1303472 },
    ["Ouroboric Cycle"] = { 1292247, 1292249, 1303468 },
    ["Plague of Corrosion"] = { 1302602, 1302776, 1303475 },
    ["Ula'tek's Gift"] = { 1289148, 1291581, 1299890, 1303477 },
    ["Viperine Grasp"] = { 1291723, 1291869, 1291878, 1291899, 1303471 },
    ["Virulent Mucus"] = { 1302577, 1302686, 1303473 },
}

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

-- Names of the powers found as auras on the player.
local function activeNames()
    local active = {}
    for name, spellIDs in pairs(POWERS) do
        for _, spellID in ipairs(spellIDs) do
            if Read(function() return C_UnitAuras.GetPlayerAuraBySpellID(spellID) end) then
                active[name] = true
                break
            end
        end
    end
    for index = 1, 120 do
        local aura = Read(function() return C_UnitAuras.GetAuraDataByIndex("player", index, "HELPFUL") end)
        if not aura then break end
        local name = Public(aura.name, "string")
        if name and POWERS[name] then active[name] = true end
    end
    return active
end

-- The tooltip repeats the power's name on its first line.
local function tooltipDescription(name, tooltip)
    local description = addon.PlainText(tooltip)
    if not description then return end
    description = strtrim((description:gsub("\r\n", "\n"):gsub("^" .. name:gsub("%p", "%%%0"), "")))
    if description ~= "" and #description <= 1024 then return description end
end

-- Every power the window lists. The server marks buttons with icons in their text: a checkmark on the active
-- power and a padlock on a locked one.
local function powers(option, active)
    local result = {}
    for _, button in ipairs(option.buttons or {}) do
        local text = Public(button.text, "string")
        local name = text and strtrim(addon.PlainText(text))
        if name and name ~= "" and #result < 12 then
            local icon = text:match("|A:([^:|]+)") or text:match("|T([^:|]+)")
            local equipped = Public(button.showCheckmark, "boolean") or Public(button.selected, "boolean")
                or icon and icon:lower():find("check", 1, true) ~= nil or active[name] == true
            result[#result + 1] = {
                name = name,
                description = tooltipDescription(name, button.tooltip),
                active = equipped or nil,
                locked = icon and not equipped or nil,
            }
        end
    end
    return result
end

function addon.GetCodex()
    local option = codexOption()
    if not option then return end
    return { capturedAt = GetServerTime(), souls = souls(), powers = powers(option, activeNames()) }
end
