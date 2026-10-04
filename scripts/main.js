// ===========================================================================
//  Гидронасос 400 — кооп-режим для мультиплеера Mindustry (build 146+)
// ===========================================================================
//
//  Что делает (полное описание и настройка — в README.md):
//
//   1. ОБЩАЯ ПАУЗА. В ванильном мультиплеере паузу может поставить только
//      хост, а клиенты — не могут вообще. Мод даёт паузу всем: игра замирает
//      у всех сразу, снять её может любой игрок. Способы:
//        • клавиша паузы (по умолчанию Пробел, как в одиночной игре);
//        • кнопка «Пауза для всех» в меню паузы (Esc);
//        • команда /mp-pause  (либо /mp-pause on, /mp-pause off).
//
//   2. ИССЛЕДОВАНИЯ ВСЕМ (просмотр). Дерево технологий открывается у всех
//      игроков, включая клиентов. Тратить ресурсы и открывать узлы может
//      только хост — это ванильное правило игры, мод его не отключает.
//
//   3. КАРТА ПЛАНЕТЫ ВСЕМ (просмотр). Карту секторов может открыть любой
//      игрок: кнопка «Карта планеты» в меню паузы, клавиша карты (N) или
//      штатная кнопка на мобильных. Полёт — запуск ядра в другой сектор,
//      отказ от сектора, смена сложности кампании — остаётся только у хоста:
//      на клиенте кнопки действий карты заблокированы.
//
//   4. ДИАГНОСТИКА. Команда /mp-status показывает состояние модуля.
//
//  Как устроено. Mindustry поддерживает JS-скрипты в модах, поэтому мод
//  работает без компиляции и на клиентах, и на выделенном сервере.
//  Пауза — серверная: клиент отправляет команду /mp-pause, сервер меняет
//  состояние игры, и оно расходится по сети штатной синхронизацией.
//  Карта и исследования — клиентские: на время открытия окна мод подставляет
//  приватный флаг «я сервер» (это и есть ванильная проверка «только для
//  хоста») и сразу возвращает его как было. Всё рискованное завёрнуто в
//  try/catch: если в новой версии игры что-то переименуют, соответствующая
//  возможность просто отключится, а не сломает игру.
// ===========================================================================

// ------------------------------- настройки ---------------------------------
// Можно править прямо в папке мода:
//     <Mindustry>/mods/water-well-400/scripts/main.js

const CFG = {
    // Кто может ставить и снимать паузу:
    //   false — любой игрок (по умолчанию);
    //   true  — только хост, остальные получат подсказку.
    onlyHostCanPause: false,

    // Клавиша паузы (по умолчанию Пробел) работает у клиентов так же, как в
    // одиночной игре. У хоста клавишу обрабатывает сама игра.
    pauseHotkey: true,

    // Кнопки в меню паузы: «Пауза для всех», «Исследования», «Карта планеты».
    pauseMenuButtons: true,

    // Писать в чат, кто поставил и кто снял паузу.
    announcePause: true,

    // Не чаще одного запроса паузы от одного игрока за это время (мс).
    pauseCooldownMs: 1500,

    // Клиентам доступно дерево технологий (только просмотр).
    researchForAll: true,

    // Клиентам доступна карта планеты (только просмотр).
    mapForAll: true,

    // Блокировать на клиенте действия карты: запуск ядра, отказ от сектора,
    // смену сложности кампании. Летать между секторами должен только хост.
    hostOnlyMapActions: true,

    // Снимать правило pauseDisabled на сервере: в кампании оно иногда мешает
    // ставить паузу даже хосту.
    forcePauseAllowed: true,
};

const MOD_VERSION = "2.0.0";
const TAG = "[кооп] ";

// ------------------- доступ к классам игры через Packages ------------------

