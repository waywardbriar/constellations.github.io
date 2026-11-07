#!/usr/bin/env python3
"""Builds the Constellations wiki from source/guide.docx into docs/.
Usage: python3 build_site.py   (needs pandoc and beautifulsoup4)"""
import json, re, shutil, subprocess, sys
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).parent
SRC = ROOT / "source" / "guide.docx"
OUT = ROOT / "docs"
INCLUDE_WORLD = True    # the Worlds section (set False to hide it from the site)

# Worlds. Each world lists the guide sections (H1 titles) that belong to it. To add a world,
# add an entry here once its sections are in the guide. The sidebar and the Worlds page follow.
WORLDS = [
    {"name": "Senexoth",
     "blurb": "A medium to small world of continents and tight archipelagos, circled by a ring of ancient debris.",
     "pages": ["The World At Large", "Settlements & Civilizations"],
     "files": ["senexoth-calendar.docx"]},
    # Worlds below keep their pages in their own files in source/worlds/. Every H1 in a file is a
    # page. To add or change a world, edit its .docx there (the order of the files is the order here).
    {"name": "Pri-Domhem",
     "blurb": "The homeworld of the Verge: its history, philosophy, peoples, culture and magic.",
     "files": ["pri-domhem.docx"]},
    {"name": "Fulcinis",
     "blurb": "The Weather Planet, and Anchor, the city built from the lands that were moved to its bay.",
     "files": ["fulcinis.docx"]},
    {"name": "The Verge",
     "blurb": "The wider setting: the planets and systems, and the language and terms used across them.",
     "files": ["the-verge-planets.docx", "the-verge-language.docx"]},
]
# Text on the Worlds pages that the public site leaves out: a paragraph that starts with one of
# these, plus the list straight after it. (GM-only material that should not be on a public page.)
HIDE_AFTER = []
# Alt text for pictures, by page slug, in the order they appear.
IMAGE_ALT = {"the-world-at-large": ["Map of Senexoth: its continents, island chains and star-marked settlements."]}

# Sidebar grouping. Keys are H1 titles in the guide (matched loosely).
GROUPS = [
    ("Start Here", ["Preamble"]),
    ("The Game Core", ["Stamina & The Bidding System", "Primary Stats", "Stability",
                       "Health - Injury Slots", "Conditions", "Disease", "Resistance", "Immunity"]),
    ("Character Creation", ["Advancement - Merit", "Senexoth Role Feats", "Building a Character",
                            "Feats", "Equipment"]),
    ("Gameplay & Magic", ["Scenes", "Spells"]),
]

def norm(s): return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()
def slug(s):
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = s.replace("\u2019", "").replace("'", "")
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")

