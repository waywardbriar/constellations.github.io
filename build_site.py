#!/usr/bin/env python3
"""Builds the Constellations wiki from source/guide.docx into docs/.
Usage: python3 build_site.py   (needs pandoc and beautifulsoup4)"""
import json, re, shutil, subprocess, sys
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
SRC = ROOT / "source" / "guide.docx"
OUT = ROOT / "docs"
INCLUDE_WORLD = False   # Section IV (World Bible). Set True once it is finished.

# Sidebar grouping. Keys are H1 titles in the guide (matched loosely).
GROUPS = [
    ("Start Here", ["Preamble"]),
    ("The Game Core", ["Stamina & The Bidding System", "Primary Stats", "Stability",
                       "Health - Injury Slots", "Conditions", "Disease", "Resistance", "Immunity"]),
    ("Character Creation", ["Advancement - Merit", "Senexoth Role Feats", "Building a Character",
                            "Feats", "Equipment"]),
    ("Gameplay & Magic", ["Scenes", "Spells"]),
    ("World Bible", ["The World At Large", "Settlements & Civilizations", "Culture, Religion, Lore"]),
]

def norm(s): return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
def slug(s): return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")

def fix_table(t, soup):
    """Pandoc puts every row of a Word table into <thead> as <th>. Rebuild a real
    header: an optional title row (one wide cell), one column-header row, then body rows."""
    thead = t.find("thead")
    if thead is None or t.find("tbody") is not None and t.find("tbody").find("tr") is not None:
        return
    rows = thead.find_all("tr", recursive=False)
    if len(rows) < 3: return
    title = None
    if len(rows[0].find_all(["th", "td"])) == 1:
        title = rows.pop(0)
    head, rest = rows[0], rows[1:]
    tbody = soup.new_tag("tbody")
    for r in rest:
        for c in r.find_all("th"): c.name = "td"
        tbody.append(r.extract())
    if title is not None:
        cap = soup.new_tag("caption"); cap.string = title.get_text(" ", strip=True)
        title.decompose(); t.insert(0, cap)
    thead.clear(); thead.append(head.extract()); thead.insert_after(tbody)

def extract_data(sections, soup):
    """Pull the numbers the builder needs out of the guide, plus hand-kept extras."""
    extra = json.loads((ROOT / "assets" / "rules-extra.json").read_text(encoding="utf-8"))
    fixes = extra.get("idFixes", {})
    def fid(name):
        sl = slug(re.sub(r" X$", "", name)); return fixes.get(sl, sl)
    def tables_in(n):
        if getattr(n, "name", None) == "table": return [n]
        return n.find_all("table") if hasattr(n, "find_all") else []
    def rows_of(table):
        t = BeautifulSoup(str(table), "html.parser").find("table"); fix_table(t, soup)
        cap = t.find("caption"); cap = cap.get_text(" ", strip=True) if cap else ""
        head = [c.get_text(" ", strip=True) for c in t.find("thead").find_all(["th", "td"])] if t.find("thead") else []
        body = [[c.get_text(" ", strip=True) for c in r.find_all(["td", "th"])] for r in (t.find("tbody") or t).find_all("tr")]
        return cap, head, body
    data = {"rulesVersion": extra.get("rulesVersion", "laurel"), "startTypes": [], "feats": []}
    by = {norm(s["title"]): s for s in sections}
    # starting merit table
    for n in by[norm("Advancement - Merit")]["nodes"]:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            if head and head[0].lower().startswith("start type"):
                for r in body:
                    tiers = [int(x) for x in re.findall(r"\d", r[3])]
                    data["startTypes"].append({"id": "start:" + slug(r[0]), "name": r[0], "merit": int(r[1]),
                                               "statCap": int(r[2]), "tiers": tiers})
    # stat costs (level n -> merit), read from the Primary Stats table
    costs = {}
    for n in by[norm("Primary Stats")]["nodes"]:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            if head and head[0].lower().startswith("stat level"):
                for r in body:
                    if r[0].isdigit(): costs[int(r[0])] = int(r[1])
    data["statCosts"] = [costs[k] for k in sorted(costs)]
    # feats
    tree = None
    for n in by[norm("Feats")]["nodes"]:
        if getattr(n, "name", None) == "h2":
            tree = n.get_text(" ", strip=True)
            continue
        if not hasattr(n, "find_all") or tree in (None, "Untrained", "Retraining"): continue
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            m = re.match(r"Tier (\d)", cap)
            if not m: continue
            for r in body:
                if len(r) >= 3 and re.fullmatch(r"\d+", r[0]):
                    sid = fid(r[1]); tags = [x.strip() for x in (r[3] if len(r) > 3 else "").split(",") if x.strip()]
                    desc = r[2]
                    multi = ("Multi-Select" in tags) or bool(re.search(r"multiple times|can be selected multiple|select this (feat|stat) multiple", desc, re.I))
                    f = {"id": "feat:" + sid, "name": r[1], "tree": tree, "tier": int(m.group(1)), "cost": int(r[0]),
                         "desc": desc, "tags": tags, "multi": multi}
                    if sid in extra["choices"]: f["choice"] = extra["choices"][sid]
                    if sid in extra["prereqs"]: f["prereqs"] = [["feat:" + x for x in grp] for grp in extra["prereqs"][sid]]
                    if sid in extra.get("prereqNotes", {}): f["prereqNote"] = extra["prereqNotes"][sid]
                    data["feats"].append(f)
    return data

