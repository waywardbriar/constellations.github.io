/* Constellations character builder, slice 2: hub, start, role, background, stats, feats, info, save/load.
   Stores choices only; every derived number is recalculated (see Character File Specification). */
(function () {
  "use strict";
  var SCHEMA = 1, DRAFT_KEY = "constellations-builder-draft";
  var app = document.getElementById("app");
  var D = null;        // rules data (data.json)
  var C = null;        // current character file
  var ui = { tree: "Combat", q: "", open: {}, notice: "" };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    for (var k in (attrs || {})) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? "" : attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return n;
  }

  /* ---------- the character file ---------- */
  function blank() {
    return {
      file: { schemaVersion: SCHEMA, rulesVersion: D.rulesVersion },
      identity: { name: "", appearance: "", notes: "" },
      start: { type: "start:average" },
      role: { id: "", styles: ["", ""] },
      companion: { name: "", creature: "" },
      background: { id: "", size: null, vision: [], feats: [] },
      languages: [],
      equipment: { inventory: [] },
      stats: { mind: 0, body: 0, soul: 0 },
      feats: [],
      merit: { starting: 0, earned: 0, spent: 0, remaining: 0 }
    };
  }
  function startType(id) { return D.startTypes.filter(function (s) { return s.id === id; })[0] || D.startTypes[0]; }
  function featById(id) { return D.feats.filter(function (f) { return f.id === id; })[0]; }
  function bgById(id) { return D.backgrounds.filter(function (b) { return b.id === id; })[0]; }
  function roleById(id) { return D.roles.filter(function (r) { return r.id === id; })[0]; }
  function langById(id) { return D.languages.filter(function (l) { return l.id === id; })[0]; }
  var SIZES = [0.25, 0.5, 0.75, 1, 2, 3];
  function sizeChoices(bg) {
    if (!bg) return [];
    if (!bg.sizeRange) return SIZES.slice();
    return SIZES.filter(function (v) { return v >= bg.sizeRange[0] && v <= bg.sizeRange[1]; });
  }
  function sizeLabel(v) { return v == null ? "" : String(v); }
  function hasFeat(id) { return C.feats.some(function (e) { return e.id === id; }); }

  /* ---------- equipment rules ---------- */
  var QUALITY_CATS = ["Weapons", "Armour", "Clothes & Other Items"], WEARABLE = ["Armour", "Clothes & Other Items"];
  function itemById(id) { return D.items.filter(function (i) { return i.id === id; })[0]; }
  function qualityById(id) { return D.qualities.filter(function (q) { return q.id === id; })[0] || D.qualities[1]; }
  function qualityable(it) { return QUALITY_CATS.indexOf(it.cat) >= 0; }
  function wearable(it) { return WEARABLE.indexOf(it.cat) >= 0; }
  function stackable(it) { return QUALITY_CATS.indexOf(it.cat) < 0; }
  /* price per unit in merit; Shoddy never costs more than Normal, and never less than 1 unless the base is 0 */
  function unitPrice(it, qid) {
    var q = qualityable(it) ? qualityById(qid) : qualityById("quality:normal");
    if (q.id === "quality:shoddy") return it.cost <= 0 ? 0 : Math.min(it.cost, Math.max(1, it.cost + q.mod));
    return it.cost + q.mod;
  }
  function entryCost(e) { var it = itemById(e.id); return it ? unitPrice(it, e.quality) * e.qty : 0; }
  function qBonus(e, it) { return qualityable(it) ? qualityById(e.quality).bonus : 0; }
  function isBroken(e) { return e.condition === "condition:broken"; }
  /* Guard: only wearables that already give Guard take the quality bonus; a condition costs 1, Broken gives none */
  function effGuard(e, it) {
    if (!wearable(it) || !(it.guard > 0)) return it.guard || 0;
    if (isBroken(e)) return 0;
    return Math.max(0, it.guard + qBonus(e, it) - (e.condition ? 1 : 0));
  }
  function effBonus(e, it) { if (isBroken(e)) return 0; return Math.max(0, (it.bonus || 0) + qBonus(e, it) - (e.condition ? 1 : 0)); }
  function entrySlots(e, it) { return it.slots && it.slots.indexOf("Variable") >= 0 ? e.slots : (it.slots || []); }
  function guardInfo() {
    var sum = 0;
    C.equipment.inventory.forEach(function (e) {
      var it = itemById(e.id); if (it && wearable(it) && e.equipped) sum += effGuard(e, it);
    });
    var other = C.background.feats.some(function (f) { return f.id === "feat:thick-skinned"; }) ? 2 : 0;
    var capped = Math.min(D.guardCap, sum);
    return { sum: sum, capped: capped, other: other, total: capped + other };
  }
  function gearCost() { var t = 0; C.equipment.inventory.forEach(function (e) { t += entryCost(e); }); return t; }
  /* movement: background modifier + Movement Expertise picks; speed = Tempo + modifier, never below 1 */
  function movement() {
    var bg = bgById(C.background.id); if (!bg) return [];
    var tempo = 2 + Math.ceil(C.stats.body / 2);
    return bg.mobility.map(function (m) {
      var extra = C.feats.filter(function (e) { return e.id === "feat:movement-expertise" && (e.choice || "").trim().toLowerCase() === m[0].toLowerCase(); }).length;
      var mod = m[1] + extra;
      return { type: m[0], mod: mod, extra: extra, speed: Math.max(1, tempo + mod) };
    });
  }
  function visionList() {
    var bg = bgById(C.background.id), v = [];
    if (bg) v = bg.visionMode === "all" ? bg.vision.slice() : C.background.vision.slice();
    if (hasFeat("feat:third-eye")) v.push("Aethersight (Third Eye)");
    return v;
  }

  /* ---------- rules math ---------- */
  function statCost(level) { var t = 0; for (var i = 0; i < level; i++) t += D.statCosts[i] != null ? D.statCosts[i] : 3 * (i + 1); return t; }
  var STATS = [["mind", "Mind"], ["body", "Body"], ["soul", "Soul"]];
  function derivedBy(s) {
    return {
      mind: [["Scope", 1 + s.mind], ["Reputation", 1 + Math.floor(s.mind / 2)], ["Poise", 1 + Math.ceil(s.mind / 2)]],
      body: [["Stamina", 5 + s.body], ["Injury Slots", 2 + s.body], ["Tempo", 2 + Math.ceil(s.body / 2)]],
      soul: [["Exertion", s.soul + 2], ["Grit", 1 + Math.floor(s.soul / 2)], ["Stability", 1 + Math.ceil(s.soul / 2)]]
    };
  }
  function totals() {
    var st = startType(C.start.type), stats = 0, feats = 0, gear = gearCost();
    STATS.forEach(function (p) { stats += statCost(C.stats[p[0]]); });
    C.feats.forEach(function (e) { var f = featById(e.id); if (f) feats += f.cost; });
    var total = st.merit + (C.merit.earned || 0), spent = stats + feats + gear;
    return { st: st, stats: stats, feats: feats, gear: gear, total: total, spent: spent, remaining: total - spent };
  }
  function sync() { var t = totals(); C.merit.starting = t.st.merit; C.merit.spent = t.spent; C.merit.remaining = t.remaining; return t; }

  /* each warning says which section it belongs to: start, stats or feats */
  function warnings() {
    var w = [], t = totals(), st = t.st;
    function add(sec, text) { w.push({ sec: sec, text: text }); }
    if (t.remaining < 0) add("start", "You have spent " + (-t.remaining) + " more merit than you have.");
    STATS.forEach(function (p) {
      var v = C.stats[p[0]];
      if (v > st.statCap) add("stats", p[1] + " is " + v + ", above the " + st.name + " start cap of " + st.statCap + ".");
      if (v > 12) add("stats", p[1] + " is above 12; the guide says your GM sets the cost.");
    });
    var have = {}; C.feats.forEach(function (e) { have[e.id] = (have[e.id] || 0) + 1; });
    var seen = {};
    C.feats.forEach(function (e) {
      var f = featById(e.id), label;
      if (!f) { add("feats", "Unknown feat in the file: " + e.id + "."); return; }
      label = f.name + (e.choice ? " (" + e.choice + ")" : "");
      if (st.tiers.indexOf(f.tier) < 0) add("feats", label + " is Tier " + f.tier + "; a " + st.name + " start allows Tiers " + st.tiers.join(", ") + ".");
      if (f.tier > 1) {
        var lower = C.feats.some(function (o) { var g = featById(o.id); return g && g.tree === f.tree && g.tier === f.tier - 1; });
        if (!lower) add("feats", label + " needs a Tier " + (f.tier - 1) + " " + f.tree + " feat first.");
      }
      (f.prereqs || []).forEach(function (grp) {
        if (!grp.some(function (id) { return have[id]; })) add("feats", label + " needs " + grp.map(function (id) { var g = featById(id); return g ? g.name : id; }).join(" or ") + ".");
      });
      if (f.prereqNote) add("feats", label + ": " + f.prereqNote);
      if (f.choice && !(e.choice || "").trim()) add("feats", f.name + " needs a choice (" + f.choice.toLowerCase() + ").");
      var key = e.id + "|" + (e.choice || "").trim().toLowerCase();
      if (seen[key]) add("feats", label + " is taken twice" + (f.multi ? " with the same choice." : "."));
      seen[key] = 1;
      if (!f.multi && have[e.id] > 1 && !seen["m" + e.id]) { seen["m" + e.id] = 1; add("feats", f.name + " can only be taken once."); }
    });
    // equipment
    var bySlot = {};
    C.equipment.inventory.forEach(function (e) {
      var it = itemById(e.id);
      if (!it) { add("equipment", "Unknown item in the file: " + e.id + "."); return; }
      if (!wearable(it) || !e.equipped) return;
      var label = e.name || it.name, sl = entrySlots(e, it);
      if (!sl.length) add("equipment", label + " is worn but fills no slot; tick the slots it covers.");
      if (isBroken(e)) add("equipment", label + " is broken and gives no protection.");
      sl.forEach(function (x) { if (x !== "Accessories") (bySlot[x] = bySlot[x] || []).push(label); });
    });
    Object.keys(bySlot).forEach(function (x) { if (bySlot[x].length > 1) add("equipment", bySlot[x].join(" and ") + " all use the " + x + " slot; only one fits."); });
    var gi = guardInfo();
    if (gi.sum > D.guardCap) add("equipment", "Your worn gear adds up to " + gi.sum + " Guard; the cap is " + D.guardCap + ", so only " + D.guardCap + " counts.");
    // role
    var role = roleById(C.role.id);
    if (role && role.id === "role:constable") {
      C.role.styles.forEach(function (x, i) { if (!(x || "").trim()) add("role", "Constable: name fighting style " + (i + 1) + " of 2 (free Combat Expertise)."); });
    }
    // background
    var bg = bgById(C.background.id);
    if (!bg) add("background", "Choose a background.");
    else {
      var sz = C.background.size;
      if (sz == null) add("background", "Choose a size class for " + bg.name + " (" + bg.sizeText + ").");
      else if (bg.sizeRange && (sz < bg.sizeRange[0] || sz > bg.sizeRange[1])) add("background", "Size class " + sz + " is outside the " + bg.name + " range (" + bg.sizeText + ").");
      if (bg.visionMode === "choose" && !C.background.vision.length) add("background", "Choose a vision: " + bg.vision.join(" or ") + ".");
      bg.feats.forEach(function (f) {
        var mine = C.background.feats.filter(function (e) { return e.id === f.id; })[0];
        if (!mine) add("background", f.name + " is missing from your background feats.");
        else if (f.choice && !(mine.choice || "").trim()) add("background", f.name + " needs a choice (" + f.choice.toLowerCase() + ").");
      });
    }
    var nl = C.languages.length;
    if (nl !== 2) add("background", nl < 2 ? "Choose two starting languages (" + nl + " so far)." : "You chose " + nl + " starting languages; the guide says two.");
    C.languages.forEach(function (id) { if (!langById(id)) add("background", "Unknown language in the file: " + id + "."); });
    return w;
  }

  /* ---------- persistence ---------- */
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(C)); } catch (e) {} }
  function loadDraft() { try { var s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function normalize(obj) {
    var b = blank(), o = obj || {};
    var c = JSON.parse(JSON.stringify(o));               // keeps unknown blocks (role, background, equipment, ...) for later slices
    c.file = c.file || {}; c.file.schemaVersion = SCHEMA; c.file.rulesVersion = c.file.rulesVersion || D.rulesVersion;
    c.identity = Object.assign(b.identity, c.identity || {});
    c.start = Object.assign(b.start, c.start || {});
    if (!D.startTypes.some(function (s) { return s.id === c.start.type; })) c.start.type = b.start.type;
    c.stats = Object.assign(b.stats, c.stats || {});
    STATS.forEach(function (p) { c.stats[p[0]] = Math.max(0, Math.min(99, parseInt(c.stats[p[0]], 10) || 0)); });
    c.feats = (c.feats || []).filter(function (e) { return e && e.id; });
    c.role = Object.assign(b.role, c.role || {}); c.role.styles = [(c.role.styles || [])[0] || "", (c.role.styles || [])[1] || ""];
    c.companion = Object.assign(b.companion, c.companion || {});
    c.background = Object.assign(b.background, c.background || {});
    c.background.vision = Array.isArray(c.background.vision) ? c.background.vision : [];
    c.background.feats = Array.isArray(c.background.feats) ? c.background.feats : [];
    c.languages = Array.isArray(c.languages) ? c.languages : [];
    c.equipment = c.equipment && typeof c.equipment === "object" ? c.equipment : { inventory: [] };
    c.equipment.inventory = (Array.isArray(c.equipment.inventory) ? c.equipment.inventory : []).filter(function (e) { return e && e.id; });
    var maxUid = 0;
    c.equipment.inventory.forEach(function (e) { var m = /^i(\d+)$/.exec(e.uid || ""); if (m) maxUid = Math.max(maxUid, +m[1]); });
    c.equipment.inventory.forEach(function (e) {
      if (!e.uid) e.uid = "i" + (++maxUid);
      e.qty = Math.max(1, parseInt(e.qty, 10) || 1);
      e.quality = e.quality || "quality:normal"; e.condition = e.condition || ""; e.name = e.name || "";
      e.equipped = !!e.equipped; e.slots = Array.isArray(e.slots) ? e.slots : [];
    });
    c.merit = Object.assign(b.merit, c.merit || {});
    c.merit.earned = Math.max(0, parseInt(c.merit.earned, 10) || 0);
    return c;
  }
  function download() {
    sync();
    var name = (C.identity.name || "character").trim().replace(/[^\w\- ]+/g, "").replace(/\s+/g, "-").toLowerCase() || "character";
    var blob = new Blob([JSON.stringify(C, null, 2)], { type: "application/json" });
    var a = el("a", { href: URL.createObjectURL(blob), download: name + ".constellations.json" });
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    ui.notice = "Saved " + name + ".constellations.json."; render();
  }
  function upload(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var obj = JSON.parse(r.result);
        if (!obj || typeof obj !== "object" || !obj.file) throw new Error("not a Constellations file");
        C = normalize(obj);
        ui.notice = "Loaded " + (C.identity.name || "a character") + (obj.file.rulesVersion && obj.file.rulesVersion !== D.rulesVersion ? ". Note: it was built for the " + obj.file.rulesVersion + " rules." : ".");
      } catch (e) { ui.notice = "That file could not be read (" + e.message + ")."; }
      commit();
    };
    r.readAsText(file);
  }

  /* ---------- actions ---------- */
  function commit() { sync(); saveDraft(); render(); }
  function setStat(k, v) { C.stats[k] = Math.max(0, Math.min(12, v)); commit(); }
  function addFeat(f, choice) { var e = { id: f.id }; if (f.choice) e.choice = (choice || "").trim(); C.feats.push(e); ui.open = {}; commit(); }
  function removeFeat(i) { C.feats.splice(i, 1); commit(); }

  /* ---------- sections, colors, routing ---------- */
  var SECS = [
    { id: "start", title: "Start", color: "#FF9E8F", blurb: "Merit start and name" },
    { id: "role", title: "Role", color: "#F2D98A", blurb: "Your place in the household" },
    { id: "background", title: "Background", color: "#FFB48F", blurb: "Who you are, size, senses, languages" },
    { id: "stats", title: "Stats", color: "#F28AB8", blurb: "Mind, Body, Soul" },
    { id: "feats", title: "Feats", color: "#B79CF2", blurb: "Skills and talents" },
    { id: "equipment", title: "Equipment", color: "#FF9B71", blurb: "Gear, armour, weapons" },
    { id: "info", title: "Info", color: "#E58FD0", blurb: "Looks and notes" }
  ];
  var SOON = { equipment: ["Spells"] };   // dim placeholder bubbles, shown after the named section
  var TREE_COLORS = ["#FF8F7E", "#FFC27A", "#F2D98A", "#F28AB8", "#B79CF2", "#FFB48F", "#E56DB1"];
  function secById(id) { return SECS.filter(function (s) { return s.id === id; })[0]; }
  function route() { var h = (location.hash || "").replace("#", ""); return secById(h) ? h : ""; }
  function treeColor(tree) { var i = trees().indexOf(tree); return TREE_COLORS[(i < 0 ? 0 : i) % TREE_COLORS.length]; }
  function trees() { var t = []; D.feats.forEach(function (f) { if (t.indexOf(f.tree) < 0) t.push(f.tree); }); return t; }

  /* ---------- rendering ---------- */
  function render() {
    var active = document.activeElement, activeId = active && active.id, selStart = active && active.selectionStart;
    var t = sync(), warns = warnings(), r = route();
    app.innerHTML = "";
    app.appendChild(summaryBar(t, warns));
    if (!r) app.appendChild(hub(t, warns));
    else app.appendChild(screen(r, t, warns));
    if (activeId) { var n = document.getElementById(activeId); if (n) { n.focus(); try { if (selStart != null) n.setSelectionRange(selStart, selStart); } catch (e) {} } }
  }

  function summaryBar(t, warns) {
    var bar = el("div", { class: "bsum" });
    function cell(label, val, cls) { return el("div", { class: "bcell " + (cls || "") }, [el("span", { class: "bl", text: label }), el("strong", { text: String(val) })]); }
    bar.appendChild(cell("Merit", t.total));
    bar.appendChild(cell("Spent", t.spent));
    bar.appendChild(cell("Remaining", t.remaining, t.remaining < 0 ? "bad" : ""));
    bar.appendChild(cell("Warnings", warns.length, warns.length ? "warn" : ""));
    bar.appendChild(el("div", { class: "btools" }, [
      el("button", { type: "button", class: "primary", onclick: download, text: "Save file" }),
      el("label", { class: "btn", for: "loadfile", text: "Load file" }),
      el("input", { id: "loadfile", type: "file", accept: ".json,application/json", class: "sr", onchange: function (e) { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ""; } }),
      el("button", { type: "button", onclick: function () {
        if (ui.confirmReset) { C = blank(); ui.confirmReset = false; ui.notice = "Started a new character."; commit(); }
        else { ui.confirmReset = true; ui.notice = "Press Start over again to clear this character."; render(); }
      }, text: ui.confirmReset ? "Really start over?" : "Start over" })
    ]));
    if (ui.notice) bar.appendChild(el("p", { class: "bnote", text: ui.notice }));
    return bar;
  }
  function updateTotalsOnly() { sync(); var b = document.querySelector(".bsum"); if (b) b.replaceWith(summaryBar(totals(), warnings())); }

  /* ----- hub ----- */
  function bubbleStatus(id, t) {
    if (id === "start") return t.st.name + " · " + t.st.merit;
    if (id === "info") return C.identity.appearance || C.identity.notes ? "Filled in" : "Empty";
    if (id === "role") { var r = roleById(C.role.id); return r ? r.name : "None chosen"; }
    if (id === "background") { var b = bgById(C.background.id); return b ? b.name : "Not chosen"; }
    if (id === "stats") return "M" + C.stats.mind + " · B" + C.stats.body + " · S" + C.stats.soul;
    if (id === "equipment") { var n = C.equipment.inventory.length; return n + (n === 1 ? " item" : " items") + " · Guard " + guardInfo().total; }
    if (id === "feats") return C.feats.length + (C.feats.length === 1 ? " feat" : " feats");
    return "";
  }
  function hub(t, warns) {
    var wrap = el("div", {});
    wrap.appendChild(el("p", { class: "hubline", text: (C.identity.name || "Your character") + " · " + t.st.name + " start. Merit so far: stats " + t.stats + ", feats " + t.feats + ", gear " + t.gear + ". Pick a bubble to build that part." }));
    var ring = el("nav", { class: "hub", "aria-label": "Character sections" });
    SECS.forEach(function (s) {
      var n = warns.filter(function (w) { return w.sec === s.id; }).length;
      ring.appendChild(el("a", { class: "bub", href: "#" + s.id, style: "--sec:" + s.color }, [
        el("span", { class: "bt", text: s.title }), el("span", { class: "bs", text: bubbleStatus(s.id, t) }),
        n ? el("span", { class: "bw", "aria-label": n + " warnings", text: String(n) }) : null
      ]));
      (SOON[s.id] || []).forEach(function (name) {
        ring.appendChild(el("span", { class: "bub soon", "aria-disabled": "true" }, [el("span", { class: "bt", text: name }), el("span", { class: "bs", text: "Coming soon" })]));
      });
    });
    wrap.appendChild(ring);
    if (warns.length) wrap.appendChild(warningList(warns, true));
    return wrap;
  }
  function warningList(list, withSection) {
    var box = el("section", { class: "bcard warnbox", id: "warnings" }, [el("h2", { text: "Warnings" })]);
    box.appendChild(el("ul", { class: "warnlist" }, list.map(function (w) {
      var s = secById(w.sec);
      return el("li", {}, [withSection && s ? el("a", { href: "#" + s.id, text: s.title + ": " }) : null, document.createTextNode(w.text)]);
    })));
    return box;
  }
  function refreshWarnings() {
    var old = document.getElementById("warnings"), r = route(), list = warnings().filter(function (w) { return !r || w.sec === r; });
    if (!list.length) { if (old) old.remove(); return; }
    var nu = warningList(list, !r);
    if (old) old.replaceWith(nu);
  }

  /* ----- a section screen ----- */
  function screen(id, t, warns) {
    var s = secById(id), wrap = el("div", { class: "bscreen", style: "--sec:" + s.color });
    wrap.appendChild(el("div", { class: "shead" }, [
      el("a", { class: "back", href: "#", onclick: function (e) { e.preventDefault(); location.hash = ""; onRoute(); }, text: "← All sections" }),
      el("h2", { class: "stitle", tabindex: "-1", id: "stitle", text: s.title }), el("span", { class: "dim", text: s.blurb })
    ]));
    var mine = warns.filter(function (w) { return w.sec === id; });
    if (mine.length) wrap.appendChild(warningList(mine, false));
    wrap.appendChild({ start: startScreen, role: roleScreen, background: backgroundScreen, equipment: equipmentScreen, info: infoScreen, stats: statsScreen, feats: featsScreen }[id](t));
    return wrap;
  }
  function onRoute() { render(); var h = document.getElementById("stitle"); window.scrollTo(0, 0); if (h) h.focus({ preventScroll: true }); }

  function startScreen(t) {
    var body = el("div", { class: "pane" });
    body.appendChild(el("label", { class: "fld", for: "char-name" }, [el("span", { text: "Name" }),
      el("input", { id: "char-name", type: "text", value: C.identity.name, oninput: function (e) { C.identity.name = e.target.value; saveDraft(); } })]));
    body.appendChild(el("h3", { text: "Start type" }));
    var opts = el("div", { class: "starts", role: "radiogroup", "aria-label": "Start type" }, D.startTypes.map(function (s) {
      var on = s.id === C.start.type;
      return el("button", { type: "button", role: "radio", "aria-checked": on ? "true" : "false", class: "startopt" + (on ? " on" : ""), onclick: function () { C.start.type = s.id; commit(); } }, [
        el("strong", { text: s.name }), el("span", { class: "big", text: String(s.merit) }), el("span", { class: "dim", text: "merit" }),
        el("span", { class: "dim", text: "Stats up to " + s.statCap }), el("span", { class: "dim", text: "Feat tiers " + s.tiers.join(", ") })
      ]);
    }));
    body.appendChild(opts);
    body.appendChild(el("label", { class: "fld narrow", for: "earned" }, [el("span", { text: "Merit earned in play" }),
      el("input", { id: "earned", type: "number", min: "0", value: C.merit.earned, oninput: function (e) { C.merit.earned = Math.max(0, parseInt(e.target.value, 10) || 0); saveDraft(); updateTotalsOnly(); refreshWarnings(); } })]));
    return body;
  }

  function infoScreen() {
    var body = el("div", { class: "pane" });
    [["appearance", "Appearance", "Height, build, eyes, anything people notice."], ["notes", "Notes", "Anything else about your character."]].forEach(function (p) {
      body.appendChild(el("label", { class: "fld", for: "info-" + p[0] }, [el("span", { text: p[1] }),
        el("textarea", { id: "info-" + p[0], rows: "6", placeholder: p[2], oninput: function (e) { C.identity[p[0]] = e.target.value; saveDraft(); } }, [C.identity[p[0]] || ""])]));
    });
    return body;
  }

  function statsScreen(t) {
    var d = derivedBy(C.stats), cap = t.st.statCap;
    var row = el("div", { class: "orbs" });
    STATS.forEach(function (p) {
      var k = p[0], v = C.stats[k], over = v > cap;
      row.appendChild(el("section", { class: "orbcol" }, [
        el("div", { class: "orb" + (over ? " over" : ""), style: "--p:" + Math.round(v / 12 * 100) }, [el("output", { "aria-label": p[1] + " level", text: String(v) })]),
        el("h3", { text: p[1] }),
        el("div", { class: "ostep" }, [
          el("button", { type: "button", "aria-label": "Lower " + p[1], disabled: v <= 0, onclick: function () { setStat(k, v - 1); }, text: "−" }),
          el("span", { class: "dim", text: statCost(v) + " merit" }),
          el("button", { type: "button", "aria-label": "Raise " + p[1], disabled: v >= 12, onclick: function () { setStat(k, v + 1); }, text: "+" })
        ]),
        el("ul", { class: "dvals" }, d[k].map(function (x) { return el("li", {}, [el("span", { text: x[0] }), el("strong", { text: String(x[1]) })]); }))
      ]));
    });
    var wrap = el("div", { class: "pane" }, [row,
      el("p", { class: "hint", text: "Cap for a " + t.st.name + " start: " + cap + ". Raising a stat to level n costs 3n merit." })]);
    return wrap;
  }

  function featsScreen(t) {
    var grid = el("div", { class: "fgrid" });
    grid.appendChild(featBrowser(t)); grid.appendChild(chosenPanel());
    return grid;
  }
  function chosenPanel() {
    var items = C.feats.map(function (e, i) {
      var f = featById(e.id), name = f ? f.name : e.id;
      var kids = [el("span", { class: "fn", text: name }), el("span", { class: "dim", text: f ? "Tier " + f.tier + " " + f.tree + " · " + f.cost : "unknown" })];
      if (f && f.choice) kids.push(el("input", Object.assign({ id: "fc-" + i, type: "text", class: "fchoice", placeholder: f.choice, "aria-label": name + ": " + f.choice, value: e.choice || "", oninput: function (ev) { e.choice = ev.target.value; saveDraft(); updateTotalsOnly(); refreshWarnings(); } }, choiceAttrs(f.id))));
      kids.push(el("button", { type: "button", class: "x", "aria-label": "Remove " + name, onclick: function () { removeFeat(i); }, text: "Remove" }));
      return el("li", {}, kids);
    });
    return el("aside", { class: "chosenpanel" }, [el("h3", { text: "Chosen (" + C.feats.length + ")" }),
      items.length ? el("ul", { class: "chosen" }, items) : el("p", { class: "hint", text: "No feats yet." })]);
  }

  function featBrowser(t) {
    var tabs = el("div", { class: "tabs", role: "tablist" }, trees().map(function (tr) {
      var on = ui.tree === tr && !ui.q;
      return el("button", { type: "button", role: "tab", "aria-selected": on ? "true" : "false", class: on ? "on" : "", style: "--sec:" + treeColor(tr), onclick: function () { ui.tree = tr; ui.q = ""; ui.open = {}; render(); }, text: tr });
    }));
    var search = el("label", { class: "fld", for: "feat-q" }, [el("span", { class: "sr", text: "Search feats" }),
      el("input", { id: "feat-q", type: "search", placeholder: "Search all feats", value: ui.q, oninput: function (e) { ui.q = e.target.value; render(); } })]);
    var q = ui.q.trim().toLowerCase();
    var list = D.feats.filter(function (f) { return q ? (f.name + " " + f.desc + " " + f.tags.join(" ")).toLowerCase().indexOf(q) >= 0 : f.tree === ui.tree; });
    var out = [search, tabs], sec = q ? "var(--sec)" : treeColor(ui.tree);
    if (!list.length) out.push(el("p", { class: "hint", text: "No feats match." }));
    [1, 2, 3, 4].forEach(function (tier) {
      var group = list.filter(function (f) { return f.tier === tier; });
      if (!group.length) return;
      var allowed = t.st.tiers.indexOf(tier) >= 0;
      out.push(el("h3", { class: "tier" + (allowed ? "" : " locked") }, [document.createTextNode("Tier " + tier), allowed ? null : el("span", { class: "dim", text: "  not available at a " + t.st.name + " start" })]));
      group.forEach(function (f) { out.push(featRow(f, allowed)); });
    });
    return el("section", { class: "browser", style: q ? "" : "--sec:" + sec }, out);
  }

  function featRow(f, allowed) {
    var count = C.feats.filter(function (e) { return e.id === f.id; }).length;
    var taken = count > 0 && !f.multi, open = !!ui.open[f.id], cid = "choice-" + f.id.replace(/\W/g, "-");
    var sum = el("button", { type: "button", class: "fsum", "aria-expanded": open ? "true" : "false", style: "--sec:" + treeColor(f.tree), onclick: function () { var was = open; ui.open = {}; if (!was) ui.open[f.id] = true; render(); } }, [
      el("span", { class: "fname", text: f.name }),
      count ? el("span", { class: "tag", text: "Taken" + (count > 1 ? " ×" + count : "") }) : null,
      f.multi ? el("span", { class: "dim", text: "repeatable" }) : null,
      el("span", { class: "fcost", text: f.cost })
    ]);
    var row = el("article", { class: "frow" + (count ? " has" : "") + (allowed ? "" : " dimmed"), style: "--sec:" + treeColor(f.tree) }, [sum]);
    if (open) {
      var body = el("div", { class: "fbody" }, [el("p", { class: "fdesc", text: f.desc })]);
      if (f.tags.length) body.appendChild(el("p", { class: "ftags" }, f.tags.map(function (g) { return el("span", { class: "chip", text: g }); })));
      if (f.prereqNote) body.appendChild(el("p", { class: "dim", text: f.prereqNote }));
      var act = el("div", { class: "fact" });
      var inp = f.choice ? el("input", Object.assign({ id: cid, type: "text", placeholder: f.choice, "aria-label": f.name + ": " + f.choice }, choiceAttrs(f.id))) : null;
      if (inp) act.appendChild(inp);
      act.appendChild(el("button", { type: "button", class: "primary", disabled: taken, onclick: function () { addFeat(f, inp ? inp.value : ""); }, text: taken ? "Taken" : "Add for " + f.cost }));
      body.appendChild(act); row.appendChild(body);
    }
    return row;
  }


  /* ---------- equipment ---------- */
  var eq = { cat: "Weapons", q: "", open: {} };
  var HIDDEN_CATS = ["Property"];   // lodging is gated by total merit, not bought
  var CAT_ORDER = ["Weapons", "Armour", "Clothes & Other Items", "Survival Equipment", "Food", "Medical", "Specialized Equipment", "Crafting Materials", "Natural Resources", "Chemicals & Other Consumables", "Illicit Materials", "Vehicle"];
  function nextUid() { var m = 0; C.equipment.inventory.forEach(function (e) { var x = /^i(\d+)$/.exec(e.uid); if (x) m = Math.max(m, +x[1]); }); return "i" + (m + 1); }
  function addItem(it) {
    var inv = C.equipment.inventory;
    if (stackable(it)) {
      var same = inv.filter(function (e) { return e.id === it.id; })[0];
      if (same) { same.qty++; commit(); return; }
    }
    inv.push({ uid: nextUid(), id: it.id, quality: "quality:normal", condition: "", name: "", qty: 1, equipped: false, slots: [] });
    commit();
  }
  function removeItem(uid) { C.equipment.inventory = C.equipment.inventory.filter(function (e) { return e.uid !== uid; }); commit(); }
  function itemFacts(it) {
    var f = [];
    if (it.cat === "Weapons") { f.push(it.range); f.push("+" + (it.bonus || 0) + " dice"); f.push(it.dtype); }
    if (wearable(it) && it.guard != null) f.push("Guard " + it.guard);
    if (it.slots && it.slots.length) f.push(it.slots.join(", "));
    if (it.cat === "Vehicle") { f.push(it.passengers + " passengers"); f.push("handling " + it.handling); }
    return f.filter(Boolean).join(" · ");
  }
  function shopRow(it) {
    var open = !!eq.open[it.id];
    var sum = el("button", { type: "button", class: "fsum", "aria-expanded": open ? "true" : "false", onclick: function () { var was = open; eq.open = {}; if (!was) eq.open[it.id] = true; render(); } }, [
      el("span", { class: "fname", text: it.name }), el("span", { class: "dim", text: itemFacts(it) }), el("span", { class: "fcost", text: it.cost })
    ]);
    var row = el("article", { class: "frow" }, [sum]);
    if (open) {
      var body = el("div", { class: "fbody" }, [el("p", { class: "fdesc", text: it.desc })]);
      (it.abilities || []).forEach(function (a) { body.appendChild(el("p", {}, [el("strong", { text: a.name + ". " }), document.createTextNode(a.text)])); });
      if (it.effects && it.effects !== "N/A") body.appendChild(el("p", {}, [el("strong", { text: "Effects. " }), document.createTextNode(it.effects)]));
      if (it.tags && it.tags.length) body.appendChild(el("p", { class: "ftags" }, it.tags.map(function (g) { return el("span", { class: "chip", text: g }); })));
      body.appendChild(el("div", { class: "fact" }, [el("button", { type: "button", class: "primary", onclick: function () { addItem(it); }, text: "Add for " + it.cost })]));
      row.appendChild(body);
    }
    return row;
  }
  function shop() {
    var cats = CAT_ORDER.filter(function (c) { return D.items.some(function (i) { return i.cat === c; }); });
    var tabs = el("div", { class: "tabs", role: "tablist" }, cats.map(function (c) {
      var on = eq.cat === c && !eq.q;
      return el("button", { type: "button", role: "tab", "aria-selected": on ? "true" : "false", class: on ? "on" : "", onclick: function () { eq.cat = c; eq.q = ""; eq.open = {}; render(); }, text: c });
    }));
    var search = el("label", { class: "fld", for: "eq-q" }, [el("span", { class: "sr", text: "Search items" }),
      el("input", { id: "eq-q", type: "search", placeholder: "Search all items", value: eq.q, oninput: function (e) { eq.q = e.target.value; render(); } })]);
    var q = eq.q.trim().toLowerCase();
    var list = D.items.filter(function (i) { return HIDDEN_CATS.indexOf(i.cat) >= 0 ? false : q ? (i.name + " " + i.desc).toLowerCase().indexOf(q) >= 0 : i.cat === eq.cat; });
    var out = [search, tabs];
    if (!list.length) out.push(el("p", { class: "hint", text: "No items match." }));
    list.forEach(function (i) { out.push(shopRow(i)); });
    return el("section", { class: "browser" }, out);
  }
  function selectEl(id, label, options, value, onchange) {
    return el("label", { class: "fld narrow", for: id }, [el("span", { text: label }),
      el("select", { id: id, onchange: function (e) { onchange(e.target.value); } }, options.map(function (o) {
        return el("option", { value: o[0], selected: o[0] === value ? "selected" : null, text: o[1] });
      }))]);
  }
  function invRow(e) {
    var it = itemById(e.id);
    if (!it) return el("article", { class: "frow" }, [el("p", { class: "dim", text: "Unknown item " + e.id })]);
    var title = e.name || it.name, bits = [];
    if (wearable(it) && it.guard > 0) bits.push("Guard " + effGuard(e, it));
    if (it.cat === "Weapons") bits.push("+" + effBonus(e, it) + " dice");
    var head = el("div", { class: "invhead" }, [
      el("strong", { text: title + (e.name ? " (" + it.name + ")" : "") + (e.qty > 1 ? " ×" + e.qty : "") }),
      el("span", { class: "dim", text: bits.join(" · ") }), el("span", { class: "fcost", text: entryCost(e) })
    ]);
    var ctl = el("div", { class: "invctl" });
    if (stackable(it)) {
      ctl.appendChild(el("div", { class: "stepper", role: "group", "aria-label": "Quantity of " + title }, [
        el("button", { type: "button", "aria-label": "One fewer", disabled: e.qty <= 1, onclick: function () { e.qty--; commit(); }, text: "−" }),
        el("span", { class: "qty", text: String(e.qty) }),
        el("button", { type: "button", "aria-label": "One more", onclick: function () { e.qty++; commit(); }, text: "+" })
      ]));
    }
    if (qualityable(it)) {
      ctl.appendChild(selectEl("q-" + e.uid, "Quality", D.qualities.map(function (q) { return [q.id, q.name + (q.mod ? " (" + (q.mod > 0 ? "+" : "") + q.mod + ")" : "")]; }), e.quality, function (v) { e.quality = v; commit(); }));
      ctl.appendChild(selectEl("c-" + e.uid, "Condition", [["", "None"]].concat(D.conditions.map(function (c) { return [c.id, c.name]; })), e.condition, function (v) { e.condition = v; commit(); }));
      ctl.appendChild(el("label", { class: "fld narrow", for: "n-" + e.uid }, [el("span", { text: "Custom name" }),
        el("input", { id: "n-" + e.uid, type: "text", value: e.name, placeholder: it.name, oninput: function (ev) { e.name = ev.target.value; saveDraft(); } })]));
    }
    if (wearable(it)) {
      ctl.appendChild(el("label", { class: "chk" }, [
        el("input", { type: "checkbox", checked: e.equipped ? "checked" : null, onchange: function (ev) { e.equipped = ev.target.checked; commit(); } }), document.createTextNode(" Worn")]));
      if (it.slots && it.slots.indexOf("Variable") >= 0) {
        ctl.appendChild(el("fieldset", { class: "slotpick" }, [el("legend", { text: "Slots it covers" })].concat(["Head", "Torso", "Arms", "Hands", "Legs", "Feet", "Accessories", "Over", "Under"].map(function (sl) {
          return el("label", { class: "chk" }, [el("input", { type: "checkbox", checked: e.slots.indexOf(sl) >= 0 ? "checked" : null, onchange: function (ev) {
            e.slots = e.slots.filter(function (x) { return x !== sl; }); if (ev.target.checked) e.slots.push(sl); commit(); } }), document.createTextNode(" " + sl)]);
        }))));
      }
    }
    ctl.appendChild(el("button", { type: "button", class: "linkbtn", onclick: function () { removeItem(e.uid); }, text: "Remove" }));
    return el("article", { class: "frow has invrow" }, [head, ctl]);
  }
  function equipmentScreen(t) {
    var body = el("div", { class: "pane" }), gi = guardInfo();
    var inv = C.equipment.inventory;
    body.appendChild(el("p", { class: "hint", text: "Gear costs merit. Quality changes the price and, for armour and weapons, the bonus. Guard from worn gear counts up to " + D.guardCap + "." }));
    var bx = el("section", { class: "bcard" }, [el("h3", { text: "Carried (" + t.gear + " merit)" })]);
    if (!inv.length) bx.appendChild(el("p", { class: "dim", text: "Nothing yet. Add items from the shop below." }));
    inv.forEach(function (e) { bx.appendChild(invRow(e)); });
    var worn = {};
    inv.forEach(function (e) { var it = itemById(e.id); if (it && wearable(it) && e.equipped) entrySlots(e, it).forEach(function (x) { (worn[x] = worn[x] || []).push(e.name || it.name); }); });
    var slotLine = Object.keys(worn).map(function (x) { return x + ": " + worn[x].join(", "); }).join(" · ");
    bx.appendChild(el("p", { class: "guardline" }, [el("strong", { text: "Guard " + gi.total }),
      document.createTextNode(" (worn " + gi.sum + (gi.sum > gi.capped ? ", capped at " + gi.capped : "") + (gi.other ? ", plus " + gi.other + " from Thick-Skinned" : "") + ")" + (slotLine ? "  " + slotLine : ""))]));
    body.appendChild(bx);
    body.appendChild(el("h3", { text: "Shop" }));
    body.appendChild(shop());
    return body;
  }

  /* ---------- role, background, languages ---------- */
  function optionsFor(featId) {
    var key = featId.replace("feat:", "");
    if (key === "polyglot") return D.languages.map(function (l) { return l.name.split("(")[0].trim(); });
    return (D.choiceOptions || {})[key] || null;
  }
  function dlId(featId) { return "opts-" + featId.replace(/\W/g, "-"); }
  function mountDatalists() {
    var old = document.getElementById("builder-lists"); if (old) old.remove();
    var box = el("div", { id: "builder-lists", hidden: true });
    var ids = ["feat:polyglot"].concat(Object.keys(D.choiceOptions || {}).map(function (k) { return "feat:" + k; }));
    ids.forEach(function (id) { var o = optionsFor(id); if (o) box.appendChild(el("datalist", { id: dlId(id) }, o.map(function (v) { return el("option", { value: v }); }))); });
    document.body.appendChild(box);
  }
  function choiceAttrs(featId) { return optionsFor(featId) ? { list: dlId(featId) } : {}; }

  function setRole(id) { C.role.id = id; if (id !== "role:constable") C.role.styles = ["", ""]; commit(); }
  function setBackground(id) {
    var bg = bgById(id); if (!bg) return;
    var keep = {}; C.background.feats.forEach(function (e) { keep[e.id] = e.choice; });
    var sc = sizeChoices(bg);
    C.background = { id: id, size: sc.length ? sc[0] : null, vision: [],
      feats: bg.feats.map(function (f) { var e = { id: f.id }; if (f.choice) e.choice = keep[f.id] || ""; return e; }) };
    commit();
  }
  function toggleLanguage(id) {
    var i = C.languages.indexOf(id); if (i >= 0) C.languages.splice(i, 1); else C.languages.push(id); commit();
  }
  function pill(label, on, onclick, extra) {
    return el("button", { type: "button", class: "pillbtn" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", title: extra || null, onclick: onclick, text: label });
  }

  function roleScreen() {
    var cur = roleById(C.role.id), body = el("div", { class: "pane" });
    body.appendChild(el("p", { class: "hint", text: "You may pick one role. Roles cannot overlap between players, so talk it over with your group. The role feat is free." }));
    var list = el("div", { class: "pills", role: "group", "aria-label": "Roles" }, [pill("No role", !cur, function () { setRole(""); })]);
    D.roles.forEach(function (r) { list.appendChild(pill(r.name, cur && cur.id === r.id, function () { setRole(r.id); })); });
    body.appendChild(list);
    if (cur) {
      body.appendChild(el("article", { class: "rolecard" }, [el("h3", { text: cur.feat }), el("p", { class: "dim", text: cur.name + " role feat · free" }), el("p", { text: cur.desc })]));
      if (cur.id === "role:constable") {
        body.appendChild(el("p", { class: "hint", text: "Name the two different fighting styles you get as free Combat Expertise." }));
        [0, 1].forEach(function (i) {
          body.appendChild(el("label", { class: "fld narrow", for: "role-style-" + i }, [el("span", { text: "Fighting style " + (i + 1) }),
            el("input", Object.assign({ id: "role-style-" + i, type: "text", value: C.role.styles[i], placeholder: "e.g. Melee", oninput: function (e) { C.role.styles[i] = e.target.value; saveDraft(); refreshWarnings(); } }, choiceAttrs("feat:combat-expertise")))]));
        });
      }
      if (cur.id === "role:falconer") {
        body.appendChild(el("p", { class: "hint", text: "Your companion: a creature of your choosing, within reason." }));
        [["name", "Companion name"], ["creature", "Kind of creature"]].forEach(function (p) {
          body.appendChild(el("label", { class: "fld narrow", for: "comp-" + p[0] }, [el("span", { text: p[1] }),
            el("input", { id: "comp-" + p[0], type: "text", value: C.companion[p[0]], oninput: function (e) { C.companion[p[0]] = e.target.value; saveDraft(); } })]));
        });
      }
    }
    return body;
  }

  function backgroundScreen(t) {
    var bg = bgById(C.background.id), body = el("div", { class: "pane" });
    body.appendChild(el("h3", { text: "Background" }));
    var list = el("div", { class: "pills", role: "group", "aria-label": "Backgrounds" });
    D.backgrounds.forEach(function (b) { list.appendChild(pill(b.name, bg && bg.id === b.id, function () { setBackground(b.id); })); });
    body.appendChild(list);
    if (bg) {
      body.appendChild(el("article", { class: "rolecard" }, [el("h3", { text: bg.name }), el("p", { text: bg.about }),
        el("p", {}, [el("strong", { text: "Naming. " }), document.createTextNode(bg.naming)]),
        el("p", {}, [el("strong", { text: "Appearance. " }), document.createTextNode(bg.appearance)])]));

      body.appendChild(el("h3", { text: "Size class" }));
      body.appendChild(el("p", { class: "hint", text: "Your background's range is " + bg.sizeText + ". Size class 1 fills one 5-foot square; 2 fills four." }));
      body.appendChild(el("div", { class: "pills", role: "group", "aria-label": "Size class" }, sizeChoices(bg).map(function (v) {
        return pill(sizeLabel(v), C.background.size === v, function () { C.background.size = v; commit(); });
      })));

      body.appendChild(el("h3", { text: "Vision" }));
      if (bg.visionMode === "choose") {
        body.appendChild(el("p", { class: "hint", text: "Choose one." }));
        body.appendChild(el("div", { class: "pills", role: "group", "aria-label": "Vision" }, bg.vision.map(function (v) {
          return pill(v, C.background.vision[0] === v, function () { C.background.vision = [v]; commit(); });
        })));
      } else {
        body.appendChild(el("p", { class: "ftags" }, bg.vision.map(function (v) { return el("span", { class: "chip", text: v }); })));
      }
      if (hasFeat("feat:third-eye")) body.appendChild(el("p", { class: "ftags" }, [el("span", { class: "chip", text: "Aethersight (Third Eye)" })]));

      body.appendChild(el("h3", { text: "Movement" }));
      var tempo = 2 + Math.ceil(C.stats.body / 2);
      var mv = movement();
      body.appendChild(el("div", { class: "tablewrap narrowtable" }, [el("table", { class: "dtable" }, [
        el("thead", {}, [el("tr", {}, ["Type", "Modifier", "Speed"].map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", {}, mv.map(function (m) {
          return el("tr", {}, [el("td", { text: m.type }), el("td", { text: (m.mod >= 0 ? "+" : "") + m.mod + (m.extra ? " (Movement Expertise +" + m.extra + ")" : "") }), el("td", { class: "num", text: String(m.speed) })]);
        }))]), ]));
      body.appendChild(el("p", { class: "hint", text: "Speed is Tempo (" + tempo + ") plus the modifier, never below 1. Jump is half your Tempo, rounded down, minimum 1." }));

      body.appendChild(el("h3", { text: "Background feats (free)" }));
      bg.feats.forEach(function (f) {
        var mine = C.background.feats.filter(function (e) { return e.id === f.id; })[0];
        var kids = [el("h4", { text: f.name }), el("p", { text: f.desc })];
        if (f.choice && mine) kids.push(el("label", { class: "fld narrow", for: "bgf-" + f.id.replace(/\W/g, "-") }, [el("span", { text: f.choice }),
          el("input", Object.assign({ id: "bgf-" + f.id.replace(/\W/g, "-"), type: "text", value: mine.choice || "", oninput: function (e) { mine.choice = e.target.value; saveDraft(); refreshWarnings(); } }, choiceAttrs(f.id)))]));
        body.appendChild(el("article", { class: "rolecard" }, kids));
      });
    }

    body.appendChild(el("h3", { text: "Languages" }));
    body.appendChild(el("p", { class: "hint", text: "Choose two to start (" + C.languages.length + " chosen). Each Polyglot feat adds one more; pick that one on the feat." }));
    body.appendChild(el("div", { class: "pills", role: "group", "aria-label": "Languages" }, D.languages.map(function (l) {
      return pill(l.name, C.languages.indexOf(l.id) >= 0, function () { toggleLanguage(l.id); }, "Spoken by: " + l.spoken);
    })));
    var poly = C.feats.filter(function (e) { return e.id === "feat:polyglot" && (e.choice || "").trim(); }).map(function (e) { return e.choice.trim(); });
    if (poly.length) body.appendChild(el("p", { class: "hint", text: "From Polyglot: " + poly.join(", ") + "." }));
    return body;
  }

  /* ---------- start ---------- */
  window.addEventListener("hashchange", function () { if (D) onRoute(); });
  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    D = d; mountDatalists(); C = normalize(loadDraft() || blank());
    if (loadDraft()) ui.notice = "Restored your last draft from this browser. Save a file to keep it safe.";
    render();
  }).catch(function () { app.textContent = "The rules data could not be loaded."; });
})();
