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
                .replace("{{PREV}}", prev_l).replace("{{NEXT}}", next_l).replace("{{ROOTPREFIX}}", ""))
        (OUT / f"{s['slug']}.html").write_text(page, encoding="utf-8")

    # home page
    cards = []
    for g, items in nav:
        if g == "Start Here": continue
        lis = "".join(f'<li><a href="{s["slug"]}.html">{s["title"]}</a></li>' for s in items)
        cards.append(f'<section class="card"><h2>{g}</h2><ul>{lis}</ul></section>')
    home = (template.replace("{{TITLE}}", "Constellations").replace("{{SIDEBAR}}", sidebar(None))
            .replace("{{BODY}}", (ROOT / "assets" / "home.html").read_text(encoding="utf-8").replace("{{CARDS}}", "".join(cards)))
            .replace("{{TOC}}", "").replace("{{PREV}}", "<span></span>")
            .replace("{{NEXT}}", f'<a href="{flat[0]["slug"]}.html">{flat[0]["title"]} &rarr;</a>').replace("{{ROOTPREFIX}}", ""))
    (OUT / "index.html").write_text(home, encoding="utf-8")
    (OUT / "search-index.json").write_text(json.dumps(index, ensure_ascii=False), encoding="utf-8")
    print(f"Built {len(flat)} pages, {len(index)} search records -> {OUT}")

if __name__ == "__main__":
    main()