def main():
    html_path = ROOT / "build" / "guide.html"
    html_path.parent.mkdir(exist_ok=True)
    subprocess.run(["pandoc", str(SRC), "-t", "html", "--wrap=none",
                    "--extract-media", str(html_path.parent), "-o", str(html_path)], check=True)
    soup = BeautifulSoup(html_path.read_text(encoding="utf-8"), "html.parser")

    # split into sections at each H1
    sections, cur = [], None
    for el in list(soup.body.children if soup.body else soup.children):
        if getattr(el, "name", None) == "h1":
            cur = {"title": el.get_text(" ", strip=True), "nodes": []}
            sections.append(cur)
        elif cur is not None and getattr(el, "name", None):
            cur["nodes"].append(el)
    by_norm = {norm(s["title"]): s for s in sections}

    nav = []
    for g, titles in GROUPS:
        if g == "World Bible" and not INCLUDE_WORLD: continue
        items = []
        for t in titles:
            s = by_norm.get(norm(t))
            if not s: print("  note: no section named", t); continue
            s["slug"] = slug(t)
            items.append(s)
        nav.append((g, items))
    used = {id(s) for _, it in nav for s in it}
    for s in sections:
        if id(s) not in used and norm(s["title"]) != "table of contents":
            print("  note: section not placed in sidebar:", s["title"])

    if OUT.exists(): shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    if (html_path.parent / "media").exists():
        shutil.copytree(html_path.parent / "media", OUT / "media")
    shutil.copy(ROOT / "assets" / "wiki.css", OUT / "assets" / "wiki.css")
    shutil.copy(ROOT / "assets" / "wiki.js", OUT / "assets" / "wiki.js")
    (OUT / ".nojekyll").write_text("")

    flat = [s for _, it in nav for s in it]
    index = []
    template = (ROOT / "assets" / "page.html").read_text(encoding="utf-8")

    def sidebar(active):
        out = []
        for g, items in nav:
            out.append(f'<div class="grp"><h3>{g}</h3><ul>')
            for s in items:
                cls = ' class="on"' if s is active else ""
                out.append(f'<li><a{cls} href="{s["slug"]}.html">{s["title"]}</a></li>')
            out.append("</ul></div>")
        out.append('<div class="grp"><h3>Tools</h3><ul><li><a%s href="builder.html">Character Builder</a></li></ul></div>' % (' class="on"' if active == "builder" else ""))
        return "\n".join(out)

    for i, s in enumerate(flat):
        body = BeautifulSoup("".join(str(n) for n in s["nodes"]), "html.parser")
        # drop empty headings (empty "section" anchors from the docx)
        for h in body.find_all(re.compile("^h[1-6]$")):
            if not h.get_text(strip=True): h.decompose()
        # wrap tables so wide ones scroll
        for t in body.find_all("table"):
            fix_table(t, soup)
            w = soup.new_tag("div", attrs={"class": "tablewrap"}); t.wrap(w)
        # in-page TOC from h2/h3, and search records per h2 block
        toc = []
        for h in body.find_all(["h2", "h3"]):
            toc.append((h.name, h.get("id") or "", h.get_text(" ", strip=True)))
        # search index: one record per h2 block (plus the intro before the first h2)
        recs, head, buf = [], (s["title"], ""), []
        def flush():
            text = re.sub(r"\s+", " ", " ".join(buf)).strip()
            if text: recs.append({"page": s["slug"], "page_title": s["title"],
                                  "heading": head[0], "anchor": head[1], "text": text})
        for n in body.children:
            if getattr(n, "name", None) == "h2":
                flush(); buf = []; head = (n.get_text(" ", strip=True), n.get("id") or "")
            elif getattr(n, "get_text", None):
                buf.append(n.get_text(" ", strip=True))
        flush(); index += recs
        tochtml = "".join(f'<a class="{c}" href="#{a}">{t}</a>' for c, a, t in toc if t)
        prev_l = f'<a href="{flat[i-1]["slug"]}.html">&larr; {flat[i-1]["title"]}</a>' if i else "<span></span>"
        next_l = f'<a href="{flat[i+1]["slug"]}.html">{flat[i+1]["title"]} &rarr;</a>' if i < len(flat)-1 else "<span></span>"
        page = (template.replace("{{TITLE}}", s["title"]).replace("{{SIDEBAR}}", sidebar(s))
                .replace("{{BODY}}", str(body)).replace("{{TOC}}", ('<h3>On this page</h3>' + tochtml) if tochtml else "")
                .replace("{{BODYCLASS}}", "").replace("{{PREV}}", prev_l).replace("{{NEXT}}", next_l).replace("{{ROOTPREFIX}}", ""))
        (OUT / f"{s['slug']}.html").write_text(page, encoding="utf-8")

    data = extract_data(sections, soup)
    (OUT / "data.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    print(f"Data: {len(data['startTypes'])} start types, {len(data['feats'])} feats")

    # builder page
    bmark = (ROOT / "assets" / "builder.html").read_text(encoding="utf-8")
    bpage = (template.replace("{{TITLE}}", "Character Builder").replace("{{SIDEBAR}}", sidebar("builder"))
             .replace("{{BODY}}", bmark).replace("{{TOC}}", "").replace("{{PREV}}", "<span></span>")
             .replace("{{NEXT}}", "<span></span>").replace("{{BODYCLASS}}", "wide")
             .replace("<h1>Character Builder</h1>", ""))
    (OUT / "builder.html").write_text(bpage, encoding="utf-8")
    shutil.copy(ROOT / "assets" / "builder.js", OUT / "assets" / "builder.js")

    # home page
    cards = []
    for g, items in nav:
        if g == "Start Here": continue
        lis = "".join(f'<li><a href="{s["slug"]}.html">{s["title"]}</a></li>' for s in items)
        cards.append(f'<section class="card"><h2>{g}</h2><ul>{lis}</ul></section>')
    home = (template.replace("{{TITLE}}", "Constellations").replace("{{SIDEBAR}}", sidebar(None))
            .replace("{{BODY}}", (ROOT / "assets" / "home.html").read_text(encoding="utf-8").replace("{{CARDS}}", "".join(cards)))
            .replace("{{TOC}}", "").replace("{{PREV}}", "<span></span>").replace("{{BODYCLASS}}", "")
            .replace("{{NEXT}}", f'<a href="{flat[0]["slug"]}.html">{flat[0]["title"]} &rarr;</a>').replace("{{ROOTPREFIX}}", ""))
    (OUT / "index.html").write_text(home, encoding="utf-8")
    (OUT / "search-index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"Built {len(flat)} pages, {len(index)} search records -> {OUT}")

if __name__ == "__main__":
    main()
