local _, addon = ...
local Equipment, Talents = addon.Equipment, addon.Talents

-- The hovered "Is it an upgrade?" preset shares this snapshot through the gear category.
addon.AddTopic({
    text = "My gear",
    category = "gear",
    always = true,
    snapshot = { equipped = Equipment.All, talents = Talents.Read },
})
