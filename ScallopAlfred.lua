BINDING_HEADER_SCALLOPALFRED = "Scallop Alfred"
BINDING_NAME_SCALLOPALFRED_ASK = "Ask about a tooltip or link"

local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read

--
-- GAME DATA
--

local equipmentSlots = {
    INVTYPE_HEAD = { 1 }, INVTYPE_NECK = { 2 }, INVTYPE_SHOULDER = { 3 },
    INVTYPE_BODY = { 4 }, INVTYPE_CHEST = { 5 }, INVTYPE_ROBE = { 5 },
    INVTYPE_WAIST = { 6 }, INVTYPE_LEGS = { 7 }, INVTYPE_FEET = { 8 },
    INVTYPE_WRIST = { 9 }, INVTYPE_HAND = { 10 }, INVTYPE_FINGER = { 11, 12 },
    INVTYPE_TRINKET = { 13, 14 }, INVTYPE_CLOAK = { 15 },
    INVTYPE_WEAPON = { 16, 17 }, INVTYPE_2HWEAPON = { 16, 17 },
    INVTYPE_WEAPONMAINHAND = { 16 }, INVTYPE_WEAPONOFFHAND = { 16, 17 },
    INVTYPE_SHIELD = { 16, 17 }, INVTYPE_HOLDABLE = { 16, 17 },
    INVTYPE_RANGED = { 16 }, INVTYPE_RANGEDRIGHT = { 16 }, INVTYPE_TABARD = { 19 },
}

local tooltipLinkTypes = {
    [Enum.TooltipDataType.Quest] = "quest",
    [Enum.TooltipDataType.Currency] = "currency",
    [Enum.TooltipDataType.Achievement] = "achievement",
}

local tsmSources = {
    minBuyoutCopper = "DBMinBuyout",
    regionMarketAvgCopper = "DBRegionMarketAvg",
    regionSaleAvgCopper = "DBRegionSaleAvg",
    saleRate = "DBRegionSaleRate",
    vendorSellCopper = "VendorSell",
}

local function plainText(text)
    text = Public(text, "string")
    if not text then return end
    return (text:gsub("|c%x%x%x%x%x%x%x%x", ""):gsub("|r", "")
        :gsub("|T.-|t", ""):gsub("|A.-|a", "")
        :gsub("|H.-|h(.-)|h", "%1"))
end

