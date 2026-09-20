local _, addon = ...
local Count = addon.Count
local Achievements = addon.Achievements

local function tracked()
    local list = {}
    for _, id in ipairs(Achievements.Tracked()) do
        local achievementID = Count(id)
        local entry = achievementID and #list < 12 and Achievements.Read(achievementID)
        if entry then list[#list + 1] = entry end
    end
    if #list > 0 then return list end
end

-- Tracking is how the player says which achievements they are working on, so the topic follows the tracker.
addon.AddTopic({
    text = "Tracked achievements",
    category = "achievements",
    question = "How do I finish the achievements I'm tracking?",
    available = function() return #Achievements.Tracked() > 0 end,
    snapshot = { achievements = tracked },
})
