local _, addon = ...
local Count, Read = addon.Count, addon.Read
local Subjects = addon.Subjects

local GreatVault = {}
addon.GreatVault = GreatVault

-- Reward links only exist once the vault has rolled after the weekly reset.
function GreatVault.HasRewards()
    return Read(C_WeeklyRewards.HasAvailableRewards) == true
end

-- Everything the vault offers. Unlocked slots offer items; the concession offers items or currencies, such as a
-- Nebulous Voidcore in place of gear. Only slots unlocked last week carry rewards, while `progress` already
-- counts this week, so it cannot tell which slots are on offer.
function GreatVault.Rewards()
    local result = {}
    for _, activity in ipairs(Read(C_WeeklyRewards.GetActivities) or {}) do
        for _, reward in ipairs(activity.rewards or {}) do
            local link = reward.itemDBID and Read(C_WeeklyRewards.GetItemHyperlink, reward.itemDBID)
                or reward.type == Enum.CachedRewardType.Currency and Count(reward.id) and "currency:" .. reward.id
            local option = link and Subjects.Read(link)
            if option and #result < 12 then result[#result + 1] = option end
        end
    end
    return result
end
