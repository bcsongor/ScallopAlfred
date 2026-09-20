local _, addon = ...
local Public, Count, Read, PlainText = addon.Public, addon.Count, addon.Read, addon.PlainText
local Subjects = addon.Subjects

local function bagID(name, fallback)
    local indices = Enum and Public(Enum.BagIndex, "table")
    return (indices and Count(indices[name])) or fallback
end

-- The enum moves between expansions, so each container falls back to the ID this client shipped with.
local function containers()
    local list = {}
    local function add(group, name, fallback)
        list[#list + 1] = { group = group, id = bagID(name, fallback) }
    end
    add("bags", "Backpack", 0)
    for index = 1, 4 do add("bags", "Bag_" .. index, index) end
    add("bags", "ReagentBag", 5)
    for index = 1, 6 do add("bank", "CharacterBankTab_" .. index, 5 + index) end
    for index = 1, 5 do add("warbank", "AccountBankTab_" .. index, 12 + index) end
    return list
end

local function newEntry(key, link)
    local name = PlainText(link:match("|h%[(.-)%]|h")) or Public(Read(C_Item.GetItemInfo, key), "string")
    local entry = {
        link = key, name = name or key,
        quality = Count(Read(function() return (select(3, C_Item.GetItemInfo(key))) end)),
        count = { bags = 0, bank = 0, warbank = 0 },
    }
    local item = TSM_API and Public(Read(TSM_API.ToItemString, key), "string")
    if item then
        entry.auctionCount = Count(Read(TSM_API.GetAuctionQuantity, item))
        entry.mailCount = Count(Read(TSM_API.GetMailQuantity, item))
    end
    entry.tsm = Subjects.Prices(key)
    return entry
end

local Inventory = {}
addon.Inventory = Inventory

-- One pass over every readable container. Bank and Warband tabs report no slots while their windows are
-- closed, so the snapshot records which of them the player could actually see. No tooltips: stacks are many.
function Inventory.Read()
    if type(C_Container) ~= "table" then return end
    local snapshot = {
        capturedAt = GetServerTime(),
        moneyCopper = Count(Read(GetMoney)),
        bankIncluded = false,
        warbankIncluded = false,
        items = {},
    }
    local entries = {}
    for _, container in ipairs(containers()) do
        local slots = Count(Read(C_Container.GetContainerNumSlots, container.id)) or 0
        if slots > 0 then
            if container.group == "bank" then snapshot.bankIncluded = true
            elseif container.group == "warbank" then snapshot.warbankIncluded = true end
        end
        for slot = 1, slots do
            local info = Public(Read(C_Container.GetContainerItemInfo, container.id, slot), "table")
            local link = info and Public(info.hyperlink, "string")
            if link then
                local key = link:match("|H(.-)|h") or link
                local entry = entries[key]
                if not entry then
                    if #snapshot.items >= 600 then return snapshot end
                    entry = newEntry(key, link)
                    entries[key] = entry
                    snapshot.items[#snapshot.items + 1] = entry
                end
                entry.count[container.group] = entry.count[container.group] + (Count(info.stackCount) or 0)
                if Public(info.isBound, "boolean") then entry.bound = true end
            end
        end
    end
    return snapshot
end
