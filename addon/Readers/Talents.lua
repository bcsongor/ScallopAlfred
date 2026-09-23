local _, addon = ...
local Public, Read = addon.Public, addon.Read
local TraitTree = addon.TraitTree

local Talents = {}
addon.Talents = Talents

-- Read only the active player build; never inspect another unit or change a loadout.
function Talents.Read()
    local configID = Public(Read(C_ClassTalents.GetActiveConfigID), "number")
    if not configID or configID <= 0 then return end
    local config = Read(C_Traits.GetConfigInfo, configID)
    if not config then return end
    local result = {
        capturedAt = GetServerTime(),
        exportString = Public(Read(C_Traits.GenerateImportString, configID), "string"),
        hasStagedChanges = Public(Read(C_Traits.ConfigHasStagedChanges, configID), "boolean"),
        selected = {},
    }
    local seen, visited = {}, 0
    for _, treeID in ipairs(config.treeIDs or {}) do
        for _, nodeID in ipairs(Read(C_Traits.GetTreeNodes, treeID) or {}) do
            if not seen[nodeID] and visited < 256 then
                seen[nodeID] = true
                visited = visited + 1
                local node = Read(C_Traits.GetNodeInfo, configID, nodeID)
                local rank = node and Public(node.activeRank, "number")
                local entryID = node and node.activeEntry and Public(node.activeEntry.entryID, "number")
                if rank and rank > 0 and entryID and #result.selected < 128 then
                    local name, spellID = TraitTree.EntryName(Read(C_Traits.GetEntryInfo, configID, entryID))
                    if spellID then
                        result.selected[#result.selected + 1] = { spellID = spellID, name = name, rank = rank }
                    end
                end
            end
        end
    end
    return result
end
