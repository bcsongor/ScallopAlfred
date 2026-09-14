import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import fengari from "fengari";
import { buildPrompt } from "../sidecar/codex.ts";
import { parseRequest, type WoWRequest } from "../sidecar/protocol.ts";

const { lua, lauxlib, lualib, to_luastring } = fengari;
const read = (file: string): string => readFileSync(join(import.meta.dirname, "..", file), "utf8");

// The harness loads the manifest in order, so a misordered file fails every addon test.
const manifest = read("ScallopAlfred.toc").split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith("#"));

test("Bindings.xml stays out of the TOC", () => {
  assert.ok(!manifest.some(file => file.toLowerCase() === "bindings.xml"));
});

// Runs the real addon files against the WoW API stand-ins in fixtures/wow.lua.
function addon() {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const execute = (source: string): void => {
    const code = lauxlib.luaL_dostring(state, to_luastring(source));
    assert.equal(code, lua.LUA_OK, code === lua.LUA_OK ? undefined : lua.lua_tojsstring(state, -1) ?? undefined);
  };
  const value = (name: string): string | null => {
    lua.lua_getglobal(state, name);
    const result = lua.lua_tojsstring(state, -1);
    lua.lua_pop(state, 1);
    return result;
  };
  execute(read("tests/fixtures/wow.lua"));
  execute("addon = {}");
  for (const file of manifest) execute(`local function loadAddon(...) ${read(file)}\nend; loadAddon("ScallopAlfred", addon)`);
  const binding = read("Bindings.xml").match(/<Binding\s[^>]*>([\s\S]*?)<\/Binding>/)?.[1];
  execute(`function runAskBinding(keyState) local keystate = keyState; ${binding} end`);
  return {
    execute,
    value,
    payload(): WoWRequest {
      const request = parseRequest(value("copied") ?? "");
      assert.ok(request, "The addon copied no request");
      return request;
    },
  };
}

test("addon exports valid JSON, both ring slots, and no restricted tooltip values", () => {
  const game = addon();
  game.execute('itemQuality = 4; ScallopAlfred_Ask(); caption = widgets[1].text; choose("What\'s this for?")');
  assert.equal(game.value("caption"), '|cffa335eeRing "of" stars|r');
  const request = game.payload();
  assert.equal(request.subjects[0].name, 'Ring "of" stars');
  assert.equal(request.subjects[0].type, "item");
  assert.equal(request.subjects[0].quality, 4);
  assert.equal(request.player.spec, "Restoration");
  assert.equal(request.subjects[0].tooltip.length, 3);
  assert.ok(request.subjects[0].tooltip[0].includes("\n"));
  assert.equal(request.subjects[0].tooltip[2], "Green text");
  assert.deepEqual(request.equipped?.map(item => item.link), ["item:11", "item:12"]);
});