function cls(path){
    try{
        var cur = Packages;
        var parts = String(path).split(".");
        for(var i = 0; i < parts.length; i++){
            cur = cur[parts[i]];
            if(cur == null) return null;
        }
        return cur;
    }catch(e){
        return null;
    }
}

// Классы игры ищем лениво: обращение к классу загружает и инициализирует его,
// а часть игровых классов готова к этому только после старта интерфейса.
var classCache = {};

function lazyCls(path){
    var cached = classCache[path];
    if(cached != null) return cached;
    var value = cls(path);
    if(value != null) classCache[path] = value;
    return value;
}

function iconCls(){ return lazyCls("mindustry.gen.Icon") || lazyCls("mindustry.graphics.Icon"); }
function stateCls(){ return lazyCls("mindustry.core.GameState.State"); }
function touchableCls(){ return lazyCls("arc.scene.event.Touchable"); }
function bindingCls(){ return lazyCls("mindustry.input.Binding"); }
function planetDialogCls(){ return lazyCls("mindustry.ui.dialogs.PlanetDialog"); }
function researchDialogCls(){ return lazyCls("mindustry.ui.dialogs.ResearchDialog"); }
function campaignRulesDialogCls(){ return lazyCls("mindustry.ui.dialogs.CampaignRulesDialog"); }
function commandRunnerCls(){ return lazyCls("arc.util.CommandHandler.CommandRunner"); }

const VarsC = cls("mindustry.Vars");
const CallC = cls("mindustry.gen.Call") || (typeof Call != "undefined" ? Call : null);
const LogC = cls("arc.util.Log");
const TimeC = cls("arc.util.Time");
const CoreC = cls("arc.Core");
const EventsC = cls("arc.Events");

// События и Trigger объявлены в scripts/global.js; если их там не окажется,
// берём классы напрямую.
function eventClass(name, fallback){
    var value = null;
    try{
        // Значения из global.js: ClientLoadEvent, ServerLoadEvent, ...
        if(name == "ClientLoadEvent") value = ClientLoadEvent;
        else if(name == "ServerLoadEvent") value = ServerLoadEvent;
        else if(name == "WorldLoadEvent") value = WorldLoadEvent;
        else if(name == "Trigger") value = Trigger;
    }catch(e){}
    if(value == null) value = cls(fallback);
    return value;
}

const ClientLoadEventC = eventClass("ClientLoadEvent", "mindustry.game.EventType.ClientLoadEvent");
const ServerLoadEventC = eventClass("ServerLoadEvent", "mindustry.game.EventType.ServerLoadEvent");
const WorldLoadEventC = eventClass("WorldLoadEvent", "mindustry.game.EventType.WorldLoadEvent");
const TriggerC = eventClass("Trigger", "mindustry.game.EventType.Trigger");

// --------------------------- совместимость ---------------------------------
// Хелперы из global.js (run/cons/extend) с запасными вариантами: мод не должен
// зависеть от того, что именно лежит в соседнем служебном файле.

function runner(fn){
    try{ return run(fn); }catch(e){}
    try{ return JavaAdapter(Packages.java.lang.Runnable, {run: fn}); }catch(e){}
    return null;
}

function consumer(fn){
    try{ return cons(fn); }catch(e){}
    try{ return JavaAdapter(Packages.arc.func.Cons, {get: fn}); }catch(e){}
    return null;
}

function extendCls(base, def){
    if(base == null) return null;
    try{ return extend(base, def); }catch(e){ logW("extend для " + base, e); }
    try{ return JavaAdapter(base, def); }catch(e){ logW("JavaAdapter для " + base, e); }
    return null;
}

// --------------------------- журнал и защита -------------------------------

var diagnostics = [];

function note(msg){
    diagnostics.push(String(msg));
    if(diagnostics.length > 30) diagnostics.shift();
}

function logI(msg){
    note(msg);
    try{ if(LogC != null) LogC.info(TAG + msg); }catch(e){}
}

