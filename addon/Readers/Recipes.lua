local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read
local PlainText, Subjects = addon.PlainText, addon.Subjects

local Recipes = {}
addon.Recipes = Recipes

local function basicReagentType()
    local types = Enum and Public(Enum.CraftingReagentType, "table")
    return (types and Count(types.Basic)) or 1
end

local function marketCopper(itemID)
    local item = TSM_API and Public(Read(TSM_API.ToItemString, "item:" .. itemID), "string")
    return item and Count(Read(TSM_API.GetCustomPriceValue, "DBMarket", item))
end

-- Recipes are readable only from an open profession window, and only when it is the player's own:
-- linked, guild and NPC crafting windows show someone else's list.
local function openProfession()
    if type(C_TradeSkillUI) ~= "table" then return end
    if not Read(C_TradeSkillUI.IsTradeSkillReady) then return end
    if Read(C_TradeSkillUI.IsTradeSkillLinked) or Read(C_TradeSkillUI.IsTradeSkillGuild)
        or Read(C_TradeSkillUI.IsNPCCrafting) then return end
    local info = Public(Read(C_TradeSkillUI.GetChildProfessionInfo), "table")
        or Public(Read(C_TradeSkillUI.GetBaseProfessionInfo), "table")
    local name = info and Public(info.professionName, "string")
    local skillLineID = info and Count(info.professionID)
    if not name or not skillLineID then return end
    return {
        capturedAt = GetServerTime(), professionName = name, skillLineID = skillLineID,
        skillLevel = Count(info.skillLevel), maxSkillLevel = Count(info.maxSkillLevel),
        entries = {},
    }
end

-- Enchants and salvage recipes produce no item, so they carry no output at all.
local function recipeOutput(recipeID)
    local link = Public(Read(C_TradeSkillUI.GetRecipeItemLink, recipeID), "string")
    if not link then return end
    local key = link:match("|H(.-)|h") or link
    local name = PlainText(link:match("|h%[(.-)%]|h")) or Public(Read(C_Item.GetItemInfo, key), "string")
    return {
        link = key, name = name or key,
        quality = Count(Read(function() return (select(3, C_Item.GetItemInfo(key))) end)),
        tsm = Subjects.Prices(key),
    }
end

local function addReagents(entry, schematic)
    local basic = basicReagentType()
    for _, slot in ipairs(Public(schematic.reagentSlotSchematics, "table") or {}) do
        if #entry.reagents >= 12 then return end
        -- A quality reagent slot lists every tier; the first one identifies what the slot wants.
        local options = Public(slot.reagents, "table")
        local first = options and Public(options[1], "table")
        local itemID = first and Count(first.itemID)
        if itemID and Count(slot.reagentType) == basic then
            entry.reagents[#entry.reagents + 1] = {
                itemID = itemID,
                name = Public(Read(C_Item.GetItemInfo, itemID), "string"),
                quantity = Count(slot.quantityRequired) or 0,
                marketCopper = marketCopper(itemID),
            }
        end
    end
end

function Recipes.Read()
    local snapshot = openProfession()
    if not snapshot then return end
    for _, id in ipairs(Public(Read(C_TradeSkillUI.GetAllRecipeIDs), "table") or {}) do
        if #snapshot.entries >= 200 then break end
        local recipeID = Count(id)
        local info = recipeID and Public(Read(C_TradeSkillUI.GetRecipeInfo, recipeID), "table")
        local name = info and Public(info.name, "string")
        if name and Public(info.learned, "boolean") then
            local entry = {
                recipeID = recipeID, name = name,
                skillUps = Count(info.numSkillUps),
                craftable = Public(info.craftable, "boolean"),
                output = recipeOutput(recipeID),
                reagents = {},
            }
            local schematic = Public(Read(C_TradeSkillUI.GetRecipeSchematic, recipeID, false), "table")
            if schematic then
                if entry.output then
                    entry.output.quantityMin = Count(schematic.quantityMin)
                    entry.output.quantityMax = Count(schematic.quantityMax)
                end
                addReagents(entry, schematic)
            end
            -- Profession stat boosts appear as enchant recipes without reagents. They make no gold.
            if #entry.reagents > 0 or (entry.output and entry.output.link:match("^item:")) then
                snapshot.entries[#snapshot.entries + 1] = entry
            end
        end
    end
    return snapshot
end
