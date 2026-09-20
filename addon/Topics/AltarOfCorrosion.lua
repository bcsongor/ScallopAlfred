local _, addon = ...
local TraitTree = addon.TraitTree

-- The Altar of Corrosion's tree in Blizzard_GenericTraitUtil.lua.
local ALTAR_TREE = 1191

addon.AddTopic({
    text = "Altar of Corrosion",
    category = "altar",
    question = "What should I unlock next at the Altar of Corrosion?",
    available = function() return TraitTree.IsOpen(ALTAR_TREE) end,
    snapshot = { altar = function() return TraitTree.Read(ALTAR_TREE) end },
})
