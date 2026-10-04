#!/usr/bin/env node
/**
 * Тест логики скрипта scripts/main.js без запуска Mindustry.
 *
 * Скрипт мода — обычный JavaScript, поэтому его можно прогнать в Node на
 * mock-объектах Mindustry/Arc/Rhino. Проверяем:
 *   • загрузку скрипта и регистрацию команд;
 *   • общую паузу (серверную часть, кулдаун, объявление в чат);
 *   • снятие правила pauseDisabled;
 *   • клиентские фасады карты планеты и исследований, режим просмотра;
 *   • кнопки меню паузы, горячую клавишу и блокировку действий карты.
 *
 * Запуск:  node tools/test_coop.js
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
let checks = 0;

function ok(condition, label){
    checks++;
    if(condition){
        console.log("  ok   " + label);
    }else{
        failures++;
        console.log("  FAIL " + label);
    }
}

function section(title){
    console.log("\n== " + title + " ==");
}

// ----------------------------- моки Mindustry ------------------------------

function makeCell(record){
    const cell = {
        colspan(n){ record.colspan = n; return cell; },
        width(){ return cell; },
        height(){ return cell; },
        pad(){ return cell; },
        disabled(){ return cell; },
        visible(){ return cell; }
    };
    return cell;
}

function makeTable(record){
    return {
        row(){ record.rows++; },
        button(){
            const label = arguments[0];
            const action = arguments[arguments.length - 1];
            const entry = {label: label, action: action};
            record.buttons.push(entry);
            return makeCell(entry);
        },
        clear(){ record.buttons.length = 0; },
        update(){},
        defaults(){ return madeDefaults; },
        getChildren(){ return {size: 0, get(){ return null; }}; }
    };
}

const madeDefaults = {width(){ return madeDefaults; }, height(){ return madeDefaults; }, size(){ return madeDefaults; }, pad(){ return madeDefaults; }};

function makeClass(declaredMethods, declaredFields){
    return {
        getDeclaredMethod(name){
            if(declaredMethods.indexOf(name) >= 0){
                return {name: name};
            }
            const err = new Error("NoSuchMethodException: " + name);
            err.name = "NoSuchMethodException";
            throw err;
        },
        getDeclaredField(name){
            if(declaredFields && declaredFields.indexOf(name) >= 0){
                return {name: name};
            }
            const err = new Error("NoSuchFieldException: " + name);
            err.name = "NoSuchFieldException";
            err.javaName = "java.lang.NoSuchFieldException";
            throw err;
        }
    };
}

function makeField(store, name){
    return {
        name: name,
        setAccessible(){ return this; },
        getBoolean(){ return store[name] === true; },
        setBoolean(_obj, value){ store[name] = value === true; return this; }
    };
}

/**
 * Мир: состояние игры, сеть, интерфейс. opts:
 *   role: "host" | "client" | "single" | "server"
 *   campaign: bool
 *   mobile: bool
 *   researchDeclaresShow: bool   — старая версия ResearchDialog (с проверкой)
 *   hasCampaignRulesDialog: bool
 */