test("profession snapshots include sparse slots and displayed specialisation ranks", () => {
  const game = addon();
  game.execute(`
    function GetProfessions() return 1, nil, nil, 4 end
    function GetProfessionInfo(index)
      if index == 4 then return "Fishing", nil, 30, 100, nil, nil, 356, 5, nil, nil, "Midnight Fishing" end
      return "Alchemy", nil, 75, 100, nil, nil, 171, 6, nil, nil, "Midnight Alchemy"
    end
    C_TradeSkillUI = {
      GetAllProfessionTradeSkillLines = function() return { 999, 2906 } end,
      GetProfessionInfoBySkillLineID = function(id)
        professionReads = (professionReads or 0) + 1
        return { parentProfessionID = 171, professionName = id == 999 and "Khaz Algar Alchemy" or "Midnight Alchemy" }
      end,
    }
    C_ProfSpecs = {
      GetConfigIDForSkillLine = function(id) assert(id == 2906); return 42 end,
      GetCurrencyInfoForSkillLine = function() return { numAvailable = 7 } end,
      GetSpecTabIDsForSkillLine = function() return { 100 } end,
      GetRootPathForTab = function() return 10 end,
      GetChildrenForPath = function(id) return id == 10 and { 11, 12 } or {} end,
      GetUnlockEntryForPath = function(id) return id + 100 end,
    }
    C_Traits = {
      ConfigHasStagedChanges = function() return true end,
      GetNodeInfo = function(_, id)
        return { currentRank = id == 10 and 21 or 0, maxRanks = 41 }
      end,
      GetEntryInfo = function(_, id) return { maxRanks = 1, definitionID = id } end,
      GetDefinitionInfo = function(id) return { overrideName = "Path " .. id } end,
    }
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("Where should I put my next profession points?"); focused.scripts.OnEnterPressed()
    assert(professionReads == 2)
  `);
  const request = game.payload();
  const snapshot = request.professions;
  assert.equal(snapshot?.capturedAt, 1800000000);
  assert.equal(snapshot?.entries.length, 2);
  const alchemy = snapshot?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(alchemy?.skillLevel, 75);
  assert.equal(alchemy?.maxSkillLevel, 100);
  assert.equal(alchemy?.skillModifier, 6);
  assert.equal(alchemy?.skillLineName, "Midnight Alchemy");
  assert.equal(alchemy?.specialization?.skillLineID, 2906);
  assert.equal(alchemy?.specialization?.unspentKnowledge, 7);
  assert.equal(alchemy?.specialization?.hasStagedChanges, true);
  assert.deepEqual(alchemy?.specialization?.paths, [
    { id: 10, name: "Path 110", rank: 20, maxRank: 40 },
    { id: 11, parentID: 10, name: "Path 111", rank: 0, maxRank: 40 },
    { id: 12, parentID: 10, name: "Path 112", rank: 0, maxRank: 40 },
  ]);
  const prompt = buildPrompt(request);
  assert.deepEqual(JSON.parse(prompt.slice(prompt.lastIndexOf("\n{") + 1)).professions, snapshot);

  game.execute(`
    professionReads, specializationReads, childLineReads = 0, 0, 0
    local getLines = C_TradeSkillUI.GetAllProfessionTradeSkillLines
    C_TradeSkillUI.GetAllProfessionTradeSkillLines = function()
      childLineReads = childLineReads + 1; return getLines()
    end
    local getConfig = C_ProfSpecs.GetConfigIDForSkillLine
    C_ProfSpecs.GetConfigIDForSkillLine = function(id)
      specializationReads = specializationReads + 1; return getConfig(id)
    end
  `);
  const skillsOnly = snapshot?.entries.map(({ specialization: _, ...skills }) => skills);
  for (const action of ["Game mechanics", "My gear", "What's this for?", "Is it an upgrade?", "Keep, sell or disenchant?", "Where does it drop?", "Custom question"]) {
    const topic = action === "Game mechanics" || action === "My gear";
    game.execute(`
      tooltipHidden = ${topic}; ScallopAlfred_Ask(); choose("${action}")
      ${topic || action === "Custom question" ? 'focused:SetText("A question"); focused.scripts.OnEnterPressed()' : ""}
      assert(professionReads == 0 and specializationReads == 0 and childLineReads == 0)
    `);
    assert.deepEqual(game.payload().professions?.entries, skillsOnly);
  }

  game.execute(`
    C_ProfSpecs.GetCurrencyInfoForSkillLine = function() return { numAvailable = secret } end
    C_Traits.GetNodeInfo = function() return nil end
    C_Traits.ConfigHasStagedChanges = function() return secret end
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("My points?"); focused.scripts.OnEnterPressed()
  `);
  const partial = game.payload().professions?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(partial?.specialization?.unspentKnowledge, undefined);
  assert.equal(partial?.specialization?.hasStagedChanges, undefined);
  assert.deepEqual(partial?.specialization?.paths, []);

  game.execute(`
    C_ProfSpecs.GetConfigIDForSkillLine = function() error("Not loaded") end
    ScallopAlfred_Ask(); choose("Professions")
    focused:SetText("My points?"); focused.scripts.OnEnterPressed()
  `);
  const unavailable = game.payload().professions?.entries.find(entry => entry.skillLineID === 171);
  assert.equal(unavailable?.skillLevel, 75);
  assert.equal(unavailable?.specialization, undefined);
});

