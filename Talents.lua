local _, addon = ...

local function publicValue(value, kind)
    if issecretvalue and issecretvalue(value) then return end
    if type(value) == kind then return value end
end

-- Read only the active player build; never inspect another unit or change a loadout.
function addon.GetTalents()
    if not C_ClassTalents or not C_Traits then return end
    local configID = publicValue(C_ClassTalents.GetActiveConfigID(), "number")
    if not configID or configID <= 0 then return end
    local config = C_Traits.GetConfigInfo(configID)
    if not config then return end
    local result = { capturedAt = GetServerTime(), selected = {} }
    local ok, exportString = pcall(C_Traits.GenerateImportString, configID)
    if ok then result.exportString = publicValue(exportString, "string") end
    local staged, changes = pcall(C_Traits.ConfigHasStagedChanges, configID)
    if staged then result.hasStagedChanges = publicValue(changes, "boolean") end
    local seen, visited = {}, 0
    for _, treeID in ipairs(config.treeIDs or {}) do
        for _, nodeID in ipairs(C_Traits.GetTreeNodes(treeID) or {}) do
            if not seen[nodeID] and visited < 256 then
                seen[nodeID] = true
                visited = visited + 1
                local node = C_Traits.GetNodeInfo(configID, nodeID)
                local rank = node and publicValue(node.activeRank, "number")
                local entryID = node and node.activeEntry and publicValue(node.activeEntry.entryID, "number")
                if rank and rank > 0 and entryID and #result.selected < 128 then
                    local entry = C_Traits.GetEntryInfo(configID, entryID)
                    local definitionID = entry and publicValue(entry.definitionID, "number")
                    local definition = definitionID and C_Traits.GetDefinitionInfo(definitionID)
                    local spellID = definition and publicValue(definition.spellID, "number")
                    if spellID then
                        local name = publicValue(definition.overrideName, "string") or publicValue(C_Spell.GetSpellName(spellID), "string")
                        result.selected[#result.selected + 1] = { spellID = spellID, name = name, rank = rank }
                    end
                end
            end
        end
    end
    return result
end