function makeWorld(opts){
    const options = Object.assign({
        role: "host",
        campaign: true,
        mobile: false,
        researchDeclaresShow: false,
        hasCampaignRulesDialog: true
    }, opts || {});

    const world = {
        log: [],
        warnings: [],
        commands: {},
        registeredCommandOrder: [],
        broadcasts: [],
        chatSends: [],
        rulesBroadcasts: [],
        infoMessages: [],
        toasts: [],
        playerMessages: [],
        netFields: {server: options.role === "host" || options.role === "server"},
        netFlagDuringShow: null,
        state: {
            paused: false,
            rules: {pauseDisabled: false},
            setCalls: []
        }
    };

    const stateObj = {
        isGame: () => true,
        isCampaign: () => options.campaign,
        isMenu: () => false,
        isPaused(){ return world.state.paused; },
        set(value){ world.state.setCalls.push(value); world.state.paused = (value === "paused"); },
        rules: world.state.rules
    };

    const net = {
        active: () => options.role !== "single",
        server: () => options.role === "host" || options.role === "server",
        client: () => options.role === "client",
        getClass: () => makeClass([], ["server"])
    };

    // Поле Net.server ведёт себя как приватное поле настоящего класса.
    const originalGetField = net.getClass;
    net.getClass = () => ({
        getDeclaredField(name){
            if(name === "server") return makeField(world.netFields, "server");
            throw new Error("NoSuchFieldException: " + name);
        }
    });

    const ui = {
        showInfo: (text) => world.infoMessages.push(text),
        showInfoFade: (text) => world.toasts.push(String(text).slice(0, 60)),
        showText: () => {},
        paused: null,
        planet: null,
        research: null,
        campaignRules: null
    };

    function makeDialog(name, declaredShow){
        const shownListeners = [];
        const dialog = {
            name: name,
            shownNow: false,
            showCalls: 0,
            hideCalls: 0,
            shown(fn){ shownListeners.push(fn); },
            hidden(){},
            isShown(){ return this.shownNow; },
            show(){
                this.showCalls++;
                // если скрипт подставил флаг «я сервер», фиксируем это
                if(world.netFields.server === true && options.role === "client"){
                    world.netFlagDuringShow = true;
                }
                if(declaredShow && options.role === "client" && world.netFields.server !== true){
                    // ванильная проверка: клиенту окно не открывается
                    return this;
                }
                this.shownNow = true;
                return this;
            },
            hide(){ this.hideCalls++; this.shownNow = false; },
            toggle(){ if(this.isShown()) this.hide(); else this.show(); },
            getClass: () => makeClass(declaredShow ? ["show"] : [], []),
            __shownListeners: shownListeners
        };
        return dialog;
    }

    const planetRecord = {rows: 0, buttons: []};
    const realPlanet = makeDialog("PlanetDialog", true);
    realPlanet.state = {planet: "serpulo"};
    realPlanet.cont = null;
    realPlanet.sectorTop = makeSectorTop();
    realPlanet.__tableRecord = planetRecord;

    function makeSectorTop(){
        const record = {buttons: []};
        const top = {
            touchable: "childrenOnly",
            record: record,
            __isButton: false,
            setDisabled(){ this.disabled = true; },
            getChildren(){ return {size: 1, get: () => ({setDisabled: function(){ this.disabledByChildSweep = true; }} )}; }
        };
        return top;
    }

    const realResearch = makeDialog("ResearchDialog", options.researchDeclaresShow);
    const realCampaignRules = options.hasCampaignRulesDialog ? makeDialog("CampaignRulesDialog", true) : null;

    const pausedRecord = {rows: 0, buttons: []};
    const pausedDialog = makeDialog("PausedDialog", false);
    pausedDialog.cont = makeTable(pausedRecord);
    pausedDialog.__tableRecord = pausedRecord;

    ui.paused = pausedDialog;
    ui.planet = realPlanet;
    ui.research = realResearch;
    ui.campaignRules = realCampaignRules;

    const handler = {
        commands: world.commands,
        prefix: "/",
        register(){
            const name = arguments[0];
            let fn = null;
            for(let i = 1; i < arguments.length; i++){
                const arg = arguments[i];
                if(typeof arg === "function") fn = (args, player) => arg(args, player);
                else if(arg && typeof arg.accept === "function") fn = (args, player) => arg.accept(args, player);
                else if(arg && typeof arg.get === "function") fn = (args, player) => arg.get(args, player);
            }
            world.registeredCommandOrder.push(name);
            handler.commands[name] = {name: name, runner: fn};
            return {};
        },
        getPrefix(){ return "/"; }
    };

    const sandbox = {
        Packages: null,
        run: (fn) => ({run: fn}),
        cons: (fn) => ({get: fn}),
        extend: (base, def) => {
            const out = Object.assign({}, def);
            out.__base = base;
            return out;
        },
        JavaAdapter: (cls, def) => Object.assign({}, def),
        Log: {
            info: (msg) => world.log.push(String(msg)),
            warn: (msg) => world.warnings.push(String(msg)),
            err: (msg) => world.warnings.push(String(msg))
        },
        Core: {
            bundle: {get: (key) => key},
            scene: {hasDialog: () => false, hasKeyboard: () => false},
            input: {keyTap: () => world.keyTapped === true}
        },
        Date: Date,
        Math: Math,
        JSON: JSON,
        console: console,
        ClientLoadEvent: "ClientLoadEvent",
        ServerLoadEvent: "ServerLoadEvent",
        WorldLoadEvent: "WorldLoadEvent",
        Trigger: {update: "trigger.update"}
    };

    // ---- Packages: Vars, Call, Icon, GameState.State, Touchable, ... ----
    const Packages = {
        java: {lang: {Runnable: function(){}}},
        arc: {
            util: {
                Log: sandbox.Log,
                Time: {millis: () => world.time},
                CommandHandler: {CommandRunner: function CommandRunner(){}}
            },
            Core: sandbox.Core,
            func: {Cons: function Cons(){}},
            Events: {
                on(cls, listener){ world.events = world.events || {}; (world.events[cls] = world.events[cls] || []).push(listener); },
                run(trigger, listener){ world.ticks = world.ticks || []; world.ticks.push(listener); },
                fire(cls, arg){ (world.events && world.events[cls] || []).forEach(l => l.get ? l.get(arg) : l(arg)); }
            },
            scene: {event: {Touchable: {disabled: "disabled", enabled: "enabled", childrenOnly: "childrenOnly"}}}
        },
        mindustry: {
            Vars: {
                headless: false,
                mobile: options.mobile,
                net: net,
                state: stateObj,
                ui: ui,
                player: options.role === "client" ? {id: 7, admin: false} : {id: 1, admin: true},
                netServer: {clientCommands: handler}
            },
            gen: {
                Call: {
                    sendMessage(text){ world.broadcasts.push(text); },
                    sendChatMessage(text){ world.chatSends.push(text); },
                    setRules(rules){ world.rulesBroadcasts.push(rules); }
                },
                Icon: {pause: "icon.pause", play: "icon.play", tree: "icon.tree", map: "icon.map"}
            },
            core: {GameState: {State: {paused: "paused", playing: "playing"}}},
            input: {Binding: {pause: {value: "space"}}},
            game: {EventType: {
                ClientLoadEvent: "mindustry.game.EventType.ClientLoadEvent",
                ServerLoadEvent: "mindustry.game.EventType.ServerLoadEvent",
                WorldLoadEvent: "mindustry.game.EventType.WorldLoadEvent",
                Trigger: {update: "trigger.update"}
            }},
            ui: {dialogs: {
                PlanetDialog: makeClass(["show"]),
                ResearchDialog: makeClass(options.researchDeclaresShow ? ["show"] : []),
                CampaignRulesDialog: makeClass(["show"])
            }}
        }
    };
    sandbox.Packages = Packages;
    world.sandbox = sandbox;
    world.ui = ui;
    world.realPlanet = realPlanet;
    world.realResearch = realResearch;
    world.realCampaignRules = realCampaignRules;
    world.pausedDialog = pausedDialog;
    world.pausedRecord = pausedRecord;
    world.options = options;
    world.time = 1000000;
    return world;
}