test("secret profession skill values are omitted", () => {
  const game = addon();
  game.execute(`
    function GetProfessions() return nil, 2 end
    function GetProfessionInfo() return "Mining", nil, secret, 100, nil, nil, 186, 0, nil, nil, "Midnight Mining" end
    ScallopAlfred_Ask(); choose("What's this for?")
  `);
  assert.equal(game.payload().professions?.entries[0].skillLevel, undefined);
  assert.equal(game.payload().professions?.entries[0].maxSkillLevel, 100);
});

test("copy shortcuts close only the JSON box after either key is released", () => {
  for (const mac of [false, true]) {
    for (const releaseModifierFirst of [false, true]) {
      const game = addon();
      const modifier = mac ? "metaDown" : "controlDown";
      game.execute(`
        mac = ${mac}
        ScallopAlfred_Ask(); choose("Custom question")
        local edit = focused
        ${modifier} = true
        edit.scripts.OnKeyUp(edit, "C")
        assert(ScallopAlfredDialog:IsVisible())
        edit:SetText("What is this for?"); edit.scripts.OnEnterPressed()
        ${modifier} = false
        edit.scripts.OnKeyUp(edit, "C")
        assert(ScallopAlfredDialog:IsVisible())
        ${modifier} = true
        edit.scripts.OnKeyUp(edit, "V")
        assert(ScallopAlfredDialog:IsVisible())
        local payload = edit:GetText()
        cDown = true
        assert(ScallopAlfredDialog:IsVisible() and focused == edit)
        ${releaseModifierFirst ? `${modifier} = false` : "cDown = false"}
        edit.scripts.OnKeyUp(edit, "${releaseModifierFirst ? (mac ? "LMETA" : "LCTRL") : "C"}")
        assert(not ScallopAlfredDialog:IsVisible() and focused == nil)
        assert(edit:GetText() == payload)
      `);
      assert.equal(game.payload().question, "What is this for?");
    }
  }
});

test("new questions receive fresh contexts and IDs", () => {
  const game = addon();
  game.execute('ScallopAlfred_Ask(); choose("Is it an upgrade?")');
  const first = game.payload();
  game.execute('ScallopAlfred_Ask(); choose("Is it an upgrade?")');
  assert.notEqual(game.payload().context, first.context);
  assert.notEqual(game.payload().id, first.id);
  assert.equal(game.payload().thread, "new");
});

test("item questions include TSM prices from the original item variant", () => {
  const game = addon();
  game.execute(`
    local link = "item:123::::::::90:::::::::1:456:"
    tooltipInfo = { getterName = "GetHyperlink", getterArgs = { link } }
    prices = { DBMinBuyout = 120000, DBRegionMarketAvg = 150000, DBRegionSaleAvg = 135000, DBRegionSaleRate = 0.025, VendorSell = 250 }
    TSM_API = {
      ToItemString = function(value) assert(value == link); return "i:123::i456" end,
      GetCustomPriceValue = function(source, item) assert(item == "i:123::i456"); return prices[source] end,
    }
    ScallopAlfred_Ask(); choose("Keep, sell or disenchant?")
  `);
  assert.deepEqual(game.payload().subjects[0].tsm, {
    capturedAt: 1800000000, minBuyoutCopper: 120000, regionMarketAvgCopper: 150000,
    regionSaleAvgCopper: 135000, saleRate: 0.025, vendorSellCopper: 250,
  });
  assert.ok(game.payload().equipped?.every(item => item.tsm === undefined));
  game.execute('prices.DBMinBuyout = 110000; ScallopAlfred_Ask(); choose("What\'s this for?")');
  assert.equal(game.payload().subjects[0].tsm?.minBuyoutCopper, 110000);
});

