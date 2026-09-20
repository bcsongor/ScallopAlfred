local _, addon = ...
local Achievements = addon.Achievements

local function selected()
    local achievementID = Achievements.Selected()
    return achievementID and Achievements.Read(achievementID)
end

-- Clicking an achievement in the Achievements window is how the player says which one they mean.
addon.AddTopic({
    text = "Selected achievement",
    category = "achievement",
    question = "How do I earn the achievement I've selected?",
    available = function() return Achievements.Selected() ~= nil end,
    snapshot = { achievement = selected },
})