function loadScript(world){
    const src = fs.readFileSync(path.join(__dirname, "..", "scripts", "main.js"), "utf8");
    vm.createContext(world.sandbox);
    vm.runInContext(src, world.sandbox, {filename: "scripts/main.js"});
}

function runListeners(list){
    list.forEach(fn => (typeof fn === "function") ? fn() : fn.run());
}

function tick(world){
    (world.ticks || []).forEach(fn => fn.run ? fn.run() : fn());
}

function fire(world, eventName, arg){
    (world.events && world.events[eventName] || []).forEach(l => l.get ? l.get(arg) : l(arg));
}

function runCommand(world, name, args, player){
    const cmd = world.commands[name];
    if(!cmd || typeof cmd.runner !== "function"){
        throw new Error("команда не зарегистрирована: " + name);
    }
    cmd.runner(args, player);
}

// ================================= тесты ===================================

// --- 1. Загрузка и регистрация команд (хост) --------------------------------
section("загрузка скрипта, хост");
{
    const world = makeWorld({role: "host"});
    loadScript(world);
    ok(world.log.some(l => l.indexOf("кооп-модуль загружен") >= 0), "скрипт загрузился и написал в лог");
    ok(world.warnings.length === 0, "при загрузке нет предупреждений" + (world.warnings.length ? ": " + world.warnings.join("; ") : ""));

    fire(world, "ClientLoadEvent");
    ok(world.registeredCommandOrder.indexOf("mp-pause") >= 0, "команда /mp-pause зарегистрирована");
    ok(world.registeredCommandOrder.indexOf("mp-status") >= 0, "команда /mp-status зарегистрирована");
    ok(world.pausedDialog.__shownListeners.length > 0, "подписка на открытие меню паузы добавлена");
}

