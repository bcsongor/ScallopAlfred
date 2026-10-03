local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read
local TraitTree = addon.TraitTree

local Professions = {}
addon.Professions = Professions

-- One expansion's specialisation tree. Expansions before Dragonflight have none and report no config.
-- Profession data can be unavailable until its window has been opened, so every read is optional.
local function specialization(skillLineID)
    local configID = Count(Read(C_ProfSpecs.GetConfigIDForSkillLine, skillLineID))
    if not configID or configID == 0 then return end
    local currency = Read(C_ProfSpecs.GetCurrencyInfoForSkillLine, skillLineID)
    local result = {
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
        local name = TraitTree.EntryName(entry)
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

-- Every profession's skills, and each expansion's specialisation tree when `includeSpecializations` is set.
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
                    -- Each tree sits on its own expansion's line, so the player can ask about any of them.
                    profession.expansions[#profession.expansions + 1] = {
                        skillLineID = childID, name = Public(info.professionName, "string"),
                        expansionName = Public(info.expansionName, "string"),
                        skillLevel = Count(info.skillLevel), maxSkillLevel = Count(info.maxSkillLevel),
                        skillModifier = Count(info.skillModifier),
                        specialization = includeSpecializations and Read(specialization, childID) or nil,
                    }
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