test("unavailable or invalid TSM sources never prevent copying", () => {
  const game = addon();
  for (const value of ["nil", "secret", '"unknown"', "0/0", "math.huge", "-1", "1e20", 'error("Not ready")']) {
    game.execute(`
      TSM_API = {
        ToItemString = function() return "i:123" end,
        GetCustomPriceValue = function(source)
          if source == "VendorSell" then return 250 end
          return ${value}
        end,
      }
      ScallopAlfred_Ask(); choose("Keep, sell or disenchant?")
    `);
    assert.deepEqual(game.payload().subjects[0].tsm, { capturedAt: 1800000000, vendorSellCopper: 250 });
  }
  for (const setup of [
    "TSM_API = nil", "TSM_API = {}",
    "TSM_API.ToItemString = function() return nil end; TSM_API.GetCustomPriceValue = function() return 1 end",
    'TSM_API.ToItemString = function() error("Not ready") end',
    "TSM_API.ToItemString = function() return secret end",
    'TSM_API.ToItemString = function() return "i:123" end; TSM_API.GetCustomPriceValue = function() return nil end',
    'TSM_API.GetCustomPriceValue = function(source) if source == "DBRegionSaleRate" then return 2 end end',
  ]) {
    game.execute(`${setup}; ScallopAlfred_Ask(); choose("Keep, sell or disenchant?")`);
    assert.equal(game.payload().subjects[0].tsm, undefined);
  }
});

test("TSM prices both hovered and explicit items and skips other subject types", () => {
  const game = addon();
  game.execute(`
    TSM_API = {
      ToItemString = function(link) assert(link == "item:123" or link == "item:999"); return "i:" .. link:match("%d+") end,
      GetCustomPriceValue = function(source) if source == "DBMinBuyout" then return 50000 end end,
    }
    ScallopAlfred_Ask(); choose("Custom question")
    ChatFrameUtil.InsertLink("|Hitem:999|h[Another item]|h")
    ChatFrameUtil.InsertLink("|Hquest:123|h[Quest]|h")
    ChatFrameUtil.InsertLink("|Hspell:774|h[Spell]|h")
    focused.scripts.OnEnterPressed()
  `);
  const subjects = game.payload().subjects;
  assert.deepEqual(subjects.map(subject => subject.link), ["item:123", "item:999", "quest:123", "spell:774"]);
  assert.deepEqual(subjects[0].tsm, { capturedAt: 1800000000, minBuyoutCopper: 50000 });
  assert.deepEqual(subjects[1].tsm, subjects[0].tsm);
  assert.ok(subjects.slice(2).every(subject => subject.tsm === undefined));
});

