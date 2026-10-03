local _, addon = ...
local GreatVault, Equipment, Talents = addon.GreatVault, addon.Equipment, addon.Talents

addon.AddTopic({
    text = "Great Vault",
    category = "vault",
    question = "Which Great Vault reward should I pick?",
    available = GreatVault.IsChoosing,
    snapshot = { vault = GreatVault.Rewards, equipped = Equipment.All, talents = Talents.Read },
})