function logW(msg, err){
    note("ошибка: " + msg + (err == null ? "" : " (" + err + ")"));
    try{ if(LogC != null) LogC.warn(TAG + msg + (err == null ? "" : " :: " + err)); }catch(e){}
}

// Любое рискованное действие — через safe(): мод не должен ломать игру.
function safe(what, fn){
    try{
        return fn();
    }catch(e){
        logW(what, e);
        return null;
    }
}

// ------------------------------ состояние ----------------------------------

function netA(){ return (VarsC == null) ? null : VarsC.net; }
function uiA(){ return (VarsC == null) ? null : VarsC.ui; }
function stateA(){ return (VarsC == null) ? null : VarsC.state; }
function headlessA(){ return VarsC != null && VarsC.headless === true; }
function uiReady(){ return !headlessA() && uiA() != null; }
function inMP(){ var n = netA(); return n != null && n.active(); }
function asClient(){ var n = netA(); return n != null && n.active() && n.client(); }
function asServer(){ var n = netA(); return n != null && n.server(); }
function inGame(){ var s = stateA(); return s != null && s.isGame(); }
function isPaused(){ var s = stateA(); return s != null && s.isPaused(); }
function inCampaign(){ var s = stateA(); return s != null && s.isCampaign(); }
function isMobile(){ return VarsC != null && VarsC.mobile === true; }

function now(){ return (TimeC != null) ? TimeC.millis() : Date.now(); }

function pName(player){
    if(player == null) return null;
    try{ return player.plainName(); }catch(e){}
    try{ return player.name; }catch(e){}
    return null;
}

function isHostPlayer(player){
    if(player == null) return false;
    try{
        if(VarsC.player != null && player.id == VarsC.player.id) return true;
    }catch(e){}
    try{ return player.admin === true; }catch(e){}
    return false;
}

// ------------------------------- строки ------------------------------------

function T(key, fallback){
    try{
        var b = (CoreC != null) ? CoreC.bundle : null;
        if(b != null){
            var v = b.get(key);
            if(v != null && v != key) return String(v);
        }
    }catch(e){}
    return fallback;
}

// Подстановка {0} без varargs — так надёжнее из скрипта.
function TF(key, value, fallback){
    return T(key, fallback).split("{0}").join(value == null ? "" : String(value));
}

function stripColors(text){
    return String(text).replace(/\[[^\]]*\]/g, "");
}

function toast(text){
    if(!uiReady()) return;
    safe("всплывающее сообщение", function(){ uiA().showInfoFade(text); });
}

function showInfo(text){
    if(!uiReady()) return;
    safe("информационное окно", function(){ uiA().showInfo(text); });
}

function tell(player, text){
    if(text == null) return;
    safe("сообщение игроку", function(){
        if(player != null && player.sendMessage != null){
            player.sendMessage(text);
        }else if(uiReady()){
            toast(text);
        }
    });
}

function broadcast(text){
    if(text == null) return;
    safe("сообщение в чат", function(){
        if(CallC != null && CallC.sendMessage != null){
            CallC.sendMessage(text, stripColors(text), null);
        }
    });
}

function icon(name){
    var c = iconCls();
    if(c == null) return null;
    try{ return c[name]; }catch(e){ return null; }
}

// ============================= 1. ПАУЗА ====================================
// Пауза в Mindustry — одно общее состояние игры (GameState.State). Менять его
// вправе только сервер: он рассылает состояние клиентам, и игра замирает у
// всех сразу. Поэтому клиент не «паузит» себя сам, а просит сервер командой.

var lastRequest = {};       // имя игрока -> время последнего запроса (сервер)
var lastClientAsk = 0;      // время последнего запроса (клиент)

