local _, addon = ...
local Professions, Inventory, Recipes = addon.Professions, addon.Inventory, addon.Recipes

addon.AddTopic({
    text = "Make gold",
    category = "gold",
    question = "How should I make gold with what I have?",
    snapshot = { professions = Professions.ReadDetailed, inventory = Inventory.Read, recipes = Recipes.Read },
})
