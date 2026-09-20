local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read

local Professions = {}
addon.Professions = Professions

-- Profession data can be unavailable until its window has been opened, so every read is optional.
local function specialization(skillLineID)
    local configID = Count(Read(C_ProfSpecs.GetConfigIDForSkillLine, skillLineID))
    if not configID or configID == 0 then return end
    local currency = Read(C_ProfSpecs.GetCurrencyInfoForSkillLine, skillLineID)
    local result = {
        skillLineID = skillLineID,
        unspentKnowledge = currency and Count(currency.numAvailable),
        hasStagedChanges = Public(Read(C_Traits.ConfigHasStagedChanges, configID), "boolean"),
        paths = {},
    }
    local seen = {}
    local visited = 0
    local function addPath(id, parentID)
        id = Count(id)
        if not id or seen[id] or visited >= 128 then return end
        seen[id] = true
        visited = visited + 1
        local node = Read(C_Traits.GetNodeInfo, configID, id)
        local unlockID = Count(Read(C_ProfSpecs.GetUnlockEntryForPath, id))
        local entry = unlockID and Read(C_Traits.GetEntryInfo, configID, unlockID)
        local definitionID = entry and Count(entry.definitionID)
        local definition = definitionID and Read(C_Traits.GetDefinitionInfo, definitionID)
        local spellID = definition and Count(definition.spellID)
        local name = definition and Public(definition.overrideName, "string")
        name = name or (spellID and Public(Read(C_Spell.GetSpellName, spellID), "string"))
        local rank = node and Count(node.currentRank)
        local maxRank = node and Count(node.maxRanks)
        local unlockRanks = entry and Count(entry.maxRanks)
        if rank and maxRank and unlockRanks then
            -- Match Blizzard's displayed ranks, excluding the path's unlock tier.
            result.paths[#result.paths + 1] = {
                id = id, parentID = parentID, name = name,
                rank = math.max(0, rank - unlockRanks), maxRank = math.max(0, maxRank - unlockRanks),
            }
        end
        for _, child in ipairs(Read(C_ProfSpecs.GetChildrenForPath, id) or {}) do addPath(child, id) end
    end
    for _, tab in ipairs(Read(C_ProfSpecs.GetSpecTabIDsForSkillLine, skillLineID) or {}) do
        addPath(Read(C_ProfSpecs.GetRootPathForTab, tab))
    end
    return result
end

-- Every profession's skills, and its specialisation tree when `includeSpecializations` is set.
function Professions.Read(includeSpecializations)
    local lines = Read(C_TradeSkillUI.GetAllProfessionTradeSkillLines) or {}
    local entries = {}
    local infoBySkillLine = {}
    -- The returned slots are sparse when a primary or secondary profession is missing.
    for _, index in pairs({ GetProfessions() }) do
        local name, _, skill, maximum, _, _, skillLineID, modifier, _, _, skillLineName = GetProfessionInfo(index)
        name = Public(name, "string")
        skillLineID = Count(skillLineID)
        if name and skillLineID then
            local profession = {
                name = name, skillLineID = skillLineID,
                skillLineName = Public(skillLineName, "string"),
                skillLevel = Count(skill), maxSkillLevel = Count(maximum), skillModifier = Count(modifier),
                expansions = {},
            }
            -- Every expansion's skill line goes along, so questions about legacy content see those skills too.
            for lineIndex, childID in ipairs(lines) do
                if lineIndex > 256 then break end
                childID = Count(childID)
                if childID and infoBySkillLine[childID] == nil then
                    infoBySkillLine[childID] = Read(C_TradeSkillUI.GetProfessionInfoBySkillLineID, childID) or false
                end
                local info = childID and infoBySkillLine[childID]
                if info and Count(info.parentProfessionID) == skillLineID then
                    local lineName = Public(info.professionName, "string")
                    profession.expansions[#profession.expansions + 1] = {
                        skillLineID = childID, name = lineName, expansionName = Public(info.expansionName, "string"),
                        skillLevel = Count(info.skillLevel), maxSkillLevel = Count(info.maxSkillLevel),
                        skillModifier = Count(info.skillModifier),
                    }
                    if includeSpecializations and profession.skillLineName and lineName == profession.skillLineName then
                        local ok, details = pcall(specialization, childID)
                        if ok then profession.specialization = details end
                    end
                end
            end
            entries[#entries + 1] = profession
        end
    end
    return { capturedAt = GetServerTime(), entries = entries }
end

-- The same snapshot with every specialisation tree, for topics that advise on knowledge points.
function Professions.ReadDetailed()
    return Professions.Read(true)
end