// --- 2. Общая пауза на сервере ---------------------------------------------
section("общая пауза (хост и клиент на сервере)");
{
    const world = makeWorld({role: "host"});
    loadScript(world);
    fire(world, "ClientLoadEvent");

    const clientPlayer = {id: 7, admin: false, plainName: () => "Игрок"};

    runCommand(world, "mp-pause", ["toggle"], clientPlayer);
    ok(world.state.paused === true, "клиент поставил игру на паузу");
    ok(world.state.setCalls.length === 1 && world.state.setCalls[0] === "paused", "состояние сервера переключено в paused");
    ok(world.broadcasts.length === 1 && world.broadcasts[0].indexOf("Игрок") >= 0, "в чат сообщили, кто поставил паузу");

    runCommand(world, "mp-pause", ["toggle"], clientPlayer);
    ok(world.state.paused === true, "повторный запрос внутри кулдауна игнорируется");

    world.time += 5000;
    runCommand(world, "mp-pause", [], clientPlayer);
    ok(world.state.paused === false, "пауза снята (аргумент по умолчанию = переключение)");

    world.time += 5000;
    runCommand(world, "mp-pause", ["on"], clientPlayer);
    ok(world.state.paused === true, "явный аргумент on работает");
    world.time += 5000;
    runCommand(world, "mp-pause", ["off"], clientPlayer);
    ok(world.state.paused === false, "явный аргумент off работает");

    // объявление должно быть и при снятии
    ok(world.broadcasts.some(b => b.indexOf("снял паузу") >= 0), "в чат сообщили о снятии паузы");
}

// --- 3. pauseDisabled снимается --------------------------------------------
section("правило pauseDisabled");
{
    const world = makeWorld({role: "host"});
    loadScript(world);
    world.state.rules.pauseDisabled = true;
    fire(world, "WorldLoadEvent");
    ok(world.state.rules.pauseDisabled === false, "флаг pauseDisabled сброшен на сервере");
    ok(world.rulesBroadcasts.length === 1, "правила разосланы клиентам через Call.setRules");
}

// --- 4. Клиент: карта планеты ----------------------------------------------
section("клиент: карта планеты");
{
    const world = makeWorld({role: "client"});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    ok(world.ui.planet !== world.realPlanet, "Vars.ui.planet подменён фасадом");
    ok(world.ui.planet && world.ui.planet.state === world.realPlanet.state, "фасад делится объектом state с настоящим диалогом");

    world.ui.planet.show();
    ok(world.realPlanet.showCalls === 1, "настоящий диалог карты открыт");
    ok(world.netFlagDuringShow === true, "на время открытия подставлялся флаг Net.server");
    ok(world.netFields.server === false, "флаг Net.server возвращён как было");
    ok(world.realPlanet.sectorTop.touchable === "disabled", "панель сектора стала некликабельной");
    ok(world.realPlanet.sectorTop.disabled === true, "кнопки панели сектора погашены");
    ok(world.toasts.length === 1, "игроку показали подсказку про режим просмотра");

    world.ui.planet.showSelect({}, () => {});
    ok(world.infoMessages.some(m => m.indexOf("только хост") >= 0), "запуск ядра с карты у клиента заблокирован");

    world.ui.planet.showPlanetLaunch();
    world.ui.planet.abandonSectorConfirm();
    ok(world.infoMessages.length === 3, "остальные действия карты тоже заблокированы");

    world.ui.planet.toggle();
    ok(world.realPlanet.hideCalls === 1, "повторный toggle закрывает карту");
    world.ui.planet.toggle();
    ok(world.realPlanet.showCalls === 2, "закрытая карта открывается снова");

    ok(world.ui.planet.isShown() === true, "isShown() на фасаде повторяет настоящий диалог");
}

