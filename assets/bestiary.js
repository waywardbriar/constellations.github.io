/* Creature Compendium page: sort, filter, and collapse by threat level. */
(function () {
  var cards = [].slice.call(document.querySelectorAll(".sb[data-name]"));
  var tiers = [].slice.call(document.querySelectorAll("details.tier"));
  if (!cards.length || !tiers.length) return;
  var home = {}; cards.forEach(function (c) { home[c.id] = c.parentNode; });
  var lede = document.querySelector(".lede") || tiers[0];
  var SORTS = { name: ["Name (A–Z)", "name", 1], vigor: ["Vigor (high first)", "vigor", -1], vigorUp: ["Vigor (low first)", "vigor", 1],
                ap: ["Action Points", "ap", -1], pool: ["Injury pool", "pool", -1], move: ["Movement (fastest)", "move", -1], abil: ["Most abilities", "abil", -1] };
  var st = { sort: "name", group: true, q: "" };
  try { var saved = JSON.parse(localStorage.getItem("bestiaryView")); if (saved) { st.sort = SORTS[saved.sort] ? saved.sort : "name"; st.group = saved.group !== false; } } catch (e) {}

  function el(t, a, k) { var n = document.createElement(t); for (var x in (a || {})) { if (x === "text") n.textContent = a[x]; else if (x.slice(0, 2) === "on") n.addEventListener(x.slice(2), a[x]); else n.setAttribute(x, a[x]); } (k || []).forEach(function (c) { n.appendChild(c); }); return n; }
  var sel = el("select", { "aria-label": "Sort creatures" }, Object.keys(SORTS).map(function (k) { return el("option", { value: k, text: SORTS[k][0] }); }));
  sel.value = st.sort;
  var grp = el("input", { type: "checkbox", id: "bgrp" }); grp.checked = st.group;
  var q = el("input", { type: "search", placeholder: "Filter by name or ability", "aria-label": "Filter creatures" });
  var count = el("span", { class: "bcount" });
  var bar = el("div", { class: "bestbar" }, [
    el("label", {}, [el("span", { text: "Sort by " }), sel]),
    el("label", { class: "chk" }, [grp, el("span", { text: " Group by threat level" })]),
    q,
    el("button", { type: "button", text: "Collapse all", onclick: function () { tiers.forEach(function (d) { d.open = false; }); } }),
    el("button", { type: "button", text: "Expand all", onclick: function () { tiers.forEach(function (d) { d.open = true; }); } }),
    count]);
  lede.parentNode.insertBefore(bar, lede.nextSibling);
  var flat = el("div", { class: "bestiary flatlist", hidden: "" });
  tiers[0].parentNode.insertBefore(flat, tiers[0]);

  function cmp(a, b) {
    var s = SORTS[sel.value], k = s[1], d = s[2];
    var x = a.dataset[k], y = b.dataset[k];
    var r = k === "name" ? (x < y ? -1 : x > y ? 1 : 0) : (+x - +y);
    if (r !== 0) return r * d;
    return a.dataset.name < b.dataset.name ? -1 : 1;
  }
  function apply() {
    st.sort = sel.value; st.group = grp.checked; st.q = q.value.trim().toLowerCase();
    try { localStorage.setItem("bestiaryView", JSON.stringify({ sort: st.sort, group: st.group })); } catch (e) {}
    var shown = 0, list = cards.slice().sort(cmp);
    list.forEach(function (c) {
      var hit = !st.q || c.textContent.toLowerCase().indexOf(st.q) >= 0;
      c.hidden = !hit; if (hit) shown++;
      (st.group ? home[c.id] : flat).appendChild(c);
    });
    flat.hidden = st.group;
    tiers.forEach(function (d) {
      d.hidden = !st.group || !d.querySelector(".sb:not([hidden])");
      var n = d.querySelectorAll(".sb:not([hidden])").length; d.querySelector(".tcount").textContent = n;
    });
    count.textContent = shown + " of " + cards.length;
  }
  sel.addEventListener("change", apply); grp.addEventListener("change", apply); q.addEventListener("input", apply);
  function openHash() { var h = location.hash.slice(1); if (!h) return; var t = document.getElementById(h); var d = t && t.closest("details"); if (d) d.open = true; }
  window.addEventListener("hashchange", openHash); openHash(); apply();
})();
