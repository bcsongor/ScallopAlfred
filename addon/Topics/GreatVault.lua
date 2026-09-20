local _, addon = ...
local Count, Read = addon.Count, addon.Read
local Subjects, Equipment, Talents = addon.Subjects, addon.Equipment, addon.Talents

-- Everything the Great Vault offers once it has rolled after the weekly reset. Unlocked slots offer items; the
-- concession offers items or currencies, such as a Nebulous Voidcore in place of gear.
local function rewards()
    local result = {}
    for _, activity in ipairs(Read(C_WeeklyRewards.GetActivities) or {}) do
        if (Count(activity.progress) or 0) >= (Count(activity.threshold) or math.huge) then
            for _, reward in ipairs(activity.rewards or {}) do
                local link = reward.itemDBID and Read(C_WeeklyRewards.GetItemHyperlink, reward.itemDBID)
                    or reward.type == Enum.CachedRewardType.Currency and Count(reward.id) and "currency:" .. reward.id
                local option = link and Subjects.Read(link)
                if option and #result < 12 then result[#result + 1] = option end
            end
        end
    end
    return result
end

-- Reward links only exist once the vault has rolled, so the topic waits for that.
addon.AddTopic({
    text = "Great Vault",
    category = "vault",
    question = "Which Great Vault reward should I pick?",
    available = function() return Read(C_WeeklyRewards.HasAvailableRewards) == true end,
    snapshot = { vault = rewards, equipped = Equipment.All, talents = Talents.Read },
})
