local _, addon = ...
local Public, Count, Read, PlainText = addon.Public, addon.Count, addon.Read, addon.PlainText

-- Selection nodes offer a choice; tiered nodes list one entry per rank instead.
local SELECTION = Enum.TraitNodeType and Enum.TraitNodeType.Selection or 2

-- Blizzard's generic trait window drives Skyriding, the Altar of Corrosion and other systems from one frame.
-- Blizzard_GenericTraitUtil.lua maps each tree ID to its layout, and C_Traits exposes every tree the same way.
local TraitTree = {}
addon.TraitTree = TraitTree

-- True while the generic trait window shows the tree. The frame exists only after its addon loads.
function TraitTree.IsOpen(treeID)
    return Read(function() return GenericTraitFrame:IsShown() and GenericTraitFrame:GetTalentTreeID() == treeID end) == true
end

local function entryInfo(configID, entryID, selected)
    local entry = Read(function() return C_Traits.GetEntryInfo(configID, entryID) end)
    local definitionID = entry and Count(entry.definitionID)
    local definition = definitionID and Read(C_Traits.GetDefinitionInfo, definitionID)
    if not definition then return end
    local spellID = Count(definition.spellID)
    if spellID == 0 then spellID = nil end
    local name = Public(definition.overrideName, "string") or spellID and Public(Read(C_Spell.GetSpellName, spellID), "string")
    if not name then return end
    local description = PlainText(definition.overrideDescription)
        or spellID and PlainText(Read(C_Spell.GetSpellDescription, spellID))
    if description then description = description:gsub("\r\n", "\n") end
    if description and (description == "" or #description > 1024) then description = nil end
    -- Spell text is fetched from the server on demand, so an uncached spell reads as empty until the next copy.
    if not description and spellID then Read(C_Spell.RequestLoadSpellData, spellID) end
    return { name = name, description = description, selected = selected or nil }
end

-- Every visible node in the tree, bought or not, since the question is what to buy next.
function TraitTree.Read(treeID)
    local configID = Count(Read(function() return C_Traits.GetConfigIDByTreeID(treeID) end))
    if not configID or configID <= 0 then return end
    local currency = Read(C_Traits.GetTreeCurrencyInfo, configID, treeID, false)
    local points = currency and currency[1]
    local result = {
        capturedAt = GetServerTime(),
        unspent = points and Count(points.quantity),
        spent = points and Count(points.spent),
        hasStagedChanges = Public(Read(C_Traits.ConfigHasStagedChanges, configID), "boolean"),
        nodes = {},
    }
    for _, nodeID in ipairs(Read(C_Traits.GetTreeNodes, treeID) or {}) do
        local node = #result.nodes < 64 and Count(nodeID) and Read(C_Traits.GetNodeInfo, configID, nodeID)
        if node and Public(node.isVisible, "boolean") ~= false then
            local rank = Count(node.activeRank) or 0
            local activeEntry = rank > 0 and node.activeEntry and Count(node.activeEntry.entryID)
            local entries = {}
            for _, entryID in ipairs(node.entryIDs or {}) do
                local entry = #entries < 8 and Count(entryID) and entryInfo(configID, entryID, entryID == activeEntry)
                if entry then entries[#entries + 1] = entry end
            end
            result.nodes[#result.nodes + 1] = {
                id = nodeID,
                rank = rank,
                maxRank = Count(node.maxRanks),
                available = Public(node.isAvailable, "boolean"),
                -- canPurchaseRank reports met prerequisites, not affordability.
                reachable = Public(node.canPurchaseRank, "boolean"),
                choice = Public(node.type, "number") == SELECTION or nil,
                entries = entries,
            }
        end
    end
    return result
end
