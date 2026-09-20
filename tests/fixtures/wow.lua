-- Stand-ins for the WoW APIs the addon uses. Tests change these globals to set up each scenario.

UIParent = {}; UISpecialFrames = {}; widgets = {}; frames = {}
local methods = {}
function methods:SetText(value) self.text = value; if self.kind == "EditBox" then copied = value end end
function methods:SetFocus() focused = self end
function methods:HasFocus() return focused == self end
function methods:ClearFocus() if focused == self then focused = nil end end
function methods:Show() self.hidden = false end
function methods:Hide() self.hidden = true; if self.scripts and self.scripts.OnHide then self.scripts.OnHide() end end
function methods:IsVisible() return not self.hidden and (not self.parent or not self.parent.hidden) end
function methods:Insert(value) self:SetText((self.text or "") .. value) end
function methods:SetScript(event, callback) self.scripts[event] = callback end
function methods:GetText() return self.text end
local metatable = { __index = function(_, key) return methods[key] or function() end end }
function CreateFrame(kind, name, parent)
  local frame = setmetatable({ kind = kind, scripts = {}, parent = parent }, metatable)
  frame.TitleText = setmetatable({}, metatable)
  frames[#frames + 1] = frame
  if name then _G[name] = frame end
  return frame
end
function methods:CreateTexture() return setmetatable({}, metatable) end
function methods:CreateFontString()
  local widget = setmetatable({}, metatable)
  widgets[#widgets + 1] = widget
  return widget
end

function print(value) notice = value end
function strtrim(value) return value:match("^%s*(.-)%s*$") end
function GetServerTime() return 1800000000 end
function GetTime() return 12.3456 end
function InCombatLockdown() return combat or false end
function IsMacClient() return mac or false end
function IsControlKeyDown() return controlDown or false end
function IsMetaKeyDown() return metaDown or false end
function IsKeyDown(key) return key == "C" and cDown or false end
function UnitClass() return "Druid" end
function UnitLevel() return 90 end
function GetAverageItemLevel() return 312.6, 310.4, 300 end
function GetBuildInfo() return "12.1.0", "12345" end
function GetBindingKey() return nil end
function GetBindingAction() return existingBinding or "" end
function SetBinding(key, action) bound = key .. ":" .. action end
function GetInventoryItemLink(_, slot) return "item:" .. slot end
function GetMoney() return money or 0 end

-- Bags are `bags[bagID] = { <slot info>, false, ... }`, where false is an empty slot and no entry means a
-- container the player can't see, like a closed bank tab.
C_Container = {
  GetContainerNumSlots = function(bagID) local bag = bags and bags[bagID]; return bag and #bag or 0 end,
  GetContainerItemInfo = function(bagID, slot)
    local bag = bags and bags[bagID]
    return bag and bag[slot] or nil
  end,
}

secret = {}
function issecretvalue(value) return value == secret end

C_SpecializationInfo = {
  GetSpecialization = function() return 4 end,
  GetSpecializationInfo = function() return 105, "Restoration" end,
}
C_Item = {
  GetItemInfo = function(link) return "Equipped " .. link, link, itemQuality end,
  GetItemInfoInstant = function() return 123, "", "", "INVTYPE_FINGER" end,
}
ITEM_QUALITY_COLORS = { [4] = { color = { WrapTextInColorCode = function(_, text) return "|cffa335ee" .. text .. "|r" end } } }
NORMAL_FONT_COLOR = { WrapTextInColorCode = function(_, text) return "|cffffd100" .. text .. "|r" end }
function CreateAtlasMarkup(atlas, width, height) return "|A:" .. atlas .. ":" .. height .. ":" .. width .. "|a" end
C_TooltipInfo = {
  GetHyperlink = function()
    return { lines = {
      { leftText = 'A "quoted" line\nwith a newline', rightText = "Other side" },
      { leftText = secret },
      { leftText = "|cff00ff00Green text|r" },
    } }
  end,
}
Enum = {
  TooltipDataType = { Quest = 23, Currency = 5, Achievement = 12 },
  BagIndex = {
    Backpack = 0, Bag_1 = 1, Bag_2 = 2, Bag_3 = 3, Bag_4 = 4, ReagentBag = 5,
    CharacterBankTab_1 = 6, CharacterBankTab_2 = 7, CharacterBankTab_3 = 8,
    CharacterBankTab_4 = 9, CharacterBankTab_5 = 10, CharacterBankTab_6 = 11,
    AccountBankTab_1 = 13, AccountBankTab_2 = 14, AccountBankTab_3 = 15,
    AccountBankTab_4 = 16, AccountBankTab_5 = 17,
  },
  CachedRewardType = { Item = 1, Currency = 2 },
  ContentTrackingType = { Appearance = 0, Mount = 1, Achievement = 2 },
  CraftingReagentType = { Basic = 1, Modifying = 2, Finishing = 3 },
}

-- Nothing is tracked until a test sets `trackedAchievements` to IDs described by `achievementData`,
-- `achievementData[id] = { name, points, completed, description, reward, criteria = { { name, completed, quantity, required } } }`.
C_ContentTracking = { GetTrackedIDs = function() return trackedAchievements or {} end }
local function achievement(id) return achievementData and achievementData[id] end
function GetAchievementInfo(id)
  local entry = achievement(id)
  if not entry then return end
  return id, entry.name, entry.points, entry.completed, nil, nil, nil, entry.description, nil, nil, entry.reward
end
function GetAchievementNumCriteria(id)
  local entry = achievement(id)
  return entry and entry.criteria and #entry.criteria or 0
end
function GetAchievementCriteriaInfo(id, index)
  local entry = achievement(id)
  local criterion = entry and entry.criteria and entry.criteria[index]
  if not criterion then return end
  return criterion.name, nil, criterion.completed, criterion.quantity, criterion.required
end

-- No profession window is open until a test sets `tradeSkillReady` and `professionWindow`. Recipes are
-- `recipes[recipeID] = { name, learned, ..., link, schematic }`, listed in `recipeIDs`.
C_TradeSkillUI = {
  GetAllProfessionTradeSkillLines = function() return {} end,
  IsTradeSkillReady = function() return tradeSkillReady or false end,
  IsTradeSkillLinked = function() return tradeSkillLinked or false end,
  IsTradeSkillGuild = function() return tradeSkillGuild or false end,
  IsNPCCrafting = function() return npcCrafting or false end,
  GetChildProfessionInfo = function() return professionWindow end,
  GetAllRecipeIDs = function() return recipeIDs or {} end,
  GetRecipeInfo = function(id) return recipes and recipes[id] end,
  GetRecipeItemLink = function(id) return recipes and recipes[id] and recipes[id].link end,
  GetRecipeSchematic = function(id) return recipes and recipes[id] and recipes[id].schematic end,
}

-- TSM stays silent until a test sets `tsmData`, with prices keyed by item string and then source.
TSM_API = {
  ToItemString = function(link)
    local id = tostring(link):match("item:(%d+)")
    return tsmData and id and "i:" .. id or nil
  end,
  GetCustomPriceValue = function(source, item)
    local prices = tsmData and tsmData.prices and tsmData.prices[item]
    return prices and prices[source]
  end,
  GetAuctionQuantity = function(item) return tsmData and tsmData.auctions and tsmData.auctions[item] end,
  GetMailQuantity = function(item) return tsmData and tsmData.mails and tsmData.mails[item] end,
}
-- The vault offers nothing until a test sets `vaultActivities`, a list of
-- `{ progress = ..., threshold = ..., rewards = { { itemDBID = ... } or { type = 2, id = <currency> } } }`.
C_WeeklyRewards = {
  HasAvailableRewards = function() return vaultActivities ~= nil end,
  GetActivities = function() return vaultActivities end,
  GetItemHyperlink = function(id) return "|Hitem:" .. id .. "|h[Vault " .. id .. "]|h" end,
}
C_Spell = { GetSpellLink = function(id) return "|cff71d5ff|Hspell:" .. id .. "|h[Rejuvenation]|h|r" end }
GameTooltip = {
  IsShown = function() return not tooltipHidden end,
  GetItem = function() if not noItem then return 'Ring "of" stars', "item:123" end end,
  GetSpell = function() return "Rejuvenation", spellID end,
  GetPrimaryTooltipInfo = function() return tooltipInfo end,
  GetTooltipData = function() return tooltipData end,
  GetOwner = function() return tooltipOwner end,
}
function UnitGUID(unit) if unit == "target" then return targetGUID end end
function UnitName(unit) if unit == "target" then return targetName end end
C_TooltipInfo.GetUnit = function() return { lines = { { leftText = targetName }, { leftText = "Level 80 Elite" } } } end
C_QuestLog = { GetTitleForQuestID = function(id) return "Quest " .. id end }
ChatFrameUtil = { InsertLink = function() end }
SlashCmdList = {}

function hooksecurefunc(target, name, callback)
  if type(target) == "string" then callback = name; name = target; target = _G end
  local original = target[name]
  target[name] = function(...) if original then original(...) end; callback(...) end
end

-- Clicks a visible dialog button by its text.
function choose(text)
  for _, frame in ipairs(frames) do
    if frame.kind == "Button" and frame.text == text and frame:IsVisible() then frame.scripts.OnClick(); return end
  end
  error("No button: " .. text)
end