function applyPause(player, mode){
    if(!asServer()) return;                  // состояние меняет только сервер
    var s = stateA();
    if(s == null || !s.isGame()) return;      // вне игры пауза не нужна

    if(CFG.onlyHostCanPause && player != null && !isHostPlayer(player)){
        tell(player, T("mp.hostonly.pause", "В этой игре паузу ставит только хост."));
        return;
    }

    var want;
    if(mode == "on") want = true;
    else if(mode == "off") want = false;
    else want = !s.isPaused();

    if(want == s.isPaused()) return;          // ничего не меняем

    var enumState = stateCls();
    s.set(want ? enumState.paused : enumState.playing);

    if(CFG.announcePause){
        var name = pName(player);
        if(name == null) name = "Сервер";
        broadcast(want
            ? TF("mp.paused.by", name, "[accent]{0}[] поставил игру на паузу. Снять её может любой игрок: кнопка в меню паузы или /mp-pause.")
            : TF("mp.unpaused.by", name, "[accent]{0}[] снял паузу."));
    }

    logI(want ? "игра поставлена на паузу" : "пауза снята");
}

function pauseCommand(args, player){
    var mode = "toggle";
    if(args != null){
        var a = (typeof args == "string") ? args : ((args.length > 0) ? args[0] : null);
        if(a != null && String(a).length > 0) mode = String(a).toLowerCase();
    }

    if(mode == "help"){
        tell(player, T("mp.cmd.help", "[accent]Кооп-команды:[] /mp-pause — пауза для всех; /mp-status — диагностика."));
        return;
    }

    var key = pName(player);
    if(key != null){
        var t = now();
        if(lastRequest[key] != null && t - lastRequest[key] < CFG.pauseCooldownMs) return;
        lastRequest[key] = t;
    }

    applyPause(player, mode);
}

// Запрос паузы от игрока: хост меняет состояние сам, клиент — командой.
function requestPause(){
    if(!inMP() || !inGame()) return;

    if(asServer()){
        applyPause(VarsC.player, "toggle");
        return;
    }

    var t = now();
    if(t - lastClientAsk < CFG.pauseCooldownMs) return;
    lastClientAsk = t;

    safe("отправка команды паузы", function(){
        CallC.sendChatMessage("/mp-pause");
    });
}

// Клавиша паузы для клиентов: в ванили её обрабатывает только хост
// (в Control.update стоит условие !net.client()), поэтому клиенту включаем сами.
function clientPauseHotkey(){
    if(!CFG.pauseHotkey) return;
    if(!asClient() || !inGame()) return;
    if(CoreC == null || CoreC.scene == null || CoreC.input == null) return;

    try{
        if(CoreC.scene.hasDialog() || CoreC.scene.hasKeyboard()) return;
    }catch(e){ return; }

    var binding = bindingCls();
    if(binding == null) return;

    var bind = null;
    try{ bind = binding.pause; }catch(e){}
    if(bind == null) return;

    var tapped = false;
    safe("чтение клавиши паузы", function(){
        tapped = CoreC.input.keyTap(bind);
    });
    if(tapped !== true){
        // запасной вариант: читаем саму клавишу привязки
        tapped = safe("чтение клавиши паузы (KeyCode)", function(){
            return CoreC.input.keyTap(bind.value);
        }) === true;
    }

    if(tapped) requestPause();
}

// ==================== 2. КНОПКИ В МЕНЮ ПАУЗЫ ===============================

var pauseMenuInstalled = false;

function installPauseMenu(){
    if(pauseMenuInstalled) return true;
    if(!CFG.pauseMenuButtons || !uiReady()) return false;

    var dialog = uiA().paused;
    if(dialog == null || dialog.cont == null) return false;

    safe("подписка на меню паузы", function(){
        // Меню паузы пересобирает содержимое при каждом открытии, поэтому
        // кнопки добавляем заново каждый раз.
        dialog.shown(runner(function(){
            safe("кнопки кооп-режима", function(){ buildPauseButtons(dialog); });
        }));
        pauseMenuInstalled = true;
    });

    if(pauseMenuInstalled) logI("кнопки кооп-режима добавлены в меню паузы");
    return pauseMenuInstalled;
}