def fix_table(t, soup):
    """Pandoc puts every row of a Word table into <thead> as <th>. Rebuild a real
    header: an optional title row (one wide cell), one column-header row, then body rows."""
    thead = t.find("thead")
    # a table with no real header (its first row is data, e.g. "21 % | Human"): make every row a body row
    if thead is not None and t.find("tbody") is not None:
        hr = thead.find_all("tr", recursive=False)
        if len(hr) == 1 and re.fullmatch(r"\d+\s*%", hr[0].get_text(" ", strip=True).split(" ")[0] + (" %" if "%" in hr[0].get_text() and not hr[0].get_text(" ", strip=True).split(" ")[0].endswith("%") else "")):
            for c in hr[0].find_all("th"): c.name = "td"
            t.find("tbody").insert(0, hr[0].extract()); thead.decompose(); return
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
    # roles
    data["roles"] = []
    for n in by[norm("Senexoth Role Feats")]["nodes"]:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            if head and head[0].lower().startswith("feat"):
                for r in body:
                    if len(r) >= 3:
                        data["roles"].append({"id": "role:" + slug(r[1]), "name": r[1], "feat": r[0], "featId": "feat:" + fid(r[0]), "desc": r[2]})
    # languages, backgrounds
    data["languages"] = []; data["backgrounds"] = []
    def nums(txt):
        txt = re.sub(r"\s+", "", txt)
        return [float(x) for x in re.findall(r"\d*\.?\d+", txt)]
    for n in by[norm("Building a Character")]["nodes"]:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            if head and head[0].lower().startswith("language"):
                for r in body:
                    if len(r) >= 2:
                        data["languages"].append({"id": "language:" + slug(r[0].split("(")[0]), "name": r[0], "spoken": r[1]})
                continue
            fields = {}
            for r in body:
                if len(r) == 2: fields[r[0].strip().lower()] = r[1]
            if "size class" not in fields: continue
            sz = fields["size class"]; vals = nums(sz)
            if "variable" in sz.lower() or not vals: rng = None
            else: rng = [min(vals), max(vals)]
            vis = re.sub(r"^vision:\s*", "", fields.get("vision", ""), flags=re.I)
            if re.search(r"\bor\b", vis): vmode, vopts = "choose", [x.strip() for x in re.split(r"\bor\b", vis)]
            else: vmode, vopts = "all", [x.strip() for x in vis.split(",") if x.strip()]
            mob = [[m.group(1), int(m.group(2))] for m in re.finditer(r"(Walk|Swim|Climb|Burrow|Aerial):\s*([+-]?\d+)", fields.get("mobility", ""))]
            feats = []
            for r in body:
                if len(r) == 3 and r[1] == "Background":
                    sid = fid(r[0]); f = {"id": "feat:" + sid, "name": r[0], "desc": r[2]}
                    if sid in extra.get("bgChoices", {}): f["choice"] = extra["bgChoices"][sid]
                    feats.append(f)
            data["backgrounds"].append({"id": "background:" + slug(cap), "name": cap, "about": head[0] if head else "",
                "naming": fields.get("naming", ""), "appearance": fields.get("appearance", ""), "sizeText": sz, "sizeRange": rng,
                "visionMode": vmode, "vision": vopts, "mobility": mob, "feats": feats})
    # equipment
    cats = []
    def add_item(cat, kind, r, **kw):
        sid = fid(r[1] if kind != "gear3" else r[1])
        pass
    eq = by[norm("Equipment")]["nodes"]
    items = []; qualities = []; conditions = []
    def slots_of(txt):
        return [x for x in re.findall(r"Head|Torso|Arms|Hands|Legs|Feet|Accessories|Over|Under|Variable", txt)]
    def money(txt):
        m = re.search(r"-?\d+", txt); return int(m.group()) if m else None
    seen_ids = set()
    def push(it):
        base = it["id"]; n = 2
        while it["id"] in seen_ids: it["id"] = base + "-" + str(n); n += 1
        seen_ids.add(it["id"]); items.append(it)
    for n in eq:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            hd = [h.lower() for h in head]
            if hd[:1] == ["quality"]:
                for r in body:
                    mod = money(r[1]) if r[1].strip("- ") else 0
                    qualities.append({"id": "quality:" + slug(r[0]), "name": r[0], "mod": mod or 0, "bonus": money(r[2]) or 0, "bids": r[3]})
                continue
            if hd[:1] == ["condition"]:
                for r in body:
                    conditions.append({"id": "condition:" + slug(r[0]), "name": r[0], "desc": r[1], "penalty": r[2]})
                continue
            if not cap and hd and re.fullmatch(r"\d+", head[0]): continue
            # tables whose first body row got swallowed as the header (Food)
            if head and re.fullmatch(r"\d+", head[0]):
                body = [head] + body; hd = ["cost", "name", "description"]
            if cap in ("Historical Items & Artifacts", "Travel") or not cap: continue
            if cap == "Weapons":
                cur = None
                for r in body:
                    if len(r) >= 6 and re.fullmatch(r"\d+", r[0]):
                        cur = {"id": "item:" + fid(r[1]), "name": r[1], "cat": "Weapons", "cost": int(r[0]), "range": r[2],
                               "bonus": money(r[3]) or 0, "dtype": r[4], "tags": [x.strip() for x in r[5].split(",") if x.strip()], "desc": ""}
                        push(cur)
                    elif cur is not None and len(r) == 1: cur["desc"] = (cur["desc"] + " " + r[0]).strip()
                continue
            for r in body:
                if not r or not re.fullmatch(r"\d+", r[0]): continue
                it = {"cost": int(r[0]), "cat": cap}
                if cap == "Armour":
                    it.update({"id": "item:" + fid(r[1]), "name": r[1], "guard": money(r[2]) or 0, "desc": r[3], "effects": r[4], "slots": slots_of(r[5])})
                elif cap == "Clothes & Other Items":
                    it.update({"id": "item:" + fid(r[1]), "name": r[1], "guard": money(r[2]) or 0, "desc": r[3], "slots": slots_of(r[4])})
                elif cap == "Property":
                    it.update({"id": "item:" + fid(r[1]), "name": r[1], "desc": r[2]})
                elif cap == "Vehicle":
                    it.update({"id": "item:" + fid(r[1]), "name": r[1], "passengers": r[2] if len(r) > 3 else "", "handling": r[3] if len(r) > 4 else "", "desc": r[-1]})
                else:
                    it.update({"id": "item:" + fid(r[1]), "name": r[1], "desc": r[2] if len(r) > 2 else ""})
                push(it)
    for it in items:
        if it["cat"] == "Weapons":
            it["abilities"] = [{"name": a.split(":")[0].strip(), "text": a.split(":", 1)[1].strip() if ":" in a else ""} for a in re.findall(r"\[([^\]]+)\]", it["desc"])]
    data["items"] = items; data["qualities"] = qualities; data["conditions"] = conditions
    data["guardCap"] = 6
    # spells: foci qualities and the component tables
    sp = {"foci": [], "shapes": [], "ranges": [], "elements": [], "durations": [], "augments": [], "afflictions": []}
    def num(txt, pat, default=0):
        m = re.search(pat, txt); return int(m.group(1)) if m else default
    for n in by[norm("Spells")]["nodes"]:
        for t in tables_in(n):
            cap, head, body = rows_of(t)
            if not head: continue
            h0 = head[0].lower()
            if h0 == "foci quality":
                for r in body:
                    info = r[1] if len(r) > 1 else ""
                    sp["foci"].append({"id": "foci:" + ("none" if r[0].lower().startswith("no ") else slug(r[0])), "name": r[0],
                        "cost": num(info, r"Material Requirements:\s*(\d+)\s*Merit"), "bonus": num(info, r"Bonus:\s*\+(\d+)"),
                        "penalty": num(info, r"Penalty:\s*-(\d+)"), "time": (re.search(r"Time(?:'s|:)\s*(.+?)\s*(?:\s+/\s+|Material Requirements:|$)", info) or [0, ""])[1],
                        "bids": (re.search(r"Bids:\s*(.+)$", info) or [0, ""])[1]})
                continue
            if h0 != "cost": continue
            key = {"shape": "shapes", "targets & range": "ranges", "element": "elements", "spell duration": "durations", "additional components": "augments"}.get(cap.lower())
            hd = [x.lower() for x in head]
            if key is None and len(hd) > 1 and hd[1] == "condition": key = "afflictions"
            if key is None and cap == "" and len(hd) > 1:
                key = {"name": "shapes", "type": "elements", "time": "durations", "component": "augments"}.get(hd[1])
            if key is None: continue
            for r in body:
                if not re.fullmatch(r"\d+", r[0].strip()): continue
                nm = r[1].strip().lstrip("*"); mag = bool(re.search(r" X$", nm)); base = re.sub(r" X$", "", nm)
                kind = {"shapes": "shape", "ranges": "target", "elements": "element", "durations": "duration", "augments": "addl", "afflictions": "affliction"}[key]
                e = {"id": kind + ":" + fid(nm), "name": base, "cost": int(r[0]), "mag": mag, "desc": r[2] if len(r) > 2 else ""}
                if key == "afflictions":
                    e["effect"] = r[3] if len(r) > 3 else ""; e["resolves"] = r[4] if len(r) > 4 else ""
                m = re.search(r"Requires Feat:\s*([^.*]+)", e["desc"])
                if m: e["requires"] = "feat:" + slug(m.group(1).strip()); e["desc"] = re.sub(r"\s*\*?Requires Feat:[^.]*\.?", "", e["desc"]).strip()
                sp[key].append(e)
    data["spells"] = sp
    data["choiceOptions"] = extra.get("choiceOptions", {})
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
    guide_sections = list(sections)

    # world files: each H1 in source/worlds/<file> becomes a page of that world
    for w in WORLDS:
        for fn in w.get("files", []):
            p = ROOT / "source" / "worlds" / fn
            if not p.exists(): print("  note: missing world file", fn); continue
            stem = p.stem
            wdir = ROOT / "build" / ("w_" + stem); wdir.mkdir(parents=True, exist_ok=True)
            whtml = wdir / (stem + ".html")
            subprocess.run(["pandoc", str(p), "-t", "html", "--wrap=none", "--extract-media", str(wdir), "-o", str(whtml)], check=True)
            wsoup = BeautifulSoup(whtml.read_text(encoding="utf-8"), "html.parser")
            for img in wsoup.find_all("img"):
                src = img.get("src", "")
                i = src.find("media/")
                if i >= 0: img["src"] = "media/" + stem + "/" + src[i + 6:]
            wc = None
            for el in list(wsoup.body.children if wsoup.body else wsoup.children):
                if getattr(el, "name", None) == "h1":
                    wc = {"title": el.get_text(" ", strip=True), "nodes": []}
                    sections.append(wc); w.setdefault("pages", []).append(wc["title"])
                elif wc is not None and getattr(el, "name", None):
                    wc["nodes"].append(el)
            if (wdir / "media").exists():
                shutil.copytree(wdir / "media", ROOT / "build" / "_wmedia" / stem, dirs_exist_ok=True)
    by_norm = {}
    for s_ in sections:
        k = norm(s_["title"])
        if k and k in by_norm and k != "table of contents": sys.exit("Two pages share the title: " + s_["title"])
        by_norm[k] = s_

    nav = []
    for g, titles in GROUPS:
        items = []
        for t in titles:
            s = by_norm.get(norm(t))
            if not s: print("  note: no section named", t); continue
            s["slug"] = slug(t)
            items.append(s)
        nav.append((g, items))
    if INCLUDE_WORLD and WORLDS:
        cards = []
        for w in WORLDS:
            pages = []
            for t in w["pages"]:
                sec = by_norm.get(norm(t))
                if not sec: print("  note: no section named", t); continue
                sec["slug"] = slug(t); sec["world"] = w["name"]; pages.append(sec)
            if not pages: continue
            w["_pages"] = pages
            lis = "".join(f'<li><a href="{x["slug"]}.html">{x["title"]}</a></li>' for x in pages)
            cards.append(f'<section class="card"><h2><a href="{pages[0]["slug"]}.html">{w["name"]}</a></h2><p>{w.get("blurb", "")}</p><ul>{lis}</ul></section>')
        intro = ('<p class="lede">Constellations is played across different worlds. Each has its own places, peoples and history.</p>'
                 '<div class="cards">' + "".join(cards) + '</div>')
        index_sec = {"title": "Worlds", "slug": "worlds", "nodes": [t for t in BeautifulSoup(intro, "html.parser").children if getattr(t, "name", None)]}
        wl = [x for w in WORLDS for x in w.get("_pages", [])]
        nav.append(("Worlds", [index_sec] + wl))
    used = {id(s) for _, it in nav for s in it}
    for s in sections:
        if id(s) not in used and norm(s["title"]) not in ("table of contents", ""):
            print("  note: section not placed in sidebar:", s["title"])

    if OUT.exists(): shutil.rmtree(OUT)
    (OUT / "assets").mkdir(parents=True)
    if (html_path.parent / "media").exists():
        shutil.copytree(html_path.parent / "media", OUT / "media")
    if (ROOT / "build" / "_wmedia").exists():
        shutil.copytree(ROOT / "build" / "_wmedia", OUT / "media", dirs_exist_ok=True)
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
            last = None
            for s in items:
                if s.get("world") and s["world"] != last:
                    out.append(f'<li class="sub">{s["world"]}</li>'); last = s["world"]
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
        # leave out GM-only passages named in HIDE_AFTER
        for para in body.find_all("p"):
            txt = para.get_text(" ", strip=True)
            if any(txt.startswith(h) for h in HIDE_AFTER):
                nxt = para.find_next_sibling()
                if nxt is not None and nxt.name in ("ul", "ol"): nxt.decompose()
                para.decompose(); print("  note: left out a hidden passage:", txt[:50])
        for img, alt in zip(body.find_all("img"), IMAGE_ALT.get(s["slug"], [])):
            if not img.get("alt"): img["alt"] = alt
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

    data = extract_data(guide_sections, soup)
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
