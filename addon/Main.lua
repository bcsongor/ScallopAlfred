BINDING_HEADER_SCALLOPALFRED = "Scallop Alfred"
BINDING_NAME_SCALLOPALFRED_ASK = "Ask about a tooltip or link"

local _, addon = ...
local Public, Notify = addon.Public, addon.Notify

-- "/q question" follows up on the thread open in the overlay. Links Shift-clicked into the chat line become subjects.
SLASH_SCALLOPALFRED1 = "/q"
SLASH_SCALLOPALFRED2 = "/alfred"
SlashCmdList.SCALLOPALFRED = function(message)
    message = Public(message, "string") or ""
    if strtrim(message) == "" then
        Notify("Type your follow-up after /q. Shift-click links into the chat line to ask about them.")
        return
    end
    addon.SendQuestion(message, nil, nil, "followup")
end

local events = CreateFrame("Frame")
events:RegisterEvent("PLAYER_LOGIN")
events:SetScript("OnEvent", function()
    if not GetBindingKey("SCALLOPALFRED_ASK") and GetBindingAction("ALT-Q") == "" then
        SetBinding("ALT-Q", "SCALLOPALFRED_ASK")
    end
    Notify("Press Alt+Q to ask a question, or type /q in chat to follow up. Change the keybind in Options > Keybindings.")
end)