function addMenuButton(cont, label, iconName, action){
    var ic = icon(iconName);
    var cell = (ic != null) ? cont.button(label, ic, runner(action)) : cont.button(label, runner(action));
    return cell;
}

function buildPauseButtons(dialog){
    if(!inMP()) return;                      // в одиночной игре ничего не нужно
    var cont = dialog.cont;
    if(cont == null) return;

    // --- пауза для всех ---
    cont.row();
    var paused = isPaused();
    var cell = addMenuButton(
        cont,
        paused ? T("mp.resume.all", "Продолжить у всех") : T("mp.pause.all", "Пауза для всех"),
        paused ? "play" : "pause",
        requestPause
    );
    if(cell != null && cell.colspan != null) cell.colspan(2);

    if(!inCampaign()) return;

    // На мобильных в кампании игра сама показывает кнопки исследований и
    // карты — дублировать их не нужно.
    if(isMobile()) return;

    // --- исследования и карта планеты (просмотр для всех) ---
    cont.row();
    addMenuButton(cont, "@research", "tree", openResearch);
    addMenuButton(cont, "@planetmap", "map", openPlanetMap);
}

// ================= 3. ОБХОД ПРОВЕРКИ «ТОЛЬКО ХОСТ» ==========================
// В PlanetDialog и ResearchDialog есть проверка
//     if(net.client()){ ui.showInfo("@map.multiplayer"); return this; }
// которая закрывает эти окна клиентам. Она читает приватное поле Net.server,
// поэтому на время открытия окна подставляем туда true и сразу возвращаем
// как было. Поле не нашлось — показываем штатное сообщение игры.

var serverField = null;
var serverFieldChecked = false;

function serverFlagAvailable(){
    if(!serverFieldChecked){
        serverFieldChecked = true;
        if(netA() != null){
            serverField = safe("поиск поля Net.server", function(){
                var f = netA().getClass().getDeclaredField("server");
                f.setAccessible(true);
                return f;
            });
            if(serverField == null){
                logW("нет доступа к полю Net.server: карта и исследования останутся недоступны клиентам");
            }
        }
    }
    return serverField != null;
}

function withServerFlag(fn){
    if(!serverFlagAvailable()) return false;

    var was = false;
    try{
        was = serverField.getBoolean(netA());
    }catch(e){
        logW("чтение Net.server", e);
        return false;
    }

    var ok = false;
    try{
        serverField.setBoolean(netA(), true);
        fn();
        ok = true;
    }catch(e){
        logW("открытие окна в режиме просмотра", e);
    }finally{
        try{ serverField.setBoolean(netA(), was); }catch(e){ logW("возврат Net.server", e); }
    }
    return ok;
}

// Переопределён ли show() в самом классе: если да, там проверка для клиентов
// и нужен обход; если нет — окно открывается штатно.
function declaresShow(c){
    if(c == null) return true;
    try{
        c.getDeclaredMethod("show");
        return true;
    }catch(e){
        return false;
    }
}

function openThrough(realDialog, what, onOpened){
    if(realDialog == null) return false;

    var shown = false;

    if(asClient() && declaresShow(realDialog.getClass())){
        withServerFlag(function(){
            realDialog.show();
            shown = true;
        });
    }else{
        safe(what, function(){
            realDialog.show();
            shown = true;
        });
    }

    if(shown && onOpened != null) safe(what + ": режим просмотра", onOpened);
    return shown;
}

function hostOnlyMessage(){
    showInfo(T("mp.onlyhost", "Запускать ядро в другие секторы, отказываться от сектора и открывать технологии может только хост."));
}

// ==================== 4. ИССЛЕДОВАНИЯ ДЛЯ ВСЕХ =============================

var researchFacade = null;
var realResearch = null;
var researchNoticeShown = false;