test("without a hovered tooltip, a custom question has no subject or topic", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Custom question")
    caption = widgets[1].text
    focused:SetText("What happened to the scallops?"); focused.scripts.OnEnterPressed()
  `);
  assert.equal(game.value("caption"), "Ask Scallop Alfred about World of Warcraft");
  const request = game.payload();
  assert.equal(request.question, "What happened to the scallops?");
  assert.equal(request.category, undefined);
  assert.deepEqual(request.subjects, []);
});

test("a general question needs no hovered item, and combat leaves the payload unchanged", () => {
  const game = addon();
  game.execute('noItem = true; ScallopAlfred_Ask(); choose("Game mechanics"); focused:SetText("Where should I go?"); focused.scripts.OnEnterPressed()');
  assert.deepEqual(game.payload().subjects, []);
  const before = game.value("copied");
  game.execute("combat = true; ScallopAlfred_Ask()");
  assert.equal(game.value("copied"), before);
  assert.match(game.value("notice") ?? "", /after combat/);
});

test("topic menus defer snapshots until submission and gear captures only equipped slots", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    professionReads, inventoryReads, talentReads = 0, 0, 0
    function GetProfessions() professionReads = professionReads + 1 end
    function GetProfessionInfo() end
    function GetInventoryItemLink(_, slot)
      inventoryReads = inventoryReads + 1
      if slot == 2 then return nil end
      if slot == 3 then return secret end
      return "item:" .. slot
    end
    C_ClassTalents = { GetActiveConfigID = function() talentReads = talentReads + 1; return 42 end }
    C_Traits = {
      GetConfigInfo = function() return { treeIDs = { 1, 2 } } end,
      GenerateImportString = function() return "BuildExport" end,
      ConfigHasStagedChanges = function() return false end,
      GetTreeNodes = function() return { 10, 11, 12 } end,
      GetNodeInfo = function(_, id)
        return { activeRank = id == 11 and 0 or 1, activeEntry = { entryID = id } }
      end,
      GetEntryInfo = function(_, id) return { definitionID = id } end,
      GetDefinitionInfo = function(id) return { spellID = id * 10 } end,
    }
    C_Spell.GetSpellName = function(id) return "Talent " .. id end
    for _, topic in ipairs({ "Game mechanics", "Professions", "My gear" }) do
      ScallopAlfred_Ask()
      assert(focused == nil)
      choose(topic)
      assert(focused:GetText() == "")
      assert(professionReads == 0 and inventoryReads == 0 and talentReads == 0)
    end
    focused:SetText("What should I upgrade next?")
    combat = true; focused.scripts.OnEnterPressed()
    assert(professionReads == 0 and inventoryReads == 0 and talentReads == 0)
    combat = false; focused.scripts.OnEnterPressed()
    assert(professionReads == 1 and inventoryReads == 19 and talentReads == 1, professionReads .. "," .. inventoryReads .. "," .. talentReads)
  `);
  const request = game.payload();
  assert.equal(request.category, "gear");
  assert.deepEqual(request.subjects, []);
  assert.equal(request.equipped?.length, 17);
  assert.deepEqual(request.equipped?.map(item => item.slot), Array.from({ length: 19 }, (_, i) => i + 1).filter(slot => slot !== 2 && slot !== 3));
  assert.deepEqual(request.talents, {
    capturedAt: 1800000000, exportString: "BuildExport", hasStagedChanges: false,
    selected: [{ spellID: 100, name: "Talent 100", rank: 1 }, { spellID: 120, name: "Talent 120", rank: 1 }],
  });
  game.execute(`
    inventoryReads, talentReads = 0, 0
    tooltipHidden = false; ScallopAlfred_Ask(); choose("Is it an upgrade?")
    assert(inventoryReads == 19 and talentReads == 1)
  `);
  const upgrade = game.payload();
  assert.equal(upgrade.category, "gear");
  assert.equal(upgrade.subjects[0].link, "item:123");
  assert.deepEqual(upgrade.equipped, request.equipped);
  assert.deepEqual(upgrade.talents, request.talents);
  game.execute(`
    inventoryReads, talentReads = 0, 0
    tooltipHidden = true; ScallopAlfred_Ask(); choose("Game mechanics")
    focused:SetText("Explain the seasonal system"); focused.scripts.OnEnterPressed()
    assert(inventoryReads == 0 and talentReads == 0)
    tooltipHidden = false; ScallopAlfred_Ask(); choose("What's this for?")
  `);
  assert.equal(game.payload().category, undefined);
  assert.equal(game.payload().talents, undefined);
  assert.deepEqual(game.payload().equipped?.map(item => item.slot), [11, 12]);
});

