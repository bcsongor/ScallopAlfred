local _, addon = ...

local function publicValue(value, kind)
    if issecretvalue and issecretvalue(value) then return end
    if type(value) == kind then return value end
end

local function number(value)
    value = publicValue(value, "number")
    if value and value >= 0 and value <= 9007199254740991 then return value end
end

-- Profession data can be unavailable until its window has been opened.
local function read(getter, ...)
    if type(getter) ~= "function" then return end
    local ok, value = pcall(getter, ...)
    if ok and not (issecretvalue and issecretvalue(value)) then return value end
end

local function specialization(skillLineID)
    if not C_ProfSpecs or not C_Traits then return end
    local configID = number(read(C_ProfSpecs.GetConfigIDForSkillLine, skillLineID))
    if not configID or configID == 0 then return end
    local currency = read(C_ProfSpecs.GetCurrencyInfoForSkillLine, skillLineID)
    local result = {
        skillLineID = skillLineID,
        unspentKnowledge = currency and number(currency.numAvailable),
        hasStagedChanges = publicValue(read(C_Traits.ConfigHasStagedChanges, configID), "boolean"),
        paths = {},
    }
    local seen = {}
    local visited = 0
    local function addPath(id, parentID)
        id = number(id)
        if not id or seen[id] or visited >= 128 then return end
        seen[id] = true
        visited = visited + 1
        local node = read(C_Traits.GetNodeInfo, configID, id)
        local unlockID = number(read(C_ProfSpecs.GetUnlockEntryForPath, id))
        local entry = unlockID and read(C_Traits.GetEntryInfo, configID, unlockID)
        local definitionID = entry and number(entry.definitionID)
        local definition = definitionID and read(C_Traits.GetDefinitionInfo, definitionID)
        local spellID = definition and number(definition.spellID)
        local name = definition and publicValue(definition.overrideName, "string")
        name = name or (spellID and publicValue(read(C_Spell.GetSpellName, spellID), "string"))
        local rank = node and number(node.currentRank)
        local maxRank = node and number(node.maxRanks)
        local unlockRanks = entry and number(entry.maxRanks)
        if rank and maxRank and unlockRanks then
            -- Match Blizzard's displayed ranks, excluding the path's unlock tier.
            result.paths[#result.paths + 1] = {
                id = id, parentID = parentID, name = name,
                rank = math.max(0, rank - unlockRanks), maxRank = math.max(0, maxRank - unlockRanks),
            }
        end
        for _, child in ipairs(read(C_ProfSpecs.GetChildrenForPath, id) or {}) do addPath(child, id) end
    end
    for _, tab in ipairs(read(C_ProfSpecs.GetSpecTabIDsForSkillLine, skillLineID) or {}) do
        addPath(read(C_ProfSpecs.GetRootPathForTab, tab))
    end
    return result
end

function addon.GetProfessions(includeSpecializations)
    if not GetProfessions or not GetProfessionInfo then return end
    local lines = includeSpecializations and C_TradeSkillUI and read(C_TradeSkillUI.GetAllProfessionTradeSkillLines) or {}
    local entries = {}
    local infoBySkillLine = {}
    -- The returned slots are sparse when a primary or secondary profession is missing.
    for _, index in pairs({ GetProfessions() }) do
        local ok, name, _, skill, maximum, _, _, skillLineID, modifier, _, _, skillLineName = pcall(GetProfessionInfo, index)
        name = publicValue(name, "string")
        skillLineID = number(skillLineID)
        if ok and name and skillLineID then
            local profession = {
                name = name, skillLineID = skillLineID,
                skillLineName = publicValue(skillLineName, "string"),
                skillLevel = number(skill), maxSkillLevel = number(maximum), skillModifier = number(modifier),
            }
            for lineIndex, childID in ipairs(lines or {}) do
                if lineIndex > 256 then break end
                if infoBySkillLine[childID] == nil then
                    infoBySkillLine[childID] = read(C_TradeSkillUI.GetProfessionInfoBySkillLineID, childID) or false
                end
                local info = infoBySkillLine[childID]
                if info and number(info.parentProfessionID) == skillLineID and profession.skillLineName
                    and publicValue(info.professionName, "string") == profession.skillLineName then
                    local success, details = pcall(specialization, childID)
                    if success then profession.specialization = details end
                    break
                end
            end
            entries[#entries + 1] = profession
        end
    end
    return { capturedAt = GetServerTime(), entries = entries }
end