function openResearch(){
    if(!uiReady()) return;

    if(!CFG.researchForAll || !asClient()){
        safe("дерево технологий", function(){ uiA().research.show(); });
        return;
    }

    var dialog = (realResearch != null) ? realResearch : uiA().research;
    if(dialog == null) return;

    if(openThrough(dialog, "дерево технологий", null)){
        if(!researchNoticeShown){
            researchNoticeShown = true;
            toast(T("mp.researchview", "Исследования открыты в режиме просмотра: открывать технологии может только хост."));
        }
    }else{
        showInfo("@research.multiplayer");
    }
}

function installResearchFacade(){
    if(researchFacade != null) return true;
    if(!CFG.researchForAll || !asClient() || !uiReady()) return false;
    var researchClass = researchDialogCls();
    if(researchClass == null || !declaresShow(researchClass)) return false;  // в новых версиях клиентам уже можно
    if(uiA().research == null) return false;

    realResearch = uiA().research;

    researchFacade = safe("фасад исследований", function(){
        return extendCls(researchDialogCls(), {
            // у клиента окно должны открывать и клавиша, и штатные кнопки;
            // «потратить» ресурсы всё равно сможет только хост
            show: function(){ openResearch(); },
            toggle: function(){ if(realResearch.isShown()) realResearch.hide(); else openResearch(); },
            hide: function(){ realResearch.hide(); },
            isShown: function(){ return realResearch.isShown(); }
        });
    });

    if(researchFacade == null) return false;

    safe("подмена окна исследований", function(){ uiA().research = researchFacade; });
    logI("исследования открыты клиенту в режиме просмотра");
    return true;
}

// ==================== 5. КАРТА ПЛАНЕТЫ ДЛЯ ВСЕХ ============================

var planetFacade = null;
var realPlanet = null;
var mapNoticeShown = false;
var rulesGuarded = false;

function makeMapReadOnly(){
    if(!CFG.hostOnlyMapActions || !asClient() || realPlanet == null) return;
    safe("режим просмотра карты", function(){
        var top = realPlanet.sectorTop;
        if(top == null) return;
        // Панель сектора — единственное место карты, откуда можно запустить
        // ядро, отменить сектор или открыть его статистику: делаем её
        // некликабельной и гасим кнопки.
        var touchable = touchableCls();
        if(touchable != null && top.touchable != touchable.disabled){
            top.touchable = touchable.disabled;
        }
        grayOutButtons(top, 0);
    });
}

function grayOutButtons(element, depth){
    if(element == null || depth > 6) return;
    try{
        if(element.setDisabled != null) element.setDisabled(true);
    }catch(e){}
    var kids = null;
    try{ kids = (element.getChildren != null) ? element.getChildren() : null; }catch(e){ kids = null; }
    if(kids == null) return;
    try{
        for(var i = 0; i < kids.size; i++){
            grayOutButtons(kids.get(i), depth + 1);
        }
    }catch(e){}
}

function openPlanetMap(){
    if(!uiReady()) return;

    if(!CFG.mapForAll || !asClient()){
        safe("карта планеты", function(){ uiA().planet.show(); });
        return;
    }

    var dialog = (realPlanet != null) ? realPlanet : uiA().planet;
    if(dialog == null) return;

    if(openThrough(dialog, "карта планеты", makeMapReadOnly)){
        if(!mapNoticeShown){
            mapNoticeShown = true;
            toast(T("mp.mapview", "Карта планеты открыта в режиме просмотра: летать между секторами может только хост."));
        }
    }else{
        showInfo("@map.multiplayer");
    }
}

