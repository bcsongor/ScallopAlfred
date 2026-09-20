local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read
local Subjects, Equipment, Professions = addon.Subjects, addon.Equipment, addon.Professions

local sequence = 0

local function nextID()
    sequence = sequence + 1
    return string.format("%d-%d-%d", GetServerTime(), math.floor(GetTime() * 1000), sequence)
end

-- All input comes from BuildRequest. Empty tables represent JSON arrays.
local function json(value)
    if type(value) == "number" and (value ~= value or math.abs(value) == math.huge) then return "null" end
    if type(value) == "string" then
        return '"' .. value:gsub('[%z\1-\31\\"]', function(character)
            if character == '"' then return '\\"' end
            if character == "\\" then return "\\\\" end
            return string.format("\\u%04x", string.byte(character))
        end) .. '"'
    end
    if type(value) ~= "table" then return tostring(value) end
    local parts = {}
    if #value > 0 or next(value) == nil then
        for _, entry in ipairs(value) do parts[#parts + 1] = json(entry) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for key, entry in pairs(value) do parts[#parts + 1] = json(key) .. ":" .. json(entry) end
    return "{" .. table.concat(parts, ",") .. "}"
end

-- The readers behind a category. Subject presets name a category and share its topic's snapshot.
local function snapshotFor(category)
    for _, topic in ipairs(addon.Topics) do
        if topic.category == category and topic.snapshot then return topic.snapshot end
    end
    return {}
end

-- Returns the request, or nil and a message for the player. `thread` is "new" or "followup".
function addon.BuildRequest(question, subject, category, thread)
    local subjects = Subjects.Linked(question, subject)
    if #subjects > 8 then return nil, "Use up to eight subjects, including the hovered subject." end
    local specIndex = Public(Read(C_SpecializationInfo.GetSpecialization), "number")
    local specName = specIndex and Public((select(2, C_SpecializationInfo.GetSpecializationInfo(specIndex))), "string")
    -- The equipped average, floored like the character pane shows it.
    local itemLevel = Count(Read(function() return (select(2, GetAverageItemLevel())) end))
    local request = {
        id = nextID(), context = nextID(), thread = thread, question = question, category = category,
        player = {
            name = Public(Read(UnitName, "player"), "string"),
            class = Public(Read(UnitClass, "player"), "string"),
            spec = specName or "Unselected",
            level = Public(Read(UnitLevel, "player"), "number"),
            itemLevel = itemLevel and math.floor(itemLevel),
        },
        gameVersion = Public(Read(GetBuildInfo), "string"),
        subjects = subjects,
    }
    -- Each reader runs on its own, so one failing snapshot never blocks the question.
    for field, read in pairs(snapshotFor(category)) do request[field] = Read(read) end
    -- Every question carries profession skills and the slots its subjects could replace, unless the topic sent more.
    request.equipped = request.equipped or Equipment.ForSubjects(subjects)
    request.professions = request.professions or Read(Professions.Read)
    return request
end

function addon.EncodeRequest(request)
    return "SCALLOPALFRED:" .. json(request)
end

-- The show command carries a fresh ID so copying it twice in a row is seen twice.
function addon.EncodeShowCommand()
    return "SCALLOPALFRED:SHOW " .. nextID()
end
