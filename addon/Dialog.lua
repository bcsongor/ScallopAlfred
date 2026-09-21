local _, addon = ...
local Public, Notify = addon.Public, addon.Notify
local Subjects = addon.Subjects

-- Subject presets ask about the hovered subject straight away. With nothing hovered, a targeted NPC offers the
-- target preset and otherwise the topics open the editor, unless the topic carries its own question. Custom
-- opens the editor either way. Contextual presets are green and sit above the generic topics, which are red.
-- Custom is grey.
local presets = {}
for index, topic in ipairs(addon.Topics) do presets[index] = topic end
presets[#presets + 1] = { kind = "custom", text = "Custom question" }

local mode -- "menu", "question" or "copy"
local selectedSubject
local selectedTarget
local selectedCategory

local function presetAvailable(preset, subject, target)
    if preset.kind == "custom" then return true end
    if preset.kind == "target" then return subject == nil and target ~= nil end
    if preset.kind == "topic" then
        return (preset.always or subject == nil and target == nil) and (not preset.available or preset.available())
    end
    return subject ~= nil and (not preset.itemOnly or subject.type == "item")
end

local function presetText(preset, subject)
    return type(preset.text) == "function" and preset.text(subject) or preset.text
end

local dialog = CreateFrame("Frame", "ScallopAlfredDialog", UIParent, "BasicFrameTemplateWithInset")
dialog:SetWidth(320)
dialog:SetPoint("CENTER")
dialog:SetFrameStrata("DIALOG")
dialog.TitleText:SetText("Scallop Alfred")
dialog:Hide()
table.insert(UISpecialFrames, "ScallopAlfredDialog")

local label = dialog:CreateFontString(nil, "OVERLAY", "GameFontHighlight")
label:SetPoint("TOPLEFT", 18, -38)
label:SetPoint("TOPRIGHT", -18, -38)
label:SetJustifyH("LEFT")

local edit = CreateFrame("EditBox", nil, dialog, "InputBoxTemplate")
edit:SetPoint("TOPLEFT", 24, -78)
edit:SetPoint("RIGHT", -20, 0)
edit:SetHeight(30)
edit:SetAutoFocus(false)
edit:SetScript("OnEscapePressed", function() dialog:Hide() end)
-- Let WoW copy on key-down before closing, whichever shortcut key is released first.
edit:SetScript("OnKeyUp", function(_, key)
    if mode ~= "copy" then return end
    local copyReleased = key == "C" and (IsControlKeyDown() or (IsMacClient() and IsMetaKeyDown()))
    local modifierReleased = key == "LCTRL" or key == "RCTRL"
        or (IsMacClient() and (key == "LMETA" or key == "RMETA"))
    if copyReleased or (modifierReleased and IsKeyDown("C")) then dialog:Hide() end
end)
dialog:SetScript("OnHide", function() edit:ClearFocus() end)

local hint = dialog:CreateFontString(nil, "OVERLAY", "GameFontHighlightSmall")
hint:SetPoint("BOTTOMLEFT", 18, 18)
hint:SetPoint("BOTTOMRIGHT", -18, 18)
hint:SetJustifyH("LEFT")

local buttons = {}

-- Quests show the quest-giver mark and WoW's default yellow; items use their quality colour. A targeted NPC
-- titles the menu and the custom editor like a hovered subject, and custom questions then ask about it.
local function subjectTitle()
    local subject = selectedSubject or selectedTarget
    if not subject then return "Ask Scallop Alfred about World of Warcraft" end
    if subject.type == "quest" then
        return CreateAtlasMarkup("QuestNormal", 16, 16) .. " " .. NORMAL_FONT_COLOR:WrapTextInColorCode(subject.name)
    end
    if subject.type == "item" then
        local colour = subject.quality and ITEM_QUALITY_COLORS[subject.quality]
        if colour then return colour.color:WrapTextInColorCode(subject.name) end
    end
    return subject.name
end

local function showEditor(title, instructions)
    for _, button in ipairs(buttons) do button:Hide() end
    dialog:SetHeight(165)
    label:SetText(title)
    hint:SetText(instructions)
    edit:Show()
    dialog:Show()
    edit:SetFocus()
end

local function openEditor(title)
    mode = "question"
    showEditor(title, "Type a question or Shift-click a link, then press Enter.")
    edit:SetMaxLetters(2000)
    edit:SetText("")
end

local function showCopyBox(text)
    mode = "copy"
    showEditor("Copy this request to the desktop app", "Press " .. (IsMacClient() and "Cmd+C" or "Ctrl+C") .. " to copy and close.")
    edit:SetMaxLetters(0)
    edit:SetText(text)
    edit:HighlightText()
end

-- Builds the request and shows it for copying. `thread` is "new" or "followup".
function addon.SendQuestion(question, subject, category, thread)
    if InCombatLockdown() then Notify("Ask again after combat."); return end
    question = strtrim(question)
    if question == "" then return end
    local request, problem = addon.BuildRequest(question, subject, category, thread or "new")
    if not request then Notify(problem); return end
    showCopyBox(addon.EncodeRequest(request))
end

edit:SetScript("OnEnterPressed", function()
    if mode == "question" then addon.SendQuestion(edit:GetText(), selectedSubject or selectedTarget, selectedCategory) end
end)

hooksecurefunc(ChatFrameUtil, "InsertLink", function(link)
    link = Public(link, "string")
    if link and mode == "question" and edit:IsVisible() and edit:HasFocus() and not InCombatLockdown() then
        edit:Insert(link)
    end
end)

for index, preset in ipairs(presets) do
    local button = CreateFrame("Button", nil, dialog, "UIPanelButtonTemplate")
    button:SetHeight(28)
    local contextual = preset.kind == "subject" or preset.kind == "target" or preset.available ~= nil
    if contextual or preset.kind == "custom" then
        for _, region in ipairs({ button:GetRegions() }) do
            if region:IsObjectType("Texture") then region:SetDesaturated(true) end
        end
    end
    -- The button art is too dark for a tint to show, so contextual buttons add green light inside the bevel.
    if contextual then
        local glow = button:CreateTexture(nil, "BORDER")
        glow:SetPoint("TOPLEFT", 3, -3)
        glow:SetPoint("BOTTOMRIGHT", -3, 3)
        glow:SetColorTexture(0.05, 0.28, 0.08)
        glow:SetBlendMode("ADD")
    end
    button:SetScript("OnClick", function()
        if preset.kind == "subject" then
            addon.SendQuestion(presetText(preset, selectedSubject), selectedSubject, preset.category)
        elseif preset.kind == "target" then
            addon.SendQuestion(preset.text, selectedTarget)
        elseif preset.kind == "custom" then
            openEditor(subjectTitle())
        elseif preset.question then
            addon.SendQuestion(preset.question, nil, preset.category)
        else
            selectedCategory = preset.category
            openEditor(preset.text)
        end
    end)
    buttons[index] = button
end

function ScallopAlfred_Ask()
    if InCombatLockdown() then Notify("Ask again after combat."); return end
    selectedSubject = Subjects.Hovered()
    selectedTarget = nil
    local targetNotice
    if not selectedSubject then selectedTarget, targetNotice = Subjects.Target() end
    selectedCategory = nil
    mode = "menu"
    label:SetText(subjectTitle())
    hint:SetText(targetNotice or ((selectedSubject or selectedTarget) and "Choose a question, then copy the request." or "Choose a topic or ask your own question."))
    edit:Hide()
    edit:ClearFocus()
    local shown = 0
    for index, button in ipairs(buttons) do
        local preset = presets[index]
        button:Hide()
        if presetAvailable(preset, selectedSubject, selectedTarget) then
            button:SetText(presetText(preset, selectedSubject))
            button:ClearAllPoints()
            button:SetPoint("TOPLEFT", 20, -70 - shown * 34)
            button:SetPoint("RIGHT", -20, 0)
            button:Show()
            shown = shown + 1
        end
    end
    dialog:SetHeight(115 + shown * 34)
    dialog:Show()
end

-- Copying the show command brings a hidden overlay back. The minimap button is its only caller.
function addon.ShowOverlay()
    showCopyBox(addon.EncodeShowCommand())
end
