/* Constellations encounter builder: party merit -> Anchor Vigor, enemy list -> AP comparison. */
(function () {
  "use strict";
  var KEY = "constellations-encounter";
  var app = document.getElementById("app"), D = null, LIB = [];
  // Scene Construction table: lowest merit in the band, Anchor Vigor, nearest tiers
  var BANDS = [[0, 8, "Ordinary"], [195, 10, "Ordinary – Robust"], [265, 12, "Robust"], [350, 14, "Robust – Powerful"],
               [450, 16, "Powerful"], [575, 20, "Powerful – Mythic"], [725, 24, "Mythic"]];
  var S = { pcs: 4, merit: 300, rows: [] };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) S = sv; } catch (e) {}

  function el(t, a, k) { var n = document.createElement(t); for (var x in (a || {})) { if (x === "text") n.textContent = a[x]; else if (x.slice(0, 2) === "on") n.addEventListener(x.slice(2), a[x]); else if (a[x] !== false && a[x] != null) n.setAttribute(x, a[x] === true ? "" : a[x]); } (k || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return n; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function band(m) { var b = BANDS[0]; BANDS.forEach(function (x) { if (m >= x[0]) b = x; }); return b; }
  function tier(n) { return D.tiers.filter(function (t) { return t.name === n; })[0]; }
  function stats(c) { // c: compendium creature or {tier}
    var t = tier(c.tier), pool = t.pool + (+c.poolAdj || 0);
    (c.traits || []).forEach(function (x) { pool += +x.poolMod || 0; });
    return { vigor: t.vigor + (+c.vigorAdj || 0), ap: t.ap + (+c.apAdj || 0), pool: Math.max(1, pool) };
  }
  function entry(r) { // a row: {id|null, tier, qty}
    var c = r.id ? LIB.filter(function (x) { return x.id === r.id; })[0] : null;
    if (r.id && !c) return null;
    var base = c || { tier: r.tier, traits: [] }, s = stats(base);
    return { name: c ? c.name : "Generic " + r.tier, tier: base.tier, vigor: s.vigor, ap: s.ap, pool: s.pool, qty: r.qty };
  }
  function tierLabel(v, anchor) {
    if (v <= anchor / 2) return "Mook"; if (v < anchor) return "Minor"; if (v === anchor) return "Even";
    if (v < anchor * 1.5) return "Elite"; return "Boss";
  }
  function apLabel(enemy, party) {
    if (!enemy) return "–"; var r = enemy / party;
    if (r <= 0.5) return "Skirmish"; if (r <= 1) return "Fair"; if (r <= 1.5) return "Hard"; return "Deadly";
  }
  function stat(l, v, sub) { return el("div", { class: "bcell" }, [el("span", { class: "bl", text: l }), el("strong", { text: String(v) }), sub ? el("span", { class: "dim", text: sub }) : null]); }
  function numField(label, key, min) {
    var i = el("input", { type: "number", min: String(min) }); i.value = S[key];
    i.addEventListener("change", function () { S[key] = Math.max(min, parseInt(i.value, 10) || min); save(); render(); });
    return el("label", { class: "fld narrow" }, [el("span", { text: label }), i]);
  }

  function render() {
    var b = band(S.merit), anchor = b[1], partyAP = 3 * S.pcs;
    var rows = S.rows.map(function (r) { return { r: r, e: entry(r) }; }).filter(function (x) { return x.e; });
    var total = 0, count = 0, top = null;
    rows.forEach(function (x) { total += x.e.ap * x.e.qty; count += x.e.qty; if (!top || x.e.vigor > top.vigor) top = x.e; });
    var label = apLabel(total, partyAP);
    app.textContent = "";
    app.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "Party" }),
      el("div", { class: "adjrow" }, [numField("Number of PCs", "pcs", 1), numField("Average total merit per PC", "merit", 0)]),
      el("div", { class: "bsum" }, [stat("Anchor Vigor", anchor, b[2]), stat("Party AP", partyAP, "3 per PC"),
        stat("Enemy AP", total, count + " enem" + (count === 1 ? "y" : "ies")), stat("Difficulty", label, total ? (Math.round(total / partyAP * 100) / 100) + "× party AP" : "")])]));

    // read-out
    var notes = [];
    if (top) {
      var d = top.vigor - anchor;
      notes.push("Strongest enemy: " + top.name + " (Vigor " + top.vigor + ") is " + (d === 0 ? "at the Anchor" : Math.abs(d) + (d > 0 ? " above" : " below") + " the Anchor of " + anchor) + " — " + tierLabel(top.vigor, anchor) + ".");
    } else notes.push("Add enemies below. Keep the strongest near the Anchor Vigor of " + anchor + "; go above it for a harder fight, below for an easier one.");
    if (total) {
      var lo = Math.ceil(partyAP / 2), hi = partyAP;
      if (label === "Fair") notes.push("Enemy AP is in the Fair range (" + lo + "–" + hi + " for this party).");
      else if (total < lo) notes.push("Under the Fair range by " + (lo - total) + " AP (Fair is " + lo + "–" + hi + ").");
      else notes.push("Over the Fair range by " + (total - hi) + " AP (Fair is up to " + hi + ").");
    }
    if (S.pcs >= 1) app.appendChild(el("div", { class: "bcard readout" }, [el("h2", { text: "Reading the numbers" })].concat(notes.map(function (n) { return el("p", { text: n }); }))));

    // add
    var pick = el("select", { "aria-label": "Add a creature" }, []);
    D.tiers.forEach(function (t) {
      var g = el("optgroup", { label: t.name + " (Vigor " + t.vigor + ")" }, [el("option", { value: "t:" + t.name, text: "Generic " + t.name })]);
      LIB.filter(function (c) { return c.tier === t.name; }).sort(function (a, b) { return a.name.localeCompare(b.name); })
        .forEach(function (c) { g.appendChild(el("option", { value: "c:" + c.id, text: c.name })); });
      pick.appendChild(g);
    });
    pick.value = "t:Ordinary";
    var qty = el("input", { type: "number", min: "1", value: "1", "aria-label": "How many" });
    app.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "Enemies" }),
      el("div", { class: "addrow" }, [pick, qty, el("button", { class: "primary", text: "Add", onclick: function () {
        var v = pick.value, q = Math.max(1, parseInt(qty.value, 10) || 1);
        var row = v.indexOf("c:") === 0 ? { id: v.slice(2), qty: q } : { tier: v.slice(2), qty: q };
        var same = S.rows.filter(function (r) { return (r.id || null) === (row.id || null) && (r.tier || null) === (row.tier || null); })[0];
        if (same) same.qty += q; else S.rows.push(row); save(); render(); } })]),
      rows.length ? el("div", { class: "etable" }, rows.map(function (x) {
        var e = x.e;
        return el("div", { class: "erow" }, [
          el("span", { class: "fname", text: e.name }), el("span", { class: "chip", text: tierLabel(e.vigor, anchor) }),
          el("span", { class: "dim", text: "Vigor " + e.vigor + " · AP " + e.ap + " · Pool " + e.pool }),
          el("span", { class: "cact" }, [
            el("button", { text: "−", "aria-label": "One fewer", onclick: function () { x.r.qty--; if (x.r.qty < 1) S.rows.splice(S.rows.indexOf(x.r), 1); save(); render(); } }),
            el("strong", { text: "×" + e.qty }),
            el("button", { text: "+", "aria-label": "One more", onclick: function () { x.r.qty++; save(); render(); } }),
            el("button", { text: "Remove", onclick: function () { S.rows.splice(S.rows.indexOf(x.r), 1); save(); render(); } })])]);
      })) : el("p", { class: "dim", text: "No enemies yet." }),
      rows.length ? el("p", { class: "hint", text: "A Hoard counts as one enemy of its highest-tier member. Add it here as that creature, once." }) : null,
      rows.length ? el("button", { text: "Clear all", onclick: function () { S.rows = []; save(); render(); } }) : null]));
  }

  Promise.all([fetch("creature-data.json").then(function (r) { return r.json(); }),
               fetch("compendium.json").then(function (r) { return r.json(); }).catch(function () { return { creatures: [] }; })])
    .then(function (a) { D = a[0]; LIB = a[1].creatures || []; render(); })
    .catch(function () { app.textContent = "Could not load the creature data."; });
})();
