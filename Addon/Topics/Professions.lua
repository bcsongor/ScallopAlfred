local _, addon = ...
local Professions = addon.Professions

-- Every request carries profession skills; this topic adds the specialisation trees.
addon.AddTopic({
    text = "Professions",
    category = "professions",
    always = true,
    snapshot = { professions = Professions.ReadDetailed },
})
