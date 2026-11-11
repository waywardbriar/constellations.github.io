/* Constellations track clock builder (Scene Construction: Social & Discovery). */
(function () {
  "use strict";
  var KEY = "constellations-clock", app = document.getElementById("app");
  var IMPORTANCE = [["Passing", 2], ["Minor", 3], ["Standard", 4], ["Significant", 5], ["Major", 6], ["Critical", 8]];
  var MODS = [["Hunted / Chased", -1], ["Unprepared", -1], ["Hostile Environment", -1], ["Bad Weather", -1], ["Outside Help", 1], ["Pre-planning", 1]];
  var S = { imp: "Standard", pcs: 4, mods: {}, extra: 0, ticks: 0, progress: 0, log: [] };
  try { var sv = JSON.parse(localStorage.getItem(KEY)); if (sv) S = sv; } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }
  function el(t, a, k) { var n = document.createElement(t); for (var x in (a || {})) { if (x === "text") n.textContent = a[x]; else if (x.slice(0, 2) === "on") n.addEventListener(x.slice(2), a[x]); else if (a[x] !== false && a[x] != null) n.setAttribute(x, a[x] === true ? "" : a[x]); } (k || []).forEach(function (c) { if (c != null) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); }); return n; }
  function base() { return IMPORTANCE.filter(function (i) { return i[0] === S.imp; })[0][1]; }
  function time() {
    var t = base() + (+S.extra || 0);
    MODS.forEach(function (m) { if (S.mods[m[0]]) t += m[1]; });
    return Math.max(1, t);
  }
  function quality(m) { return m >= 4 ? "Solid" : m >= 2 ? "Basic" : "Shaky"; }
  function sign(n) { return (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n); }
  function stat(l, v, sub) { return el("div", { class: "bcell" }, [el("span", { class: "bl", text: l }), el("strong", { text: String(v) }), sub ? el("span", { class: "dim", text: sub }) : null]); }
  function numField(label, key, min) {
    var i = el("input", { type: "number" }); if (min != null) i.setAttribute("min", String(min)); i.value = S[key];
    i.addEventListener("change", function () { var v = parseInt(i.value, 10); S[key] = isNaN(v) ? 0 : (min != null ? Math.max(min, v) : v); save(); render(); });
    return el("label", { class: "fld narrow" }, [el("span", { text: label }), i]);
  }
  function reset() { S.ticks = 0; S.progress = 0; S.log = []; save(); render(); }

  function render() {
    var T = time(), goal = T * Math.max(1, S.pcs), left = Math.max(0, T - S.ticks), done = S.progress >= goal, out = S.ticks >= T;
    app.textContent = "";
    var adj = el("div", { class: "pills" }, MODS.map(function (m) {
      var on = !!S.mods[m[0]];
      return el("button", { class: "pillbtn" + (on ? " on" : ""), "aria-pressed": on ? "true" : "false", text: m[0] + " " + sign(m[1]),
        onclick: function () { S.mods[m[0]] = !on; save(); render(); } });
    }));
    var imp = el("div", { class: "pills" }, IMPORTANCE.map(function (i) {
      return el("button", { class: "pillbtn" + (S.imp === i[0] ? " on" : ""), "aria-pressed": S.imp === i[0] ? "true" : "false", text: i[0] + " · " + i[1],
        onclick: function () { S.imp = i[0]; save(); render(); } });
    }));
    app.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "The scene" }),
      el("span", { class: "dim", text: "Importance" }), imp,
      el("span", { class: "dim", text: "Situation (suggestions; adjust as you see fit)" }), adj,
      el("div", { class: "adjrow" }, [numField("Number of PCs", "pcs", 1), numField("Your own adjustment", "extra")]),
      el("div", { class: "bsum" }, [stat("Time", T, "rounds on the clock"), stat("Goal", goal, T + " × " + Math.max(1, S.pcs) + " PCs"),
        stat("Shaky", "1", "magnitude 1"), stat("Basic", "2–3", "magnitude 2–3"), stat("Solid", "4+", "magnitude 4 or more")])]));

    // the clock
    var seg = el("div", { class: "segs", role: "img", "aria-label": S.ticks + " of " + T + " ticks used" }, []);
    for (var i = 0; i < T; i++) seg.appendChild(el("span", { class: "seg" + (i < S.ticks ? " used" : "") }));
    var pct = Math.min(100, Math.round(S.progress / goal * 100));
    var bar = el("div", { class: "gbar", role: "img", "aria-label": S.progress + " of " + goal + " goal" }, [el("span", { style: "width:" + pct + "%" })]);
    var mag = el("input", { type: "number", min: "1", value: "1", "aria-label": "Magnitude of the win" });
    var state = done ? "Goal reached: the party achieves the outcome they wanted." :
      out ? "Time is up. The party is short of the goal; what that means is the GM's call (it isn't all or nothing)." : left + " tick" + (left === 1 ? "" : "s") + " left.";
    app.appendChild(el("div", { class: "bcard" }, [el("h2", { text: "Run the clock" }),
      el("div", { class: "cl" }, [el("strong", { text: "Clock" }), seg]),
      el("div", { class: "cl" }, [el("strong", { text: "Goal " + S.progress + " / " + goal }), bar]),
      el("p", { class: "hint", role: "status", text: state }),
      el("div", { class: "btools" }, [
        el("button", { class: "primary", text: "End of round (+1 tick)", onclick: function () { S.ticks++; S.log.unshift("Round ended: tick " + S.ticks); save(); render(); } }),
        el("button", { text: "Lost bid (+1 extra tick)", onclick: function () { S.ticks++; S.log.unshift("Lost bid: extra tick (" + S.ticks + ")"); save(); render(); } })]),
      el("div", { class: "addrow" }, [el("label", { class: "fld narrow" }, [el("span", { text: "Winning bid, magnitude" }), mag]),
        el("button", { text: "Add to goal", onclick: function () { var m = Math.max(1, parseInt(mag.value, 10) || 1); S.progress += m; S.log.unshift("Win, magnitude " + m + " (" + quality(m) + ")"); save(); render(); } })]),
      el("button", { text: "Reset the clock", onclick: reset }),
      S.log.length ? el("ul", { class: "clog" }, S.log.slice(0, 8).map(function (l) { return el("li", { text: l }); })) : null]));
  }
  render();
})();
