/* Creature Compendium Word export. Builds one .docx from the saved creatures: tier headings,
   compact stat blocks flowing in two columns, each block kept whole. Needs the docx library (docx.umd.js). */
(function (root) {
  "use strict";
  var C = { BASE: "0D2A2E", PANEL: "163A3A", INK: "E7FBF5", ACC: "8FE3D0", ACC2: "C5B2F0", LIGHT: "F4FBF9", TXT: "2C4A48", DARK: "143C3C",
            EDGE: "BFE9DF", LABEL: "1F7A6B", VIO: "5B4A9E", DIM: "5E7C78", MUTE: "7FA9A2" };
  var BLOCK_W = 4800;   // dxa; two blocks plus a gap fit the 7 inch text width

  function build(list, tiers, opts) {
    var d = root.docx || (typeof require === "function" ? require("docx") : null);
    var Document = d.Document, Packer = d.Packer, Paragraph = d.Paragraph, TextRun = d.TextRun, Table = d.Table, TableRow = d.TableRow,
        TableCell = d.TableCell, WidthType = d.WidthType, BorderStyle = d.BorderStyle, ShadingType = d.ShadingType,
        SectionType = d.SectionType, AlignmentType = d.AlignmentType, TableLayoutType = d.TableLayoutType;
    opts = opts || {};

    function run(t, o) {
      o = o || {};
      return new TextRun({ text: t, font: o.font || "Calibri", size: Math.round((o.size || 10) * 2), bold: !!o.bold, italics: !!o.italic,
                           color: o.color || C.TXT, allCaps: !!o.caps, characterSpacing: o.sp || 0 });
    }
    function para(runs, o) {
      o = o || {};
      return new Paragraph({ children: runs, spacing: { before: Math.round((o.before || 0) * 20), after: Math.round((o.after || 0) * 20), line: o.line || 252 },
                             keepNext: o.keep !== false, keepLines: true, alignment: o.align });
    }
    var none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
    function edge(c) { return { style: BorderStyle.SINGLE, size: 4, color: c }; }
    function cell(children, fill, borders, mar) {
      return new TableCell({
        children: children, width: { size: BLOCK_W, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: fill },
        borders: borders, margins: mar
      });
    }

    function stats(cr) {
      var tier = tiers.filter(function (t) { return t.name === cr.tier; })[0] || tiers[0];
      var pool = tier.pool + (cr.poolAdj || 0);
      (cr.traits || []).forEach(function (t) { pool += t.poolMod || 0; });
      return { vigor: tier.vigor + (cr.vigorAdj || 0), ap: tier.ap + (cr.apAdj || 0), pool: Math.max(1, pool) };
    }

    function block(cr) {
      var s = stats(cr);
      var head = [para([run(cr.name || "Unnamed", { font: "Georgia", size: 17, bold: true, color: C.INK })], { after: 0 })];
      var sub = [run((cr.tier || "").toUpperCase(), { size: 8, bold: true, color: C.ACC2 })];
      if (cr.translated) sub.push(run("   " + cr.translated, { size: 8, italic: true, color: C.MUTE }));
      head.push(para(sub, { after: 2 }));
      var strip = [];
      var line1 = [];
      [["VIGOR", s.vigor], ["AP", s.ap], ["POOL", s.pool]].forEach(function (p) {
        line1.push(run(p[0] + " ", { size: 7, bold: true, color: C.ACC }));
        line1.push(run(p[1] + "     ", { font: "Georgia", size: 15, bold: true, color: C.INK }));
      });
      strip.push(para(line1, { after: 0 }));
      strip.push(para([run("MOVE ", { size: 7, bold: true, color: C.ACC }), run(cr.movement || "", { size: 9, color: C.INK })], { after: 0 }));
      strip.push(para([run("DEMEANOR ", { size: 7, bold: true, color: C.ACC }), run((cr.demeanor || []).join(", "), { size: 9, color: C.INK })], { after: 2 }));
      var body = [];
      if ((cr.traits || []).length) {
        body.push(para([run("SPECIAL ABILITIES", { size: 7, bold: true, color: C.LABEL, sp: 25 })], { after: 2 }));
        cr.traits.forEach(function (t) {
          var rs = [run(t.name, { font: "Georgia", size: 10, bold: true, color: C.DARK })];
          if (t.ap) rs.push(run("  " + t.ap + " AP", { size: 8, bold: true, color: C.VIO }));
          if (t.effect) rs.push(run(". " + t.effect, { size: 9.5 }));
          body.push(para(rs, { after: 3 }));
        });
      }
      if (cr.desc) body.push(para([run(cr.desc, { size: 8.5, italic: true, color: C.DIM })], { before: 4, after: 3 }));
      body.push(para([run("ITEMS  ", { size: 7, bold: true, color: C.LABEL }), run(cr.items || "None", { size: 9.5 })], { after: 0, keep: false }));
      var m1 = { top: 140, bottom: 40, left: 170, right: 170 }, m2 = { top: 50, bottom: 50, left: 170, right: 170 }, m3 = { top: 90, bottom: 100, left: 170, right: 170 };
      var side = edge(C.EDGE);
      var rows = [
        new TableRow({ cantSplit: true, children: [cell(head, C.BASE, { top: none, bottom: none, left: none, right: none }, m1)] }),
        new TableRow({ cantSplit: true, children: [cell(strip, C.PANEL, { top: none, bottom: none, left: none, right: none }, m2)] }),
        new TableRow({ cantSplit: true, children: [cell(body, C.LIGHT, { top: none, bottom: side, left: side, right: side }, m3)] })
      ];
      return new Table({ rows: rows, width: { size: BLOCK_W, type: WidthType.DXA }, columnWidths: [BLOCK_W], layout: TableLayoutType.FIXED });
    }

    var PAGE = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1008, bottom: 1008, left: 1080, right: 1080 } } };
    var sections = [];
    var intro = [
      new Paragraph({ children: [new TextRun({ text: opts.title || "Creature Compendium", font: "Georgia", size: 48, bold: true, color: C.DARK })], spacing: { after: 120 } }),
      new Paragraph({ children: [new TextRun({ text: opts.subtitle || "Creatures across the systems, grouped by tier. Every block is built from the NPC rules: Vigor sets every bid, and the injury pool is how much damage it takes to put it down.", font: "Calibri", size: 21, italics: true, color: C.DIM })], spacing: { after: 200 } })
    ];
    sections.push({ properties: Object.assign({}, PAGE), children: intro });
    var any = false;
    tiers.forEach(function (tier) {
      var group = list.filter(function (c) { return c.tier === tier.name; })
        .sort(function (a, b) { return (a.name || "").localeCompare(b.name || ""); });
      if (!group.length) return;
      any = true;
      sections.push({ properties: Object.assign({ type: SectionType.CONTINUOUS }, PAGE), children: [
        new Paragraph({ children: [new TextRun({ text: tier.name + " Creatures", font: "Georgia", size: 30, bold: true, color: C.LABEL })],
                        spacing: { before: 240, after: 120 }, keepNext: true, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: C.EDGE, space: 2 } } })
      ] });
      var kids = [];
      group.forEach(function (cr) {
        kids.push(block(cr));
        kids.push(new Paragraph({ children: [new TextRun({ text: " ", size: 10 })], spacing: { after: 120 } }));
      });
      sections.push({ properties: Object.assign({ type: SectionType.CONTINUOUS, column: { count: 2, space: 360, equalWidth: true } }, PAGE), children: kids });
    });
    if (!any) sections.push({ properties: Object.assign({ type: SectionType.CONTINUOUS }, PAGE), children: [new Paragraph({ children: [new TextRun({ text: "No creatures saved yet.", italics: true })] })] });
    var doc = new Document({ creator: "Constellations", title: opts.title || "Creature Compendium", sections: sections });
    return Packer.toBlob ? Packer.toBlob(doc) : Packer.toBuffer(doc);
  }
  var api = { build: build };
  if (typeof module !== "undefined" && module.exports) module.exports = api; else root.CreatureDocx = api;
})(typeof window !== "undefined" ? window : globalThis);
