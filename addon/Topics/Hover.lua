local _, addon = ...

-- Presets for the hovered subject. They copy a request straight away, with the subject attached.
local defaultQuestions = {
    item = "What's this for?",
    quest = "How do I complete this quest?",
    spell = "How does this spell work?",
    achievement = "How do I earn this achievement?",
    currency = "How do I earn and spend this currency?",
}

local function defaultQuestion(subject)
    return defaultQuestions[subject.type] or "Tell me about this."
end

addon.AddTopic({ kind = "subject", text = defaultQuestion })
addon.AddTopic({ kind = "subject", text = "Is it an upgrade?", itemOnly = true, category = "gear" })
addon.AddTopic({ kind = "subject", text = "Keep, sell or disenchant?", itemOnly = true })
addon.AddTopic({ kind = "subject", text = "Where does it drop?", itemOnly = true })