test("talent scans are bounded and unavailable or restricted talents stay optional", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    C_ClassTalents = { GetActiveConfigID = function() return 42 end }
    nodeReads = 0
    C_Traits = {
      GetConfigInfo = function() return { treeIDs = { 1 } } end,
      GenerateImportString = function() return secret end,
      GetTreeNodes = function() local nodes = {}; for i = 1, 1000 do nodes[i] = i end; return nodes end,
      GetNodeInfo = function() nodeReads = nodeReads + 1; return { activeRank = secret } end,
    }
    ScallopAlfred_Ask(); choose("My gear")
    focused:SetText("My build?"); focused.scripts.OnEnterPressed()
    assert(nodeReads == 256)
  `);
  assert.deepEqual(game.payload().talents?.selected, []);
  assert.equal(game.payload().talents?.exportString, undefined);
  game.execute(`
    C_ClassTalents.GetActiveConfigID = function() error("Not loaded") end
    ScallopAlfred_Ask(); choose("My gear")
    focused:SetText("My gear?"); focused.scripts.OnEnterPressed()
  `);
  assert.equal(game.payload().talents, undefined);
  assert.equal(game.payload().equipped?.length, 19);
});

test("the default keybind never replaces an existing binding", () => {
  const game = addon();
  game.execute('existingBinding = "OTHER_ACTION"; frames[#frames].scripts.OnEvent()');
  assert.equal(game.value("bound"), null);
  game.execute('existingBinding = ""; frames[#frames].scripts.OnEvent()');
  assert.equal(game.value("bound"), "ALT-Q:SCALLOPALFRED_ASK");
});

test("the ask binding opens the topic menu on key release, then an empty editor", () => {
  const game = addon();
  assert.match(read("Bindings.xml"), /runOnUp="true"/);
  game.execute(`
    noItem = true
    runAskBinding("down")
    assert(focused == nil)
    if focused then focused:SetText((focused.text or "") .. "q") end
    runAskBinding("up")
    assert(focused == nil)
    choose("Game mechanics")
    assert(focused ~= nil)
    caption = widgets[1].text
  `);
  assert.equal(game.value("copied"), "");
  assert.equal(game.value("caption"), "Game mechanics");
  game.execute('focused:SetText("quest rewards"); focused.scripts.OnEnterPressed()');
  assert.equal(game.payload().question, "quest rewards");
});

test("hovered spells use their link and exclude equipment actions", () => {
  const game = addon();
  game.execute(`
    noItem = true; spellID = 774
    C_Item.GetItemInfoInstant = function() error("Spells have no equipment slot") end
    ScallopAlfred_Ask()
    assert(not pcall(choose, "Is it an upgrade?"))
    choose("How does this spell work?")
  `);
  assert.equal(game.payload().subjects[0].type, "spell");
  assert.equal(game.payload().subjects[0].name, "Rejuvenation");
  assert.equal(game.payload().subjects[0].link, "spell:774");
  assert.equal(game.payload().question, "How does this spell work?");
  assert.deepEqual(game.payload().equipped, []);
});

test("hovered quests, currencies and achievements retain their ID, name and tooltip", () => {
  for (const [kind, enumName, question, caption] of [
    ["quest", "Quest", "How do I complete this quest?", "|A:QuestNormal:16:16|a |cffffd100Example|r"],
    ["currency", "Currency", "How do I earn and spend this currency?", "Example"],
    ["achievement", "Achievement", "How do I earn this achievement?", "Example"],
  ]) {
    const game = addon();
    game.execute(`
      noItem = true
      tooltipData = { type = Enum.TooltipDataType.${enumName}, id = 123, lines = { { leftText = "Example" }, { leftText = "Details" } } }
      ScallopAlfred_Ask(); caption = widgets[1].text; choose("${question}")
    `);
    assert.equal(game.value("caption"), caption);
    assert.deepEqual(game.payload().subjects, [{ type: kind, name: "Example", link: `${kind}:123`, tooltip: ["Example", "Details"] }]);
    assert.deepEqual(game.payload().equipped, []);
  }
});

test("a targeted NPC adds a question about it to the topic menu", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true
    targetGUID = "Creature-0-1234-2552-12-219013-000ABCDEF0"; targetName = "Grumbles"
    ScallopAlfred_Ask(); choose("What should I know about my target?")
  `);
  const request = game.payload();
  assert.equal(request.question, "What should I know about my target?");
  assert.deepEqual(request.subjects, [{ type: "npc", name: "Grumbles", link: "npc:219013", tooltip: ["Grumbles", "Level 80 Elite"] }]);
  game.execute(`
    -- The topics stay available alongside it.
    ScallopAlfred_Ask(); choose("Game mechanics")
    -- A hovered subject takes over the menu.
    tooltipHidden = false; ScallopAlfred_Ask()
    assert(not pcall(choose, "What should I know about my target?"))
    -- Players and restricted GUIDs are not NPCs.
    tooltipHidden = true
    for _, guid in ipairs({ "Player-1234-0ABCDEF0", secret }) do
      targetGUID = guid; ScallopAlfred_Ask()
      assert(not pcall(choose, "What should I know about my target?"))
    end
  `);
});

