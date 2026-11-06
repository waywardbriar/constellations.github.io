/* Constellations character builder, pass 1: start type, stats, feats, merit, save/load.
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
      stats: { mind: 0, body: 0, soul: 0 },
      feats: [],
      merit: { starting: 0, earned: 0, spent: 0, remaining: 0 }
    };
  }
  function startType(id) { return D.startTypes.filter(function (s) { return s.id === id; })[0] || D.startTypes[0]; }
  function featById(id) { return D.feats.filter(function (f) { return f.id === id; })[0]; }

  /* ---------- rules math ---------- */
  function statCost(level) { var t = 0; for (var i = 0; i < level; i++) t += D.statCosts[i] != null ? D.statCosts[i] : 3 * (i + 1); return t; }
  function derived(s) {
    var body = s.body, mind = s.mind, soul = s.soul;
    return [
      ["Stamina", 5 + body, "5 + Body"],
      ["Injury Slots", 2 + body, "2 + Body"],
      ["Tempo", 2 + Math.ceil(body / 2), "2 + half Body, rounded up"],
      ["Exertion", soul + 2, "Soul + 2"],
      ["Grit", 1 + Math.floor(soul / 2), "1 + half Soul, rounded down"],
      ["Stability", 1 + Math.ceil(soul / 2), "1 + half Soul, rounded up"],
      ["Scope", 1 + mind, "1 + Mind"],
      ["Reputation", 1 + Math.floor(mind / 2), "1 + half Mind, rounded down"],
      ["Poise", 1 + Math.ceil(mind / 2), "1 + half Mind, rounded up"]
    ];
  }
  function totals() {
    var st = startType(C.start.type), stats = 0, feats = 0;
    ["mind", "body", "soul"].forEach(function (k) { stats += statCost(C.stats[k]); });
    C.feats.forEach(function (e) { var f = featById(e.id); if (f) feats += f.cost; });
    var total = st.merit + (C.merit.earned || 0), spent = stats + feats;
    return { st: st, stats: stats, feats: feats, total: total, spent: spent, remaining: total - spent };
  }
  function sync() { var t = totals(); C.merit.starting = t.st.merit; C.merit.spent = t.spent; C.merit.remaining = t.remaining; return t; }

  function warnings() {
    var w = [], t = totals(), st = t.st;
    if (t.remaining < 0) w.push("You have spent " + (-t.remaining) + " more merit than you have.");
    [["mind", "Mind"], ["body", "Body"], ["soul", "Soul"]].forEach(function (p) {
      var v = C.stats[p[0]];
      if (v > st.statCap) w.push(p[1] + " is " + v + ", above the " + st.name + " start cap of " + st.statCap + ".");
      if (v > 12) w.push(p[1] + " is above 12; the guide says your GM sets the cost.");
    });
    var have = {}; C.feats.forEach(function (e) { have[e.id] = (have[e.id] || 0) + 1; });
    var seen = {};
    C.feats.forEach(function (e) {
      var f = featById(e.id), label;
      if (!f) { w.push("Unknown feat in the file: " + e.id + "."); return; }
      label = f.name + (e.choice ? " (" + e.choice + ")" : "");
      if (st.tiers.indexOf(f.tier) < 0) w.push(label + " is Tier " + f.tier + "; a " + st.name + " start allows Tiers " + st.tiers.join(", ") + ".");
      if (f.tier > 1) {
        var lower = C.feats.some(function (o) { var g = featById(o.id); return g && g.tree === f.tree && g.tier === f.tier - 1; });
        if (!lower) w.push(label + " needs a Tier " + (f.tier - 1) + " " + f.tree + " feat first.");
      }
      (f.prereqs || []).forEach(function (grp) {
        if (!grp.some(function (id) { return have[id]; })) w.push(label + " needs " + grp.map(function (id) { var g = featById(id); return g ? g.name : id; }).join(" or ") + ".");
      });
      if (f.prereqNote) w.push(label + ": " + f.prereqNote);
      if (f.choice && !(e.choice || "").trim()) w.push(f.name + " needs a choice (" + f.choice.toLowerCase() + ").");
      var key = e.id + "|" + (e.choice || "").trim().toLowerCase();
      if (seen[key]) w.push(label + " is taken twice" + (f.multi ? " with the same choice." : ".") );
      seen[key] = 1;
      if (!f.multi && have[e.id] > 1 && !seen["m" + e.id]) { seen["m" + e.id] = 1; w.push(f.name + " can only be taken once."); }
    });
    return w;
  }

  /* ---------- persistence ---------- */
  function saveDraft() { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(C)); } catch (e) {} }
  function loadDraft() { try { var s = localStorage.getItem(DRAFT_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; } }
  function normalize(obj) {
    var b = blank(), o = obj || {};
    var c = JSON.parse(JSON.stringify(o));               // keeps unknown blocks (role, background, equipment, ...) for later passes
    c.file = c.file || {}; c.file.schemaVersion = SCHEMA; c.file.rulesVersion = c.file.rulesVersion || D.rulesVersion;
    c.identity = Object.assign(b.identity, c.identity || {});
    c.start = Object.assign(b.start, c.start || {});
    if (!D.startTypes.some(function (s) { return s.id === c.start.type; })) c.start.type = b.start.type;
    c.stats = Object.assign(b.stats, c.stats || {});
    ["mind", "body", "soul"].forEach(function (k) { c.stats[k] = Math.max(0, Math.min(99, parseInt(c.stats[k], 10) || 0)); });
    c.feats = (c.feats || []).filter(function (e) { return e && e.id; });
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

  /* ---------- rendering ---------- */
  function render() {
    var active = document.activeElement, activeId = active && active.id, selStart = active && active.selectionStart;
    var t = sync(), warns = warnings();
    app.innerHTML = "";
    app.appendChild(summaryBar(t, warns));
    var grid = el("div", { class: "bgrid" });
    var left = el("div", { class: "bcol" }), right = el("div", { class: "bcol" });
    left.appendChild(identityCard()); left.appendChild(statsCard(t)); left.appendChild(chosenCard());
    right.appendChild(featBrowser(t)); right.appendChild(warningsCard(warns));
    grid.appendChild(left); grid.appendChild(right); app.appendChild(grid);
    if (activeId) { var n = document.getElementById(activeId); if (n) { n.focus(); try { if (selStart != null) n.setSelectionRange(selStart, selStart); } catch (e) {} } }
  }

  function summaryBar(t, warns) {
    var bar = el("div", { class: "bsum" });
    function cell(label, val, cls) { return el("div", { class: "bcell " + (cls || "") }, [el("span", { class: "bl", text: label }), el("strong", { text: String(val) })]); }
    bar.appendChild(cell("Merit available", t.total));
    bar.appendChild(cell("Stats", t.stats)); bar.appendChild(cell("Feats", t.feats));
    bar.appendChild(cell("Remaining", t.remaining, t.remaining < 0 ? "bad" : ""));
    bar.appendChild(cell("Warnings", warns.length, warns.length ? "warn" : ""));
    var tools = el("div", { class: "btools" }, [
      el("button", { type: "button", class: "primary", onclick: download, text: "Save file" }),
      el("label", { class: "btn", for: "loadfile", text: "Load file" }),
      el("input", { id: "loadfile", type: "file", accept: ".json,application/json", class: "sr", onchange: function (e) { if (e.target.files[0]) upload(e.target.files[0]); e.target.value = ""; } }),
      el("button", { type: "button", onclick: function () { if (ui.confirmReset) { C = blank(); ui.confirmReset = false; ui.notice = "Started a new character."; commit(); } else { ui.confirmReset = true; ui.notice = "Press Start over again to clear this character."; render(); } }, text: ui.confirmReset ? "Really start over?" : "Start over" })
    ]);
    bar.appendChild(tools);
    if (ui.notice) bar.appendChild(el("p", { class: "bnote", text: ui.notice }));
    return bar;
  }

  function card(title, kids, id) { return el("section", { class: "bcard", id: id || null }, [el("h2", { text: title })].concat(kids)); }

  function identityCard() {
    var st = startType(C.start.type);
    var sel = el("select", { id: "start-type", onchange: function (e) { C.start.type = e.target.value; commit(); } },
      D.startTypes.map(function (s) { return el("option", { value: s.id, selected: s.id === C.start.type, text: s.name + " (" + s.merit + " merit)" }); }));
    return card("Character", [
      el("label", { class: "fld", for: "char-name" }, [el("span", { text: "Name" }), el("input", { id: "char-name", type: "text", value: C.identity.name, oninput: function (e) { C.identity.name = e.target.value; saveDraft(); } })]),
      el("label", { class: "fld", for: "start-type" }, [el("span", { text: "Start type" }), sel]),
      el("p", { class: "hint", text: st.name + ": " + st.merit + " merit, stats up to " + st.statCap + ", feat tiers " + st.tiers.join(", ") + "." }),
      el("label", { class: "fld", for: "earned" }, [el("span", { text: "Merit earned in play" }), el("input", { id: "earned", type: "number", min: "0", value: C.merit.earned, oninput: function (e) { C.merit.earned = Math.max(0, parseInt(e.target.value, 10) || 0); saveDraft(); updateTotalsOnly(); }, onchange: function () { render(); } })])
    ]);
  }
  function updateTotalsOnly() { sync(); var b = document.querySelector(".bsum"); if (b) { var n = summaryBar(totals(), warnings()); b.replaceWith(n); } }

  function statsCard(t) {
    var st = t.st, rows = [];
    [["mind", "Mind"], ["body", "Body"], ["soul", "Soul"]].forEach(function (p) {
      var k = p[0], v = C.stats[k], over = v > st.statCap;
      rows.push(el("div", { class: "stat" + (over ? " over" : "") }, [
        el("span", { class: "sn", text: p[1] }),
        el("button", { type: "button", "aria-label": "Lower " + p[1], disabled: v <= 0, onclick: function () { setStat(k, v - 1); }, text: "−" }),
        el("output", { class: "sv", "aria-label": p[1] + " level", text: String(v) }),
        el("button", { type: "button", "aria-label": "Raise " + p[1], disabled: v >= 12, onclick: function () { setStat(k, v + 1); }, text: "+" }),
        el("span", { class: "sc", text: statCost(v) + " merit" })
      ]));
    });
    var tbl = el("table", { class: "dtable" }, [el("tbody", {}, derived(C.stats).map(function (d) {
      return el("tr", {}, [el("th", { text: d[0] }), el("td", { class: "num", text: String(d[1]) }), el("td", { class: "dim", text: d[2] })]);
    }))]);
    return card("Stats", [el("div", { class: "stats" }, rows), el("p", { class: "hint", text: "Level n costs 3n merit; raising a stat from n-1 to n costs 3n." }), el("h3", { text: "Calculated values" }), el("div", { class: "tablewrap" }, [tbl])]);
  }

  function chosenCard() {
    var items = C.feats.map(function (e, i) {
      var f = featById(e.id);
      var name = f ? f.name : e.id;
      var kids = [el("span", { class: "fn", text: name }), el("span", { class: "dim", text: f ? "Tier " + f.tier + " " + f.tree + " · " + f.cost : "unknown" })];
      if (f && f.choice) kids.push(el("input", { id: "fc-" + i, type: "text", class: "fchoice", placeholder: f.choice, "aria-label": name + ": " + f.choice, value: e.choice || "", oninput: function (ev) { e.choice = ev.target.value; saveDraft(); updateTotalsOnly(); refreshWarnings(); } }));
      kids.push(el("button", { type: "button", class: "x", "aria-label": "Remove " + name, onclick: function () { removeFeat(i); }, text: "Remove" }));
      return el("li", {}, kids);
    });
    return card("Chosen feats (" + C.feats.length + ")", [items.length ? el("ul", { class: "chosen" }, items) : el("p", { class: "hint", text: "No feats yet. Pick some from the list." })]);
  }
  function refreshWarnings() { var old = document.getElementById("warnings"); if (old) old.replaceWith(warningsCard(warnings())); }

  function warningsCard(w) {
    return card("Warnings", [w.length ? el("ul", { class: "warnlist" }, w.map(function (x) { return el("li", { text: x }); })) : el("p", { class: "hint", text: "Nothing breaks a rule right now." })], "warnings");
  }

  function featBrowser(t) {
    var trees = []; D.feats.forEach(function (f) { if (trees.indexOf(f.tree) < 0) trees.push(f.tree); });
    var tabs = el("div", { class: "tabs", role: "tablist" }, trees.map(function (tr) {
      return el("button", { type: "button", role: "tab", "aria-selected": ui.tree === tr && !ui.q ? "true" : "false", class: ui.tree === tr && !ui.q ? "on" : "", onclick: function () { ui.tree = tr; ui.q = ""; ui.open = {}; render(); }, text: tr });
    }));
    var search = el("label", { class: "fld", for: "feat-q" }, [el("span", { class: "sr", text: "Search feats" }), el("input", { id: "feat-q", type: "search", placeholder: "Search all feats", value: ui.q, oninput: function (e) { ui.q = e.target.value; render(); } })]);
    var q = ui.q.trim().toLowerCase();
    var list = D.feats.filter(function (f) { return q ? (f.name + " " + f.desc + " " + f.tags.join(" ")).toLowerCase().indexOf(q) >= 0 : f.tree === ui.tree; });
    var out = [search, tabs];
    if (!list.length) out.push(el("p", { class: "hint", text: "No feats match." }));
    [1, 2, 3, 4].forEach(function (tier) {
      var group = list.filter(function (f) { return f.tier === tier; });
      if (!group.length) return;
      var allowed = t.st.tiers.indexOf(tier) >= 0;
      out.push(el("h3", { class: "tier" + (allowed ? "" : " locked") }, [document.createTextNode("Tier " + tier), allowed ? null : el("span", { class: "dim", text: " (not available at a " + t.st.name + " start)" })]));
      group.forEach(function (f) { out.push(featCard(f)); });
    });
    return card("Feats", out);
  }

  function featCard(f) {
    var count = C.feats.filter(function (e) { return e.id === f.id; }).length;
    var taken = count > 0 && !f.multi;
    var open = !!ui.open[f.id];
    var head = el("div", { class: "fhead" }, [
      el("strong", { text: f.name }), el("span", { class: "dim", text: "Tier " + f.tier + " · " + f.cost + " merit" + (f.multi ? " · repeatable" : "") }),
      count ? el("span", { class: "tag", text: "Taken" + (count > 1 ? " ×" + count : "") }) : null
    ]);
    var actions = el("div", { class: "fact" });
    if (f.choice && open) {
      var inp = el("input", { id: "choice-" + f.id.replace(/\W/g, "-"), type: "text", placeholder: f.choice, "aria-label": f.name + ": " + f.choice });
      actions.appendChild(inp);
      actions.appendChild(el("button", { type: "button", class: "primary", onclick: function () { addFeat(f, inp.value); }, text: "Add" }));
      actions.appendChild(el("button", { type: "button", onclick: function () { ui.open = {}; render(); }, text: "Cancel" }));
    } else {
      actions.appendChild(el("button", { type: "button", disabled: taken, onclick: function () { if (f.choice) { ui.open = {}; ui.open[f.id] = true; render(); var n = document.getElementById("choice-" + f.id.replace(/\W/g, "-")); if (n) n.focus(); } else addFeat(f); }, text: taken ? "Taken" : "Add" }));
    }
    var kids = [head, el("p", { class: "fdesc", text: f.desc })];
    if (f.prereqNote) kids.push(el("p", { class: "dim", text: f.prereqNote }));
    kids.push(actions);
    return el("article", { class: "fcard" + (count ? " has" : "") }, kids);
  }

  /* ---------- start ---------- */
  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    D = d; C = normalize(loadDraft() || blank());
    if (loadDraft()) ui.notice = "Restored your last draft from this browser. Save a file to keep it safe.";
    render();
  }).catch(function () { app.textContent = "The rules data could not be loaded."; });
})();