function installPlanetFacade(){
    if(planetFacade != null) return true;
    if(!CFG.mapForAll || !asClient() || !uiReady() || planetDialogCls() == null) return false;
    if(uiA().planet == null) return false;

    realPlanet = uiA().planet;

    planetFacade = safe("фасад карты планеты", function(){
        return extendCls(planetDialogCls(), {
            // данные карты — один объект с настоящим диалогом: их читают
            // ResearchDialog, SoundControl и другие места игры
            state: realPlanet.state,
            // просмотр карты доступен клиенту
            show: function(){ openPlanetMap(); },
            toggle: function(){ if(realPlanet.isShown()) realPlanet.hide(); else openPlanetMap(); },
            hide: function(){ realPlanet.hide(); },
            isShown: function(){ return realPlanet.isShown(); },
            // а действия карты — только у хоста
            showSelect: function(){ hostOnlyMessage(); },
            showPlanetLaunch: function(){ hostOnlyMessage(); },
            abandonSectorConfirm: function(){ hostOnlyMessage(); }
        });
    });

    if(planetFacade == null) return false;

    safe("подмена окна карты", function(){ uiA().planet = planetFacade; });
    logI("карта планеты открыта клиенту в режиме просмотра");
    return true;
}

// Смена сложности кампании на клиенте перезаписывает правила сервера
// (CampaignRulesDialog при закрытии вызывает Call.setRules), поэтому клиенту
// этот диалог закрываем: правила меняет хост.
function installCampaignRulesGuard(){
    if(rulesGuarded) return true;
    var rulesClass = campaignRulesDialogCls();
    if(!CFG.hostOnlyMapActions || !asClient() || !uiReady() || rulesClass == null) return false;
    if(uiA().campaignRules == null) return false;    // в старых версиях такого диалога нет

    var guard = safe("запрет правки сложности", function(){
        return extendCls(rulesClass, {
            show: function(){ hostOnlyMessage(); }
        });
    });
    if(guard == null) return false;

    safe("подмена окна сложности", function(){ uiA().campaignRules = guard; });
    rulesGuarded = true;
    logI("смена сложности кампании на клиенте заблокирована");
    return true;
}

// ==================== 6. ПРАВИЛО pauseDisabled =============================
// В кампании игра может выставить rules.pauseDisabled — тогда пауза не
// работает даже у хоста. Снимаем флаг и рассылаем правила клиентам.

function allowPauseRule(){
    if(!CFG.forcePauseAllowed || !asServer()) return;
    var s = stateA();
    if(s == null || s.rules == null) return;

    safe("снятие правила pauseDisabled", function(){
        if(s.rules.pauseDisabled === true){
            s.rules.pauseDisabled = false;
            if(CallC != null && CallC.setRules != null) CallC.setRules(s.rules);
            logI("правило pauseDisabled снято");
        }
    });
}

// ==================== 7. КОМАНДЫ И ДИАГНОСТИКА =============================

var commandsRegistered = false;

function makeCommandRunner(fn){
    var runnerClass = commandRunnerCls();
    if(runnerClass == null) return null;
    return safe("обёртка команды", function(){
        return JavaAdapter(runnerClass, {
            accept: function(args, player){
                // исключение внутри команды не должно ронять обработку чата
                safe("выполнение команды", function(){ fn(args, player); });
            }
        });
    });
}

function registerCommands(){
    if(commandsRegistered) return true;
    if(VarsC == null || VarsC.netServer == null) return false;

    var handler = VarsC.netServer.clientCommands;
    if(handler == null) return false;

    safe("регистрация команд", function(){
        var runnerPause = makeCommandRunner(pauseCommand);
        if(runnerPause != null){
            handler.register("mp-pause", "[on|off]", "Поставить или снять общую паузу", runnerPause);
        }else{
            // запасной вариант: без параметров
            handler.register("mp-pause", "Поставить или снять общую паузу", consumer(function(){
                applyPause(null, "toggle");
            }));
        }

        var runnerStatus = makeCommandRunner(function(args, player){ statusCommand(player); });
        if(runnerStatus != null){
            handler.register("mp-status", "", "Диагностика кооп-модуля", runnerStatus);
        }else{
            handler.register("mp-status", "Диагностика кооп-модуля", consumer(function(){ statusCommand(null); }));
        }

        commandsRegistered = true;
    });

    if(commandsRegistered) logI("серверные команды зарегистрированы (/mp-pause, /mp-status)");
    return commandsRegistered;
}