test("restricted targets explain how to ask manually without exporting their identity", () => {
  const game = addon();
  game.execute(`
    tooltipHidden = true; targetGUID = secret; targetName = secret
    ScallopAlfred_Ask(); hintText = widgets[2].text
    assert(not pcall(choose, "What should I know about my target?"))
    choose("Custom question")
    focused:SetText("What should I know about Grumbles in this delve?")
    focused.scripts.OnEnterPressed()
  `);
  assert.match(game.value("hintText") ?? "", /WoW hides this target/);
  assert.deepEqual(game.payload().subjects, []);
  assert.equal(game.payload().question, "What should I know about Grumbles in this delve?");
  game.execute(`
    tooltipHidden = false
    ScallopAlfred_Ask(); hintText = widgets[2].text
  `);
  assert.equal(game.value("hintText"), "Choose a question, then copy the request.");
  game.execute(`
    tooltipHidden = true; targetGUID = nil; targetName = nil
    ScallopAlfred_Ask(); hintText = widgets[2].text
  `);
  assert.equal(game.value("hintText"), "Choose a topic or ask your own question.");
});

test("hovered quest log entries use the quest ID on the tooltip's owner", () => {
  const game = addon();
  game.execute(`
    noItem = true
    tooltipOwner = { questID = 456 }
    ScallopAlfred_Ask(); caption = widgets[1].text; choose("How do I complete this quest?")
  `);
  assert.equal(game.value("caption"), "|A:QuestNormal:16:16|a |cffffd100Quest 456|r");
  const [subject] = game.payload().subjects;
  assert.deepEqual({ type: subject.type, name: subject.name, link: subject.link }, { type: "quest", name: "Quest 456", link: "quest:456" });
  assert.ok(subject.tooltip.length > 0);
  // A restricted quest ID leaves no subject, so the topic menu opens instead.
  game.execute('tooltipOwner = { questID = secret }; ScallopAlfred_Ask(); choose("Game mechanics")');
});

test("hovered hyperlinks preserve parameters and ignore stale hidden tooltips", () => {
  const game = addon();
  game.execute(`
    tooltipInfo = { getterName = "GetHyperlink", getterArgs = { "|Hbattlepet:123:25:3|h[Pet]|h" } }
    ScallopAlfred_Ask(); choose("Tell me about this.")
  `);
  assert.equal(game.payload().subjects[0].link, "battlepet:123:25:3");
  assert.equal(game.payload().subjects[0].name, "Pet");
  game.execute('tooltipHidden = true; ScallopAlfred_Ask(); choose("Game mechanics"); focused:SetText("General question"); focused.scripts.OnEnterPressed()');
  assert.deepEqual(game.payload().subjects, []);
});

test("Shift-click accepts multiple link types and keeps links without tooltip data", () => {
  const game = addon();
  game.execute(`
    noItem = true; ScallopAlfred_Ask(); choose("Game mechanics")
    C_TooltipInfo.GetHyperlink = function() error("Unsupported tooltip") end
    focused:SetText("Explain ")
    ChatFrameUtil.InsertLink("|Hspell:774|h[Rejuvenation]|h")
    ChatFrameUtil.InsertLink("|Hquest:123:90|h[A quest]|h")
    ChatFrameUtil.InsertLink("|Hachievement:456:Player:1|h[An achievement]|h")
    ChatFrameUtil.InsertLink("|Hspell:774|h[Rejuvenation]|h")
    focused.scripts.OnEnterPressed()
  `);
  const request = game.payload();
  assert.deepEqual(request.subjects.map(({ type, name, tooltip }) => ({ type, name, tooltip })), [
    { type: "spell", name: "Rejuvenation", tooltip: [] },
    { type: "quest", name: "A quest", tooltip: [] },
    { type: "achievement", name: "An achievement", tooltip: [] },
  ]);
  assert.match(request.question, /^Explain \|Hspell/);
  game.execute('ChatFrameUtil.InsertLink("|Hitem:999|h[Unrelated]|h")');
  assert.deepEqual(game.payload(), request);
});