local function readSubject(link, name, tooltip)
    link = Public(link, "string")
    if not link then return end
    name = plainText(name) or plainText(link:match("|h%[(.-)%]|h"))
    link = link:match("|H(.-)|h") or link
    local kind = link:match("^(%a[%w_]*):")
    if not kind then return end
    tooltip = tooltip or Read(C_TooltipInfo.GetHyperlink, link)
    local quality
    if kind == "item" then
        local itemName, _, itemQuality = C_Item.GetItemInfo(link)
        name = name or plainText(itemName)
        quality = Count(itemQuality)
    end
    if not name and tooltip and tooltip.lines and tooltip.lines[1] then name = plainText(tooltip.lines[1].leftText) end
    local subject = { type = kind, name = name or link, link = link, quality = quality, tooltip = {} }
    if tooltip and tooltip.lines then
        for _, line in ipairs(tooltip.lines) do
            for _, field in ipairs({ "leftText", "rightText" }) do
                local text = plainText(line[field])
                if text and text ~= "" and #subject.tooltip < 80 then
                    subject.tooltip[#subject.tooltip + 1] = text
                end
            end
        end
    end
    return subject
end

-- Prefer the original hyperlink so item variants and other link parameters survive.
local function hoveredSubject()
    if not GameTooltip:IsShown() then return end
    local info = GameTooltip:GetPrimaryTooltipInfo()
    local data = GameTooltip:GetTooltipData()
    if info and info.getterName == "GetHyperlink" then
        return readSubject(info.getterArgs[1], nil, data)
    end
    local name, link = GameTooltip:GetItem()
    if Public(link, "string") then return readSubject(link, name, data) end
    local spellName, spellID = GameTooltip:GetSpell()
    if Public(spellID, "number") then
        return readSubject(C_Spell.GetSpellLink(spellID), spellName, data)
    end
    if data and not issecretvalue(data.type) and not issecretvalue(data.id) then
        local kind = tooltipLinkTypes[data.type]
        if kind and data.id then
            local title = data.lines and data.lines[1] and plainText(data.lines[1].leftText)
            return readSubject(kind .. ":" .. data.id, title, data)
        end
    end
    -- Quest log entries and map pins build their tooltips line by line, so only the owner knows the quest.
    local owner = Public(GameTooltip:GetOwner(), "table")
    local questID = owner and Public(owner.questID, "number")
    if questID then
        return readSubject("quest:" .. questID, C_QuestLog.GetTitleForQuestID(questID))
    end
end

-- The player's target, when it's an NPC. NPC GUIDs look like Creature-0-server-instance-zone-npcID-spawn.
local function targetSubject()
    local guid = Public(UnitGUID("target"), "string")
    local guidType, npcID = (guid or ""):match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-")
    if guidType ~= "Creature" and guidType ~= "Vehicle" then return end
    return readSubject("npc:" .. npcID, UnitName("target"), Read(C_TooltipInfo.GetUnit, "target"))
end

local function linkedSubjects(question, hovered)
    local subjects, seen = {}, {}
    if hovered then
        subjects[1] = hovered
        seen[hovered.link] = true
    end
    for link, name in question:gmatch("|H(.-)|h(.-)|h") do
        if not seen[link] then
            local subject = readSubject(link, (name:gsub("^%[(.*)%]$", "%1")))
            if subject then
                subjects[#subjects + 1] = subject
                seen[link] = true
            end
        end
    end
    return subjects
end

-- Read TSM's cached values only. A missing source must not prevent copying a question.
local function tsmPrices(link)
    if not TSM_API then return end
    local item = Public(Read(TSM_API.ToItemString, link), "string")
    if not item then return end
    local prices = {}
    for field, source in pairs(tsmSources) do
        local value = Count(Read(TSM_API.GetCustomPriceValue, source, item))
        if value and (field ~= "saleRate" or value <= 1) then prices[field] = value end
    end
    if next(prices) then
        prices.capturedAt = GetServerTime()
        return prices
    end
end

local function equippedItems(subjects, fullSet)
    local result, seen = {}, {}
    local function addSlot(slotID)
        if seen[slotID] then return end
        seen[slotID] = true
        local equipped = readSubject(GetInventoryItemLink("player", slotID))
        if equipped then
            equipped.slot = slotID
            result[#result + 1] = equipped
        end
    end
    if fullSet then
        for slotID = 1, 19 do addSlot(slotID) end
        return result
    end
    for _, subject in ipairs(subjects) do
        if subject.type == "item" then
            local _, _, _, slot = C_Item.GetItemInfoInstant(subject.link)
            for _, slotID in ipairs(equipmentSlots[slot] or {}) do addSlot(slotID) end
        end
    end
    return result
end

--
-- REQUEST
--

local sequence = 0

local function nextID()
    sequence = sequence + 1
    return string.format("%d-%d-%d", GetServerTime(), math.floor(GetTime() * 1000), sequence)
end

-- All input comes from buildRequest. Empty tables represent JSON arrays.
local function json(value)
    if type(value) == "number" and (value ~= value or math.abs(value) == math.huge) then return "null" end
    if type(value) == "string" then
        return '"' .. value:gsub('[%z\1-\31\\"]', function(character)
            if character == '"' then return '\\"' end
            if character == "\\" then return "\\\\" end
            return string.format("\\u%04x", string.byte(character))
        end) .. '"'
    end
    if type(value) ~= "table" then return tostring(value) end
    local parts = {}
    if #value > 0 or next(value) == nil then
        for _, entry in ipairs(value) do parts[#parts + 1] = json(entry) end
        return "[" .. table.concat(parts, ",") .. "]"
    end
    for key, entry in pairs(value) do parts[#parts + 1] = json(key) .. ":" .. json(entry) end
    return "{" .. table.concat(parts, ",") .. "}"
end

-- Returns the request, or nil and a message for the player. `thread` is "new" or "followup".
local function buildRequest(question, subject, category, thread)
    local subjects = linkedSubjects(question, subject)
    if #subjects > 8 then return nil, "Use up to eight subjects, including the hovered subject." end
    for _, linked in ipairs(subjects) do
        if linked.type == "item" then linked.tsm = tsmPrices(linked.link) end
    end
    local gear = category == "gear"
    local specIndex = Public(Read(C_SpecializationInfo.GetSpecialization), "number")
    local specName = specIndex and Public((select(2, C_SpecializationInfo.GetSpecializationInfo(specIndex))), "string")
    return {
        id = nextID(), context = nextID(), thread = thread, question = question, category = category,
        player = {
            class = Public(Read(UnitClass, "player"), "string"),
            spec = specName or "Unselected",
            level = Public(Read(UnitLevel, "player"), "number"),
        },
        gameVersion = Public(Read(GetBuildInfo), "string"),
        subjects = subjects,
        equipped = equippedItems(subjects, gear),
        professions = Read(addon.GetProfessions, category == "professions"),
        talents = gear and Read(addon.GetTalents) or nil,
    }
end

--
-- DIALOG
--

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

-- Subject presets ask about the hovered subject straight away. With nothing hovered, the target preset asks about
-- a targeted NPC and topics open the editor. Custom opens the editor either way. Text can depend on the subject.
local presets = {
    { kind = "subject", text = defaultQuestion },
    { kind = "subject", text = "Is it an upgrade?", itemOnly = true, category = "gear" },
    { kind = "subject", text = "Keep, sell or disenchant?", itemOnly = true },
    { kind = "subject", text = "Where does it drop?", itemOnly = true },
    { kind = "target", text = "What should I know about my target?" },
    { kind = "topic", text = "Game mechanics", category = "mechanics" },
    { kind = "topic", text = "Professions", category = "professions" },
    { kind = "topic", text = "My gear", category = "gear" },
    { kind = "custom", text = "Custom question" },
}

local mode -- "menu", "question" or "copy"
local selectedSubject
local selectedTarget
local selectedCategory

local function notify(message)
    print("|cffe2c180Scallop Alfred:|r " .. message)
end

local function presetAvailable(preset, subject, target)
    if preset.kind == "custom" then return true end
    if preset.kind == "target" then return subject == nil and target ~= nil end
    if preset.kind == "topic" then return subject == nil end
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

-- Quests show the quest-giver mark and WoW's default yellow; items use their quality colour.
local function subjectTitle()
    local subject = selectedSubject
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

local function sendQuestion(question, subject, category, thread)
    if InCombatLockdown() then notify("Ask again after combat."); return end
    question = strtrim(question)
    if question == "" then return end
    local request, problem = buildRequest(question, subject, category, thread or "new")
    if not request then notify(problem); return end
    showCopyBox("SCALLOPALFRED:" .. json(request))
end

edit:SetScript("OnEnterPressed", function()
    if mode == "question" then sendQuestion(edit:GetText(), selectedSubject, selectedCategory) end
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
    if preset.kind == "custom" then
        for _, region in ipairs({ button:GetRegions() }) do
            if region:IsObjectType("Texture") then region:SetDesaturated(true) end
        end
    end
    button:SetScript("OnClick", function()
        if preset.kind == "subject" then
            sendQuestion(presetText(preset, selectedSubject), selectedSubject, preset.category)
        elseif preset.kind == "target" then
            sendQuestion(preset.text, selectedTarget)
        elseif preset.kind == "custom" then
            openEditor(subjectTitle())
        else
            selectedCategory = preset.category
            openEditor(preset.text)
        end
    end)
    buttons[index] = button
end

function ScallopAlfred_Ask()
    if InCombatLockdown() then notify("Ask again after combat."); return end
    selectedSubject = hoveredSubject()
    selectedTarget = not selectedSubject and targetSubject() or nil
    selectedCategory = nil
    mode = "menu"
    label:SetText(subjectTitle())
    hint:SetText(selectedSubject and "Choose a question, then copy the request." or "Choose a topic or ask your own question.")
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

--
-- SLASH COMMAND
--

-- "/q question" follows up on the thread open in the overlay. Links Shift-clicked into the chat line become subjects.
SLASH_SCALLOPALFRED1 = "/q"
SLASH_SCALLOPALFRED2 = "/alfred"
SlashCmdList.SCALLOPALFRED = function(message)
    message = Public(message, "string") or ""
    if strtrim(message) == "" then
        notify("Type your follow-up after /q. Shift-click links into the chat line to ask about them.")
        return
    end
    sendQuestion(message, nil, nil, "followup")
end

--
-- KEYBINDING
--

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    if not GetBindingKey("SCALLOPALFRED_ASK") and GetBindingAction("ALT-Q") == "" then
        SetBinding("ALT-Q", "SCALLOPALFRED_ASK")
    end
    notify("Press Alt+Q to ask a question, or type /q in chat to follow up. Change the keybind in Options > Keybindings.")
end)