// --- 5. Клиент: смена сложности кампании -----------------------------------
section("клиент: смена сложности кампании");
{
    const world = makeWorld({role: "client"});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    ok(world.ui.campaignRules !== world.realCampaignRules, "окно сложности подменено заглушкой");
    world.ui.campaignRules.show({name: "serpulo"});
    ok(world.infoMessages.some(m => m.indexOf("только хост") >= 0), "правка сложности клиенту запрещена");
    ok(world.realCampaignRules.showCalls === 0, "настоящее окно сложности не открывалось");
}

// --- 6. Клиент: старая версия с проверкой в ResearchDialog -----------------
section("клиент: исследования (старая версия с проверкой)");
{
    const world = makeWorld({role: "client", researchDeclaresShow: true});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    ok(world.ui.research !== world.realResearch, "Vars.ui.research подменён фасадом");
    world.ui.research.show();
    ok(world.realResearch.showCalls === 1, "настоящее окно исследований открыто в обход проверки");
    ok(world.netFlagDuringShow === true, "на время открытия подставлялся флаг Net.server");
    ok(world.netFields.server === false, "флаг Net.server возвращён как было");

    world.ui.research.toggle();
    ok(world.realResearch.hideCalls === 1, "toggle закрывает исследования");
    world.ui.planet.show();
    ok(world.toasts.some(t => t.indexOf("просмотр") >= 0), "подсказка про режим просмотра показана");
}

// --- 7. Клиент: новая версия без проверки в ResearchDialog -----------------
section("клиент: исследования (новая версия, клиентам можно)");
{
    const world = makeWorld({role: "client", researchDeclaresShow: false});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    ok(world.ui.research === world.realResearch, "фасад исследований не нужен и не ставится");
    ok(world.registeredCommandOrder.length > 0, "команды при этом зарегистрированы (локально, безвредно)");
}

// --- 8. Кнопки в меню паузы ------------------------------------------------
section("кнопки меню паузы");
{
    const world = makeWorld({role: "client", campaign: true});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    // имитируем открытие меню паузы
    runListeners(world.pausedDialog.__shownListeners);
    const labels = world.pausedRecord.buttons.map(b => b.label);
    ok(labels.some(l => l === "Пауза для всех"), "кнопка паузы добавлена");
    ok(labels.indexOf("@research") >= 0, "кнопка исследований добавлена");
    ok(labels.indexOf("@planetmap") >= 0, "кнопка карты добавлена");
    ok(world.pausedRecord.rows >= 2, "кнопки разложены по строкам");

    // кнопка паузы должна отправлять команду
    const pauseButton = world.pausedRecord.buttons.find(b => b.label === "Пауза для всех");
    (typeof pauseButton.action === "function") ? pauseButton.action() : pauseButton.action.run();
    ok(world.chatSends.indexOf("/mp-pause") >= 0, "кнопка паузы отправляет /mp-pause");

    // на мобильных кнопки исследований и карты уже есть в ванильном меню
    const mobileWorld = makeWorld({role: "client", campaign: true, mobile: true});
    loadScript(mobileWorld);
    fire(mobileWorld, "ClientLoadEvent");
    tick(mobileWorld);
    runListeners(mobileWorld.pausedDialog.__shownListeners);
    const mobileLabels = mobileWorld.pausedRecord.buttons.map(b => b.label);
    ok(mobileLabels.indexOf("@research") < 0 && mobileLabels.some(l => l === "Пауза для всех"), "на мобильных нет дублей кнопок");

    // в не-кампании (выживание/ПВП) — только кнопка паузы
    const survivalWorld = makeWorld({role: "client", campaign: false});
    loadScript(survivalWorld);
    fire(survivalWorld, "ClientLoadEvent");
    tick(survivalWorld);
    runListeners(survivalWorld.pausedDialog.__shownListeners);
    const survivalLabels = survivalWorld.pausedRecord.buttons.map(b => b.label);
    ok(survivalLabels.indexOf("@research") < 0 && survivalLabels.some(l => l === "Пауза для всех"), "в не-кампании только кнопка паузы");
}

