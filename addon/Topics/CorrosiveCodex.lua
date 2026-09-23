local _, addon = ...
local Codex = addon.Codex

addon.AddTopic({
    text = "Corrosive Codex",
    category = "codex",
    question = "Which Corrosive Codex power should I unlock or equip next?",
    available = Codex.IsOpen,
    snapshot = { codex = Codex.Read },
})
