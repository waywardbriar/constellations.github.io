/* Constellations character builder, slice 1: bubble hub, start, info, stats, feats, save/load.
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
  var STATS = [["mind", "Mind"], ["body", "Body"], ["soul", "Soul"]];
  function derivedBy(s) {
    return {
      mind: [["Scope", 1 + s.mind], ["Reputation", 1 + Math.floor(s.mind / 2)], ["Poise", 1 + Math.ceil(s.mind / 2)]],
      body: [["Stamina", 5 + s.body], ["Injury Slots", 2 + s.body], ["Tempo", 2 + Math.ceil(s.body / 2)]],
      soul: [["Exertion", s.soul + 2], ["Grit", 1 + Math.floor(s.soul / 2)], ["Stability", 1 + Math.ceil(s.soul / 2)]]
    };
  }
  function totals() {
    var st = startType(C.start.type), stats = 0, feats = 0;
    STATS.forEach(function (p) { stats += statCost(C.stats[p[0]]); });
    C.feats.forEach(function (e) { var f = featById(e.id); if (f) feats += f.cost; });
    var total = st.merit + (C.merit.earned || 0), spent = stats + feats;
    return { st: st, stats: stats, feats: feats, total: total, spent: spent, remaining: total - spent };
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
    { id: "info", title: "Info", color: "#FFC27A", blurb: "Looks and notes" },
    { id: "stats", title: "Stats", color: "#F28AB8", blurb: "Mind, Body, Soul" },
    { id: "feats", title: "Feats", color: "#B79CF2", blurb: "Skills and talents" }
  ];
  var SOON = ["Role", "Background", "Equipment", "Spells"];
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
    if (id === "info") return C.identity.name ? C.identity.name : "Unnamed";
    if (id === "stats") return "M" + C.stats.mind + " · B" + C.stats.body + " · S" + C.stats.soul;
    if (id === "feats") return C.feats.length + (C.feats.length === 1 ? " feat" : " feats");
    return "";
  }
  function hub(t, warns) {
    var wrap = el("div", {});
    wrap.appendChild(el("p", { class: "hubline", text: (C.identity.name || "Your character") + " · " + t.st.name + " start. Pick a bubble to build that part." }));
    var ring = el("nav", { class: "hub", "aria-label": "Character sections" });
    SECS.forEach(function (s) {
      var n = warns.filter(function (w) { return w.sec === s.id; }).length;
      ring.appendChild(el("a", { class: "bub", href: "#" + s.id, style: "--sec:" + s.color }, [
        el("span", { class: "bt", text: s.title }), el("span", { class: "bs", text: bubbleStatus(s.id, t) }),
        n ? el("span", { class: "bw", "aria-label": n + " warnings", text: String(n) }) : null
      ]));
    });
    SOON.forEach(function (name) {
      ring.appendChild(el("span", { class: "bub soon", "aria-disabled": "true" }, [el("span", { class: "bt", text: name }), el("span", { class: "bs", text: "Coming soon" })]));
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
    wrap.appendChild({ start: startScreen, info: infoScreen, stats: statsScreen, feats: featsScreen }[id](t));
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
    body.appendChild(el("p", { class: "hint", text: "Role, background, size class and languages will live here once those slices are built." }));
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
      if (f && f.choice) kids.push(el("input", { id: "fc-" + i, type: "text", class: "fchoice", placeholder: f.choice, "aria-label": name + ": " + f.choice, value: e.choice || "", oninput: function (ev) { e.choice = ev.target.value; saveDraft(); updateTotalsOnly(); refreshWarnings(); } }));
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
      var inp = f.choice ? el("input", { id: cid, type: "text", placeholder: f.choice, "aria-label": f.name + ": " + f.choice }) : null;
      if (inp) act.appendChild(inp);
      act.appendChild(el("button", { type: "button", class: "primary", disabled: taken, onclick: function () { addFeat(f, inp ? inp.value : ""); }, text: taken ? "Taken" : "Add for " + f.cost }));
      body.appendChild(act); row.appendChild(body);
    }
    return row;
  }

  /* ---------- start ---------- */
  window.addEventListener("hashchange", function () { if (D) onRoute(); });
  fetch("data.json").then(function (r) { return r.json(); }).then(function (d) {
    D = d; C = normalize(loadDraft() || blank());
    if (loadDraft()) ui.notice = "Restored your last draft from this browser. Save a file to keep it safe.";
    render();
  }).catch(function () { app.textContent = "The rules data could not be loaded."; });
})();