test("explicit links retain the hovered subject and deduplicate identical links", () => {
  const game = addon();
  game.execute(`
    ScallopAlfred_Ask(); choose("Custom question")
    ChatFrameUtil.InsertLink("|Hitem:123|h[Same ring]|h")
    ChatFrameUtil.InsertLink("|Hspell:774|h[Rejuvenation]|h")
    ChatFrameUtil.InsertLink("|Hitem:123:variant|h[Another variant]|h")
    ChatFrameUtil.InsertLink("|Hspell:774|h[Rejuvenation]|h")
    focused.scripts.OnEnterPressed()
  `);
  const first = game.payload();
  assert.deepEqual(first.subjects.map(subject => subject.link), ["item:123", "spell:774", "item:123:variant"]);
  assert.equal(first.subjects[0].name, 'Ring "of" stars');
  assert.deepEqual(first.equipped?.map(item => item.slot), [11, 12]);
});

test("the eight-subject limit includes the hover without counting duplicates", () => {
  const game = addon();
  game.execute(`
    ScallopAlfred_Ask(); choose("Custom question")
    question = "Compare |Hitem:123|h[Same ring]|h"
    for id = 1, 7 do question = question .. " |Hitem:" .. id .. "|h[Item]|h" end
    focused:SetText(question); focused.scripts.OnEnterPressed()
  `);
  assert.equal(game.payload().subjects.length, 8);
  game.execute(`
    ScallopAlfred_Ask(); choose("Custom question")
    focused:SetText(question .. " |Hitem:8|h[One too many]|h")
    local before = focused:GetText()
    focused.scripts.OnEnterPressed()
    assert(focused:GetText() == before)
  `);
  assert.match(game.value("notice") ?? "", /eight subjects/);
  game.execute('focused:SetText("Compare |Hitem:123|h[Same ring]|h"); focused.scripts.OnEnterPressed()');
  assert.equal(game.payload().subjects.length, 1);
});

test("/q copies a follow-up from the chat line with its links, ignoring the hovered tooltip", () => {
  const game = addon();
  assert.equal(game.value("SLASH_SCALLOPALFRED1"), "/q");
  game.execute('SlashCmdList.SCALLOPALFRED("Is |Hitem:999|h[Another item]|h better?")');
  const request = game.payload();
  assert.equal(request.thread, "followup");
  assert.equal(request.question, "Is |Hitem:999|h[Another item]|h better?");
  assert.deepEqual(request.subjects.map(subject => subject.link), ["item:999"]);

  game.execute('SlashCmdList.SCALLOPALFRED("   ")');
  assert.match(game.value("notice") ?? "", /follow-up after \/q/);
  game.execute('combat = true; SlashCmdList.SCALLOPALFRED("Another question")');
  assert.match(game.value("notice") ?? "", /after combat/);
  assert.deepEqual(game.payload(), request);
});

test("restricted hover values and combat link insertion are omitted", () => {
  const game = addon();
  game.execute(`
    noItem = true; spellID = secret
    tooltipData = { type = Enum.TooltipDataType.Quest, id = secret }
    ScallopAlfred_Ask(); choose("Game mechanics")
    ChatFrameUtil.InsertLink(secret)
    combat = true
    ChatFrameUtil.InsertLink("|Hquest:123|h[Quest]|h")
    assert(focused:GetText() == "")
    combat = false
    focused:SetText("General question"); focused.scripts.OnEnterPressed()
  `);
  assert.deepEqual(game.payload().subjects, []);
});
