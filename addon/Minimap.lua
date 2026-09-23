local _, addon = ...
local ShowCopyBox, EncodeShowCommand = addon.ShowCopyBox, addon.EncodeShowCommand

-- A minimap button that brings the desktop overlay back. Clicking it opens the copy box with the show
-- command, which the app raises the overlay for. Drag the button around the ring; its angle is saved.
-- Angles are degrees anticlockwise from the minimap's right edge, so the default sits bottom left.
local angle = 225

local button = CreateFrame("Button", "ScallopAlfredMinimapButton", Minimap)
button:SetSize(31, 31)
button:SetFrameStrata("MEDIUM")
button:SetFrameLevel(8)
button:RegisterForClicks("LeftButtonUp")
button:RegisterForDrag("LeftButton")

-- The same icon the addon list shows, cropped to sit inside the ring.
local icon = button:CreateTexture(nil, "ARTWORK")
icon:SetTexture("Interface\\Icons\\INV_Misc_Shell_03")
icon:SetTexCoord(0.08, 0.92, 0.08, 0.92)
icon:SetSize(19, 19)
icon:SetPoint("TOPLEFT", 7, -6)

local ring = button:CreateTexture(nil, "OVERLAY")
ring:SetTexture("Interface\\Minimap\\MiniMap-TrackingBorder")
ring:SetSize(53, 53)
ring:SetPoint("TOPLEFT")

-- Puts the button on the minimap's edge, so it follows a resized minimap.
local function place()
    local radius = Minimap:GetWidth() / 2 + 5
    button:ClearAllPoints()
    button:SetPoint("CENTER", Minimap, "CENTER", math.cos(math.rad(angle)) * radius, math.sin(math.rad(angle)) * radius)
end

-- The cursor is in screen pixels and the minimap in interface units, so the scale divides out.
local function follow()
    local scale = Minimap:GetEffectiveScale()
    local centreX, centreY = Minimap:GetCenter()
    local cursorX, cursorY = GetCursorPosition()
    angle = math.deg(math.atan2(cursorY / scale - centreY, cursorX / scale - centreX)) % 360
    place()
end

button:SetScript("OnDragStart", function(self) self:SetScript("OnUpdate", follow) end)
button:SetScript("OnDragStop", function(self)
    self:SetScript("OnUpdate", nil)
    -- The saved variable is nil until the addon first stores something.
    ScallopAlfredDB = ScallopAlfredDB or {}
    ScallopAlfredDB.minimapAngle = angle
end)
button:SetScript("OnClick", function() ShowCopyBox(EncodeShowCommand()) end)
button:SetScript("OnEnter", function(self)
    GameTooltip:SetOwner(self, "ANCHOR_LEFT")
    GameTooltip:AddLine("Scallop Alfred")
    GameTooltip:AddLine("Click to show the overlay, then press " .. (IsMacClient() and "Cmd+C" or "Ctrl+C") .. ".", 1, 1, 1)
    GameTooltip:AddLine("Drag to move this button.", 0.6, 0.6, 0.6)
    GameTooltip:Show()
end)
button:SetScript("OnLeave", function() GameTooltip:Hide() end)

place()

-- Called on login, once the saved angle has loaded.
function addon.RestoreMinimapButton()
    angle = tonumber(ScallopAlfredDB and ScallopAlfredDB.minimapAngle) or angle
    place()
end
