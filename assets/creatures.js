/* Constellations creature builder. Reads creature-data.json (built from the NPC Rules and Special Abilities documents),
   keeps a compendium in this browser, saves/loads it as a small file, and exports it to Word. */
(function () {
  "use strict";
  var KEY = "constellations-creature-compendium", DRAFT = "constellations-creature-draft";
  var app = document.getElementById("app");
  var D = null, LIB = [], CUR = null, editing = null, ui = { q: "", tag: "", notice: "", sure: null };

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
  function store(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function load(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function uid() { return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function blank() {
    return { id: uid(), name: "", translated: "", tier: "Ordinary", vigorAdj: 0, apAdj: 0, poolAdj: 0, movement: "Normal", demeanor: [], traits: [], desc: "", items: "" };
  }
  function tierOf(name) { return D.tiers.filter(function (t) { return t.name === name; })[0] || D.tiers[0]; }
  function tierIndex(name) { return D.tiers.map(function (t) { return t.name; }).indexOf(name); }
  function moveLabel(name) {
    var m = D.movement.filter(function (x) { return x.name === name; })[0];
    return m ? name + " · " + m.squares + (m.squares === 1 ? " square" : " squares") : name;
  }
  function derived(c) {
    var t = tierOf(c.tier), pool = t.pool + (+c.poolAdj || 0);
    c.traits.forEach(function (x) { pool += +x.poolMod || 0; });
    return { vigor: t.vigor + (+c.vigorAdj || 0), ap: t.ap + (+c.apAdj || 0), pool: Math.max(1, pool) };
  }
  function warnings(c) {
    var w = [], ti = tierIndex(c.tier);
    c.traits.forEach(function (x) {
      if (x.minTier === "Powerful" && ti < tierIndex("Powerful")) w.push(x.name + " is meant for Powerful and Mythic creatures.");
      if (x.minTier === "Mythic" && ti < tierIndex("Mythic")) w.push(x.name + " is meant for Mythic creatures only.");
    });
    var typ = (D.traitGuideline || {})[c.tier];
    if (typ && c.traits.length > typ + 1) w.push(c.traits.length + " abilities is a lot for a " + c.tier + " creature (about " + typ + " is typical).");
    if (!c.name.trim()) w.push("Give the creature a name before saving.");
    return w;
  }
  function exportShape(c) {
    return { name: c.name, translated: c.translated, tier: c.tier, vigorAdj: c.vigorAdj, apAdj: c.apAdj, poolAdj: c.poolAdj,
             movement: moveLabel(c.movement), demeanor: c.demeanor, desc: c.desc, items: c.items,
             traits: c.traits.map(function (t) { return { name: t.name, ap: t.ap, effect: t.effect, poolMod: t.poolMod }; }) };
  }

  /* ---------- the stat block preview ---------- */
  function statBlock(c) {
    var s = derived(c);
    var head = el("div", { class: "sbh" }, [el("div", { class: "sbn", text: c.name || "Unnamed creature" }),
      el("div", { class: "sbs" }, [el("b", { text: c.tier.toUpperCase() }), c.translated ? el("i", { text: "  " + c.translated }) : null])]);
    function num(l, v) { return el("span", { class: "sbnum" }, [el("small", { text: l }), el("b", { text: String(v) })]); }
    var strip = el("div", { class: "sbstrip" }, [
      el("div", {}, [num("VIGOR", s.vigor), num("AP", s.ap), num("POOL", s.pool)]),
      el("div", {}, [el("small", { text: "MOVE " }), document.createTextNode(moveLabel(c.movement))]),
      el("div", {}, [el("small", { text: "DEMEANOR " }), document.createTextNode(c.demeanor.join(", "))])]);
    var body = el("div", { class: "sbb" }, []);
    if (c.traits.length) {
      body.appendChild(el("div", { class: "sblab", text: "SPECIAL ABILITIES" }));
      c.traits.forEach(function (t) {
        body.appendChild(el("div", { class: "sbt" }, [el("b", { text: t.name }), t.ap ? el("span", { class: "sbap", text: " " + t.ap + " AP" }) : null,
          t.effect ? document.createTextNode(". " + t.effect) : null]));
      });
    }
    if (c.desc) body.appendChild(el("div", { class: "sbd", text: c.desc }));
    body.appendChild(el("div", { class: "sbi" }, [el("small", { text: "ITEMS " }), document.createTextNode(c.items || "None")]));
    return el("div", { class: "sb" }, [head, strip, body]);
  }

  /* ---------- screen ---------- */
  function persist() { store(DRAFT, { cur: CUR, editing: editing }); }
  function render() {
    persist();
    var s = derived(CUR), keepY = window.scrollY;
    app.textContent = "";
    var sum = el("div", { class: "bsum" }, [
      cell("Vigor", s.vigor), cell("AP", s.ap), cell("Pool", s.pool),
      el("span", { class: "bnote", text: editing ? "Editing a saved creature." : "New creature." }),
      el("div", { class: "btools" }, [
        el("button", { class: "primary", text: editing ? "Save changes" : "Add to compendium", onclick: save }),
        el("button", { text: "New", onclick: function () { CUR = blank(); editing = null; ui.notice = ""; render(); } })])]);
    app.appendChild(sum);
    if (ui.notice) app.appendChild(el("p", { class: "hint", role: "status", text: ui.notice }));
    var left = el("div", { class: "cform" }, []);
    var right = el("aside", { class: "cprev" }, [el("h3", { text: "Preview" }), statBlock(CUR)]);
    var ws = warnings(CUR);
    if (ws.length) right.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "Heads up" }), el("ul", { class: "warnlist" }, ws.map(function (x) { return el("li", { text: x }); }))]));
    buildForm(left);
    app.appendChild(el("div", { class: "cgrid" }, [left, right]));
    app.appendChild(compendium());
    window.scrollTo(0, keepY);
  }
  function cell(l, v) { return el("div", { class: "bcell" }, [el("span", { class: "bl", text: l }), el("strong", { text: String(v) })]); }
  function field(label, input, cls) { return el("label", { class: "fld " + (cls || "") }, [el("span", { text: label }), input]); }
  function txt(val, on, ph) { var i = el("input", { type: "text", value: val, placeholder: ph || "" }); i.value = val; i.addEventListener("input", function () { on(i.value); persist(); previewOnly(); }); return i; }
  function previewOnly() {
    var p = app.querySelector(".cprev .sb"); if (p) p.replaceWith(statBlock(CUR));
    var s = derived(CUR), cells = app.querySelectorAll(".bsum .bcell strong"); if (cells.length >= 3) { cells[0].textContent = s.vigor; cells[1].textContent = s.ap; cells[2].textContent = s.pool; }
  }

  function buildForm(f) {
    f.appendChild(el("div", { class: "bcard" }, [
      el("h2", { text: "Basics" }),
      field("Name", txt(CUR.name, function (v) { CUR.name = v; }, "e.g. Olive Snail")),
      field("Translated name (optional)", txt(CUR.translated, function (v) { CUR.translated = v; }, "(Translated Name)")),
      el("span", { class: "dim", text: "Tier" }),
      el("div", { class: "pills" }, D.tiers.map(function (t) {
        return el("button", { class: "pillbtn" + (CUR.tier === t.name ? " on" : ""), title: t.note, onclick: function () { CUR.tier = t.name; render(); } },
          [t.name + " · " + t.vigor]);
      })),
      el("p", { class: "dim", text: tierOf(CUR.tier).note }),
      el("details", { class: "adj" }, [el("summary", { text: "Adjust the numbers" }),
        el("div", { class: "adjrow" }, [num("Vigor", "vigorAdj"), num("AP", "apAdj"), num("Pool", "poolAdj")])])]));
    f.appendChild(el("div", { class: "bcard" }, [
      el("h2", { text: "Movement and demeanor" }),
      field("Movement", (function () {
        var s = el("select", {}, D.movement.map(function (m) { return el("option", { value: m.name, text: m.name + " · " + m.squares + " sq" }); }));
        s.value = CUR.movement; s.addEventListener("change", function () { CUR.movement = s.value; render(); }); return s; })(), "narrow"),
      el("span", { class: "dim", text: "Demeanor (pick any)" }),
      el("div", { class: "pills" }, D.demeanor.map(function (d) {
        var on = CUR.demeanor.indexOf(d.name) >= 0;
        return el("button", { class: "pillbtn" + (on ? " on" : ""), title: d.desc, "aria-pressed": on ? "true" : "false", onclick: function () {
          var i = CUR.demeanor.indexOf(d.name); if (i >= 0) CUR.demeanor.splice(i, 1); else CUR.demeanor.push(d.name); render(); } }, [d.name]);
      }))]));
    f.appendChild(traitsCard());
    var ta = el("textarea", { rows: "4", placeholder: "What it looks like and how it behaves." }); ta.value = CUR.desc;
    ta.addEventListener("input", function () { CUR.desc = ta.value; persist(); previewOnly(); });
    f.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "Description and items" }), field("Description", ta),
      field("Items", txt(CUR.items, function (v) { CUR.items = v; }, "e.g. Olive Shell"))]));
  }
  function num(label, key) {
    var i = el("input", { type: "number", value: CUR[key] }); i.value = CUR[key];
    i.addEventListener("input", function () { CUR[key] = parseInt(i.value, 10) || 0; persist(); previewOnly(); });
    return el("label", { class: "fld narrow" }, [el("span", { text: label + " adjustment" }), i]);
  }

  function traitsCard() {
    var card = el("div", { class: "bcard" }, [el("h2", { text: "Special abilities" })]);
    var typ = (D.traitGuideline || {})[CUR.tier];
    card.appendChild(el("p", { class: "dim", text: CUR.traits.length + " chosen" + (typ ? " · about " + typ + " is typical for a " + CUR.tier + " creature (a guideline, not a limit)" : "") }));
    // chosen
    var chosen = el("ul", { class: "chosen ctraits" }, []);
    CUR.traits.forEach(function (t, idx) {
      var ap = el("input", { type: "text", value: t.ap, "aria-label": "AP cost", class: "tap" }); ap.value = t.ap;
      ap.addEventListener("input", function () { t.ap = ap.value; persist(); previewOnly(); });
      var ef = el("input", { type: "text", value: t.effect, "aria-label": "Effect", class: "fchoice" }); ef.value = t.effect;
      ef.addEventListener("input", function () { t.effect = ef.value; persist(); previewOnly(); });
      chosen.appendChild(el("li", {}, [el("span", { class: "fn", text: t.name }), el("label", { class: "tapl" }, [el("small", { text: "AP " }), ap]), ef,
        el("button", { class: "x", text: "Remove", onclick: function () { CUR.traits.splice(idx, 1); render(); } })]));
    });
    if (CUR.traits.length) card.appendChild(chosen);
    // browser
    var tags = {}; D.traits.forEach(function (t) { t.tags.forEach(function (g) { var k = g.toLowerCase(); tags[k] = (tags[k] || 0) + 1; }); });
    var main = ["attack", "skill", "adaptation", "feature"].filter(function (k) { return tags[k]; });
    var q = el("input", { type: "search", placeholder: "Search abilities", value: ui.q, "aria-label": "Search abilities" }); q.value = ui.q;
    var list = el("div", { class: "tlist" }, []);
    function fill() {
      list.textContent = "";
      var shown = D.traits.filter(function (t) {
        if (ui.tag && t.tags.map(function (g) { return g.toLowerCase(); }).indexOf(ui.tag) < 0) return false;
        if (!ui.q) return true; var s = (t.name + " " + t.effects.join(" ") + " " + t.desc).toLowerCase(); return s.indexOf(ui.q.toLowerCase()) >= 0;
      });
      if (!shown.length) list.appendChild(el("p", { class: "dim", text: "No abilities match." }));
      shown.forEach(function (t) {
        var has = CUR.traits.some(function (x) { return x.name === t.name; });
        list.appendChild(el("div", { class: "trow" + (has ? " has" : "") }, [
          el("div", { class: "tmain" }, [el("b", { text: t.name }), t.ap ? el("span", { class: "chip", text: t.ap + " AP" }) : null,
            el("span", { class: "dim", text: t.effects.join("; ") })]),
          el("button", { text: has ? "Added" : "Add", disabled: has, onclick: function () {
            CUR.traits.push({ name: t.name, ap: t.ap, effect: t.effects.join("; "), poolMod: t.poolMod || 0, minTier: t.minTier || "" }); render(); } })]));
      });
    }
    q.addEventListener("input", function () { ui.q = q.value; fill(); });
    var pills = el("div", { class: "pills" }, [el("button", { class: "pillbtn" + (!ui.tag ? " on" : ""), text: "All", onclick: function () { ui.tag = ""; render(); } })].concat(
      main.map(function (k) { return el("button", { class: "pillbtn" + (ui.tag === k ? " on" : ""), text: k[0].toUpperCase() + k.slice(1), onclick: function () { ui.tag = k; render(); } }); })));
    card.appendChild(el("details", { class: "tpick", open: CUR.traits.length === 0 }, [el("summary", { text: "Add from the Special Abilities table" }), pills, q, list]));
    fill();
    // custom
    var cn = el("input", { type: "text", placeholder: "Name, e.g. Withdraw" }), ca = el("input", { type: "text", placeholder: "AP" }), ce = el("input", { type: "text", placeholder: "What it does" });
    card.appendChild(el("details", { class: "tpick" }, [el("summary", { text: "Add a one-off ability of your own" }),
      el("div", { class: "customrow" }, [cn, ca, ce, el("button", { text: "Add", onclick: function () {
        if (!cn.value.trim()) return; CUR.traits.push({ name: cn.value.trim(), ap: ca.value.trim(), effect: ce.value.trim(), poolMod: 0, minTier: "", custom: true }); render(); } })])]));
    return card;
  }

  /* ---------- compendium ---------- */
  function save() {
    if (!CUR.name.trim()) { ui.notice = "Give the creature a name first."; render(); return; }
    var copy = JSON.parse(JSON.stringify(CUR)), at = -1;
    LIB.forEach(function (c, i) { if (c.id === copy.id) at = i; });
    if (at >= 0) LIB[at] = copy; else LIB.push(copy);
    store(KEY, LIB);
    ui.notice = '“' + copy.name + '” saved to the compendium (' + LIB.length + ' creature' + (LIB.length === 1 ? "" : "s") + ").";
    CUR = blank(); editing = null; render();
  }
  function compendium() {
    var box = el("section", { class: "bcard ccomp" }, [el("h2", { text: "Your compendium (" + LIB.length + ")" })]);
    var tools = el("div", { class: "btools ctools" }, []);
    var dl = el("button", { class: "primary", text: "Download as Word", disabled: !LIB.length, onclick: wordOut });
    var sv = el("button", { text: "Save compendium file", disabled: !LIB.length, onclick: fileOut });
    var file = el("input", { type: "file", accept: ".json,application/json", hidden: true });
    file.addEventListener("change", function () { fileIn(file.files[0]); file.value = ""; });
    tools.appendChild(dl); tools.appendChild(sv); tools.appendChild(el("button", { text: "Load compendium file", onclick: function () { file.click(); } })); tools.appendChild(file);
    box.appendChild(tools);
    box.appendChild(el("p", { class: "hint", text: "The compendium is kept in this browser. Use Save compendium file to keep a copy of your own; loading a file adds its creatures and updates any you already have." }));
    if (!LIB.length) { box.appendChild(el("p", { class: "dim", text: "Nothing saved yet." })); return box; }
    D.tiers.forEach(function (t) {
      var g = LIB.filter(function (c) { return c.tier === t.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      if (!g.length) return;
      box.appendChild(el("h3", { class: "tier", text: t.name + " creatures" }));
      g.forEach(function (c) {
        var s = derived(c), id = c.id;
        box.appendChild(el("div", { class: "crow" }, [
          el("span", { class: "fname", text: c.name }), el("span", { class: "dim", text: "Vigor " + s.vigor + " · AP " + s.ap + " · Pool " + s.pool + " · " + c.traits.length + " abilit" + (c.traits.length === 1 ? "y" : "ies") }),
          el("span", { class: "cact" }, [
            el("button", { text: "Edit", onclick: function () { CUR = JSON.parse(JSON.stringify(c)); editing = id; ui.notice = ""; render(); window.scrollTo(0, 0); } }),
            el("button", { text: "Duplicate", onclick: function () { var n = JSON.parse(JSON.stringify(c)); n.id = uid(); n.name = c.name + " (copy)"; LIB.push(n); store(KEY, LIB); render(); } }),
            el("button", { text: ui.sure === id ? "Really delete?" : "Delete", onclick: function () {
              if (ui.sure !== id) { ui.sure = id; render(); return; }
              LIB = LIB.filter(function (x) { return x.id !== id; }); ui.sure = null; store(KEY, LIB); if (editing === id) { editing = null; } render(); } })])]));
      });
    });
    return box;
  }
  function download(blob, name) {
    var a = el("a", { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  function fileOut() {
    download(new Blob([JSON.stringify({ file: { kind: "constellations-compendium", schemaVersion: 1, rulesVersion: D.rulesVersion || "laurel" }, creatures: LIB }, null, 1)], { type: "application/json" }), "constellations-compendium.json");
  }
  function fileIn(f) {
    if (!f) return;
    var r = new FileReader();
    r.onload = function () {
      try {
        var j = JSON.parse(r.result); if (!j.file || j.file.kind !== "constellations-compendium") throw new Error("not a compendium file");
        var added = 0, updated = 0;
        j.creatures.forEach(function (c) {
          var at = -1; LIB.forEach(function (x, i) { if (x.id === c.id) at = i; });
          if (at >= 0) { LIB[at] = c; updated++; } else { LIB.push(c); added++; }
        });
        store(KEY, LIB); ui.notice = "Loaded " + added + " new and updated " + updated + " creatures."; render();
      } catch (e) { ui.notice = "That file isn't a compendium file from this builder."; render(); }
    };
    r.readAsText(f);
  }
  function wordOut() {
    if (!window.CreatureDocx || !window.docx) { ui.notice = "The Word exporter did not load. Check your connection and reload the page."; render(); return; }
    window.CreatureDocx.build(LIB.map(exportShape), D.tiers, {}).then(function (b) { download(b, "Creature Compendium.docx"); });
  }

  /* ---------- start ---------- */
  fetch("creature-data.json").then(function (r) { return r.json(); }).then(function (data) {
    D = data; LIB = load(KEY) || [];
    var dr = load(DRAFT);
    if (dr && dr.cur && D.tiers.some(function (t) { return t.name === dr.cur.tier; })) { CUR = dr.cur; editing = dr.editing || null; } else CUR = blank();
    render();
  }).catch(function () { app.textContent = "Could not load the NPC rules data."; });
})();