// --- 9. Горячая клавиша у клиента -----------------------------------------
section("горячая клавиша паузы у клиента");
{
    const world = makeWorld({role: "client"});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    world.keyTapped = true;
    tick(world);
    ok(world.chatSends.length === 1, "нажатие клавиши паузы отправляет команду");

    tick(world);
    ok(world.chatSends.length === 1, "кулдаун не даёт спамить сервер");

    world.time += 5000;
    tick(world);
    ok(world.chatSends.length === 2, "после кулдауна клавиша снова работает");
}

// --- 10. Диагностика -------------------------------------------------------
section("команда /mp-status");
{
    const world = makeWorld({role: "client"});
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    const me = {id: 7, admin: false, plainName: () => "Игрок", sendMessage: (t) => world.playerMessages.push(t)};
    runCommand(world, "mp-status", [], me);
    const text = world.playerMessages.join("\n");
    ok(text.indexOf("кооп-модуль v") >= 0, "статус содержит версию модуля");
    ok(text.indexOf("режим: клиент") >= 0, "статус показывает режим клиента");
    ok(text.indexOf("карта планеты") >= 0, "статус показывает состояние карты");
    ok(text.indexOf("ошибок: 0") >= 0, "статус показывает, что ошибок в журнале нет");
}

// --- 11. Одиночная игра и выделенный сервер --------------------------------
section("одиночная игра и выделенный сервер");
{
    const single = makeWorld({role: "single"});
    loadScript(single);
    fire(single, "ClientLoadEvent");
    tick(single);
    ok(single.ui.planet === single.realPlanet, "в одиночной игре окна не подменяются");
    runListeners(single.pausedDialog.__shownListeners);
    ok(single.pausedRecord.buttons.length === 0, "в одиночной игре в меню паузы ничего не добавляется");

    const server = makeWorld({role: "server"});
    server.sandbox.Packages.mindustry.Vars.headless = true;
    server.sandbox.Packages.mindustry.Vars.ui = null;
    loadScript(server);
    fire(server, "ServerLoadEvent");
    tick(server);
    ok(server.registeredCommandOrder.indexOf("mp-pause") >= 0, "выделенный сервер регистрирует команду паузы");
    runCommand(server, "mp-pause", ["toggle"], {id: 9, admin: false, plainName: () => "Клиент"});
    ok(server.state.paused === true, "выделенный сервер ставит паузу по команде клиента");
    ok(server.warnings.length === 0, "на выделенном сервере нет ошибок" + (server.warnings.length ? ": " + server.warnings.join("; ") : ""));
}

// --- 12. Неудачный обход проверки -----------------------------------------
section("обход проверки недоступен (запасной путь)");
{
    const world = makeWorld({role: "client"});
    // ломаем доступ к полю Net.server
    world.sandbox.Packages.mindustry.Vars.net.getClass = () => ({
        getDeclaredField(){ throw new Error("NoSuchFieldException: server"); }
    });
    loadScript(world);
    fire(world, "ClientLoadEvent");
    tick(world);

    world.ui.planet.show();
    ok(world.realPlanet.showCalls === 0, "окно карты не открывается, если обход недоступен");
    ok(world.infoMessages.indexOf("@map.multiplayer") >= 0, "игроку показано штатное сообщение игры");
    ok(world.warnings.some(w => w.indexOf("Net.server") >= 0), "в журнал попало понятное предупреждение");
}

// --------------------------------- итог ------------------------------------
console.log("\n" + (failures === 0 ? "ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ" : "ПРОВАЛЕНО ПРОВЕРОК: " + failures));
console.log("всего проверок: " + checks);
process.exit(failures === 0 ? 0 : 1);
