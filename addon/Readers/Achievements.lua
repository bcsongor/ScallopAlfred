local _, addon = ...
local Public, Count, Read, PlainText = addon.Public, addon.Count, addon.Read, addon.PlainText

local Achievements = {}
addon.Achievements = Achievements

-- The IDs WoW shows in the objective tracker. Tracking moved to C_ContentTracking, which handles mounts and
-- appearances too, so the type has to come from the enum rather than a number of our own.
function Achievements.Tracked()
    local kind = Enum.ContentTrackingType and Count(Enum.ContentTrackingType.Achievement)
    if not kind then return {} end
    return Read(function() return C_ContentTracking.GetTrackedIDs(kind) end) or {}
end

-- A criterion is either a checklist line or a bar counting up to a total.
local function criteria(achievementID)
    local list = {}
    local total = Count(Read(GetAchievementNumCriteria, achievementID)) or 0
    for index = 1, math.min(total, 40) do
        local info = Read(function() return { GetAchievementCriteriaInfo(achievementID, index) } end)
        local name = info and PlainText(info[1])
        if name and name ~= "" then
            local required = Count(info[5])
            local counts = required ~= nil and required > 1
            list[#list + 1] = {
                name = name,
                completed = Public(info[3], "boolean") or nil,
                quantity = counts and Count(info[4]) or nil,
                required = counts and required or nil,
            }
        end
    end
    return list
end

-- One achievement with everything needed to say what is left: its description, its reward and its criteria.
function Achievements.Read(achievementID)
    local info = Read(function() return { GetAchievementInfo(achievementID) } end)
    local name = info and PlainText(info[2])
    if not name then return end
    local reward = PlainText(info[11])
    return {
        id = achievementID,
        name = name,
        description = PlainText(info[8]),
        points = Count(info[3]),
        completed = Public(info[4], "boolean") or nil,
        reward = reward ~= "" and reward or nil,
        criteria = criteria(achievementID),
    }
end