function statusCommand(player){
    var lines = [];
    lines.push("[accent]Гидронасос 400: кооп-модуль v" + MOD_VERSION + "[]");
    lines.push("режим: " + (inMP()
        ? ((asServer() && asClient()) ? "хост (сервер и клиент)" : (asServer() ? "выделенный сервер" : "клиент"))
        : "одиночная игра"));
    lines.push("общая пауза: " + (inGame() ? (isPaused() ? "игра на паузе" : "игра идёт") : "нет активной игры"));
    lines.push("команды: " + (commandsRegistered ? "зарегистрированы" : "нет"));
    lines.push("обход проверки Net.server: " + (serverFlagAvailable() ? "доступен" : "недоступен"));
    lines.push("меню паузы: " + (pauseMenuInstalled ? "кнопки добавлены" : "кнопки не добавлены"));
    lines.push("карта планеты: " + ((planetFacade != null) ? "доступна клиенту (просмотр)" : "ванильная"));
    lines.push("исследования: " + ((researchFacade != null) ? "доступны клиенту (просмотр)" : "ванильные"));

    var errors = 0;
    for(var i = 0; i < diagnostics.length; i++){
        if(diagnostics[i].indexOf("ошибка:") == 0) errors++;
    }
    lines.push("записей в журнале: " + diagnostics.length + ", ошибок: " + errors);

    var text = lines.join("\n");
    if(player != null && player.sendMessage != null){
        player.sendMessage(text);
    }else{
        logI("статус:\n" + text);
    }
}

// ============================ 8. ЕЖЕКАДРОВОЕ ===============================
// Trigger.update срабатывает и на сервере, и у клиента, и даже когда игра на
// паузе (в Logic.update событие рассылается до проверки isPaused).

function onUpdate(){
    registerCommands();

    if(!headlessA()){
        installPauseMenu();
        if(asClient()){
            installPlanetFacade();
            installResearchFacade();
            installCampaignRulesGuard();
        }
    }

    // Панель сектора пересобирается при каждом выборе сектора, поэтому режим
    // «только просмотр» подтверждаем, пока карта открыта.
    if(planetFacade != null && realPlanet != null && asClient()){
        var shown = false;
        try{ shown = realPlanet.isShown(); }catch(e){}
        if(shown) makeMapReadOnly();
    }

    if(asClient()) clientPauseHotkey();
    allowPauseRule();
}

// ============================ 9. СОБЫТИЯ ===================================

function on(eventClass, fn){
    if(EventsC == null || eventClass == null) return;
    safe("подписка на событие", function(){
        var listener = consumer(fn);
        if(listener != null) EventsC.on(eventClass, listener);
    });
}

// Загрузка клиента: это и клиент, и хост (у хоста интерфейс тоже есть).
on(ClientLoadEventC, function(){
    registerCommands();
    if(!headlessA()){
        installPauseMenu();
        allowPauseRule();
    }
});

// Запуск выделенного сервера: нужна только серверная часть.
on(ServerLoadEventC, function(){
    registerCommands();
    allowPauseRule();
});

// Начало игры: проверяем правила и включаем клиентские возможности.
on(WorldLoadEventC, function(){
    registerCommands();
    allowPauseRule();
    if(asClient()){
        installPlanetFacade();
        installResearchFacade();
        installCampaignRulesGuard();
    }
});

if(EventsC != null && TriggerC != null){
    safe("подписка на тик игры", function(){
        var listener = runner(onUpdate);
        if(listener != null) EventsC.run(TriggerC.update, listener);
    });
}

logI("кооп-модуль загружен (версия " + MOD_VERSION + ")");
