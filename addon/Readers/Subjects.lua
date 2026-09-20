local _, addon = ...
local Public, Count, Read, PlainText = addon.Public, addon.Count, addon.Read, addon.PlainText

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
    marketCopper = "DBMarket",
    destroyCopper = "Destroy",
    craftingCopper = "Crafting",
}

-- A subject is anything the player can ask about: an item, spell, quest, currency, achievement or NPC, with
-- its link and tooltip text.
local Subjects = {}
addon.Subjects = Subjects

-- Read TSM's cached values only. A missing source must not prevent copying a question.
function Subjects.Prices(link)
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

function Subjects.Read(link, name, tooltip)
    link = Public(link, "string")
    if not link then return end
    name = PlainText(name) or PlainText(link:match("|h%[(.-)%]|h"))
    link = link:match("|H(.-)|h") or link
    local kind = link:match("^(%a[%w_]*):")
    if not kind then return end
    tooltip = tooltip or Read(C_TooltipInfo.GetHyperlink, link)
    local quality
    if kind == "item" then
        local itemName, _, itemQuality = C_Item.GetItemInfo(link)
        name = name or PlainText(itemName)
        quality = Count(itemQuality)
    end
    if not name and tooltip and tooltip.lines and tooltip.lines[1] then name = PlainText(tooltip.lines[1].leftText) end
    local subject = { type = kind, name = name or link, link = link, quality = quality, tooltip = {} }
    if tooltip and tooltip.lines then
        for _, line in ipairs(tooltip.lines) do
            for _, field in ipairs({ "leftText", "rightText" }) do
                local text = PlainText(line[field])
                if text and text ~= "" and #subject.tooltip < 80 then
                    subject.tooltip[#subject.tooltip + 1] = text
                end
            end
        end
    end
    return subject
end

-- Prefer the original hyperlink so item variants and other link parameters survive.
function Subjects.Hovered()
    if not GameTooltip:IsShown() then return end
    local info = GameTooltip:GetPrimaryTooltipInfo()
    local data = GameTooltip:GetTooltipData()
    if info and info.getterName == "GetHyperlink" then
        return Subjects.Read(info.getterArgs[1], nil, data)
    end
    local name, link = GameTooltip:GetItem()
    if Public(link, "string") then return Subjects.Read(link, name, data) end
    local spellName, spellID = GameTooltip:GetSpell()
    if Public(spellID, "number") then
        return Subjects.Read(C_Spell.GetSpellLink(spellID), spellName, data)
    end
    if data and not issecretvalue(data.type) and not issecretvalue(data.id) then
        local kind = tooltipLinkTypes[data.type]
        if kind and data.id then
            local title = data.lines and data.lines[1] and PlainText(data.lines[1].leftText)
            return Subjects.Read(kind .. ":" .. data.id, title, data)
        end
    end
    -- Quest log entries and map pins build their tooltips line by line, so only the owner knows the quest.
    local owner = Public(GameTooltip:GetOwner(), "table")
    local questID = owner and Public(owner.questID, "number")
    if questID then
        return Subjects.Read("quest:" .. questID, C_QuestLog.GetTitleForQuestID(questID))
    end
end

-- The player's target, when it's an NPC. NPC GUIDs look like Creature-0-server-instance-zone-npcID-spawn.
-- Some content, such as delves, hides the target's identity; the notice tells the player to ask by name.
function Subjects.Target()
    local guid = UnitGUID("target")
    if issecretvalue(guid) then return nil, "WoW hides this target here. Use Custom question and type its name." end
    guid = Public(guid, "string")
    local guidType, npcID = (guid or ""):match("^(%a+)%-%d+%-%d+%-%d+%-%d+%-(%d+)%-")
    if guidType ~= "Creature" and guidType ~= "Vehicle" then return end
    return Subjects.Read("npc:" .. npcID, UnitName("target"), Read(C_TooltipInfo.GetUnit, "target"))
end

-- The hovered subject first, then every link in the question, without duplicates. Items carry TSM prices.
function Subjects.Linked(question, hovered)
    local subjects, seen = {}, {}
    if hovered then
        subjects[1] = hovered
        seen[hovered.link] = true
    end
    for link, name in question:gmatch("|H(.-)|h(.-)|h") do
        if not seen[link] then
            local subject = Subjects.Read(link, (name:gsub("^%[(.*)%]$", "%1")))
            if subject then
                subjects[#subjects + 1] = subject
                seen[link] = true
            end
        end
    end
    for _, subject in ipairs(subjects) do
        if subject.type == "item" then subject.tsm = Subjects.Prices(subject.link) end
    end
    return subjects
end
