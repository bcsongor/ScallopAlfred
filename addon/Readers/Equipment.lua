local _, addon = ...
local Subjects = addon.Subjects

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

local Equipment = {}
addon.Equipment = Equipment

local function readSlots(slotIDs)
    local result, seen = {}, {}
    for _, slotID in ipairs(slotIDs) do
        if not seen[slotID] then
            seen[slotID] = true
            local equipped = Subjects.Read(GetInventoryItemLink("player", slotID))
            if equipped then
                equipped.slot = slotID
                result[#result + 1] = equipped
            end
        end
    end
    return result
end

-- Every worn item, for questions about the player's gear.
function Equipment.All()
    local slotIDs = {}
    for slotID = 1, 19 do slotIDs[slotID] = slotID end
    return readSlots(slotIDs)
end

-- Only the slots the given subjects could replace, so an item question can compare against them.
function Equipment.ForSubjects(subjects)
    local slotIDs = {}
    for _, subject in ipairs(subjects) do
        if subject.type == "item" then
            local _, _, _, slot = C_Item.GetItemInfoInstant(subject.link)
            for _, slotID in ipairs(equipmentSlots[slot] or {}) do slotIDs[#slotIDs + 1] = slotID end
        end
    end
    return readSlots(slotIDs)
end
