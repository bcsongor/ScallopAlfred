local _, addon = ...
local Public, Count, Read = addon.Public, addon.Count, addon.Read
local Subjects = addon.Subjects

-- Every container a stack can sit in, grouped by where the player keeps it.
local containers = {}
local function add(group, name) containers[#containers + 1] = { group = group, id = Enum.BagIndex[name] } end
add("bags", "Backpack")
for index = 1, 4 do add("bags", "Bag_" .. index) end
add("bags", "ReagentBag")
for index = 1, 6 do add("bank", "CharacterBankTab_" .. index) end
for index = 1, 5 do add("warbank", "AccountBankTab_" .. index) end

local function newEntry(link)
    local entry = Subjects.Item(link)
    entry.count = { bags = 0, bank = 0, warbank = 0 }
    local item = TSM_API and Public(Read(TSM_API.ToItemString, entry.link), "string")
    if item then
        entry.auctionCount = Count(Read(TSM_API.GetAuctionQuantity, item))
        entry.mailCount = Count(Read(TSM_API.GetMailQuantity, item))
    end
    return entry
end

local Inventory = {}
addon.Inventory = Inventory

-- One pass over every readable container. Bank and Warband tabs report no slots while their windows are
-- closed, so the snapshot records which of them the player could actually see. No tooltips: stacks are many.
function Inventory.Read()
    local snapshot = {
        capturedAt = GetServerTime(),
        moneyCopper = Count(Read(GetMoney)),
        bankIncluded = false,
        warbankIncluded = false,
        items = {},
    }
    local entries = {}
    for _, container in ipairs(containers) do
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
                    entry = newEntry(link)
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
