#!/usr/bin/env python3
"""Rebuild data/fonts.json from the platform vendors' own font lists.

    python3 scripts/build.py                       # fetch all sources
    python3 scripts/build.py --apple apple.html --android fonts.xml --windows win11.html

Sources
  iOS, macOS  https://developer.apple.com/fonts/system-fonts/
              (only faces Apple marks "System font" for that OS are counted;
              "downloadable" and "document support" faces are not preinstalled)
  Android     data/fonts/fonts.xml on the AOSP main branch
  Windows     https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list
              (the main table only; Feature On Demand packages are not preinstalled)

Hand-curated facts the vendors don't publish (which script a font covers,
whether it is a sans, serif, mono…, and the ready-made font stacks) live in
data/meta.json and are merged in here. Fonts missing from meta.json are
reported so they can be added.

The page (index.html) reads data/fonts.json at runtime; nothing else is
generated. Standard library only.
"""
import argparse, base64, datetime, html, json, re, sys, urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APPLE_URL = "https://developer.apple.com/fonts/system-fonts/"
ANDROID_URL = ("https://android.googlesource.com/platform/frameworks/base/"
               "+/refs/heads/main/data/fonts/fonts.xml?format=TEXT")
WINDOWS_URL = "https://learn.microsoft.com/en-us/typography/fonts/windows_11_font_list"
PLATFORMS = ["ios", "android", "macos", "windows"]

# --- Apple (iOS and macOS) --------------------------------------------------

STYLE = (r"(Plain:1\.0|Plain|Ultra ?Light|Extra ?Light|Extra ?Bold|Extra ?Black|"
         r"Ultra ?Bold|Semi ?Bold|Demi ?Bold|Semi|Demi|Ultra|Extra|Condensed|Oblique|Italic|Regular|"
         r"Semibold|Demibold|Ultralight|Extrabold|Medium|Light|Bold|Heavy|Black|Thin|Book|Roman|Wide|"
         r"BoldOblique|Inclined|Extended|Inline|Solid|Text|W[0-9]+)")

# Faces whose family name can't be found by trimming style words.
APPLE_FAMILY = {
    "Arial Rounded MT Bold": "Arial Rounded MT Bold",
    "Bodoni Ornaments": "Bodoni Ornaments",
    "Bradley Hand Bold": "Bradley Hand",
    "DIN Condensed Bold": "DIN Condensed",
    "DIN Alternate Bold": "DIN Alternate",
    "Marker Felt Thin": "Marker Felt",
    "Marker Felt Wide": "Marker Felt",
    "Papyrus Condensed": "Papyrus",
    "SignPainter-HouseScript": "SignPainter",
    "SignPainter": "SignPainter",
    "Apple Braille Outline 6 Dot": "Apple Braille",
    "Apple Braille Outline 8 Dot": "Apple Braille",
    "Apple Braille Pinpoint 6 Dot": "Apple Braille",
    "Apple Braille Pinpoint 8 Dot": "Apple Braille",
}
APPLE_PREFIX = [  # longest match wins
    "Avenir Next Condensed", "Avenir Next", "Bodoni 72 Oldstyle",
    "Bodoni 72 Smallcaps", "Futura", "Hoefler Text", "Noto Sans Syriac",
    "STIX Two Text", "STIX Two Math", "Times New Roman", "Sukhumvit Set",
    "Hiragino Sans GB", "Hiragino Sans",
]


def apple_family(face):
    if face in APPLE_FAMILY:
        return APPLE_FAMILY[face]
    for p in sorted(APPLE_PREFIX, key=len, reverse=True):
        if face == p or face.startswith(p + " "):
            return p
    prev = None
    while prev != face:
        prev = face
        m = re.match(r"^(.*\S) " + STYLE + "$", face)
        if m:
            face = m.group(1)
    return APPLE_FAMILY.get(face, face)


def parse_apple(page):
    """-> {"ios": {family: [faces]}, "macos": {family: [faces]}}"""
    out = {"ios": {}, "macos": {}}
    for item in page.split('<li class="font-item">')[1:]:
        name = html.unescape(
            re.search(r'class="filter-font-name">([^<]*)<', item).group(1)).strip()
        flags = [f.strip() for f in re.findall(r'<span class="hidden">([^<]*)</span>', item)]
        for key, flag in (("ios", "system font iOS"), ("macos", "system font macOS")):
            if flag in flags:
                out[key].setdefault(apple_family(name), []).append(name)
    return out


# --- Android ----------------------------------------------------------------

ANDROID_NAME = {  # file stem -> family name, where CamelCase splitting fails
    "NotoSansCJK": "Noto Sans CJK", "NotoSerifCJK": "Noto Serif CJK",
    "NotoSansNKo": "Noto Sans NKo", "NotoSansPhagsPa": "Noto Sans PhagsPa",
    "CarroisGothicSC": "Carrois Gothic SC",
}
ANDROID_FOLD = {  # variants shown under their parent family
    "NotoColorEmojiFlags": "NotoColorEmoji", "NotoColorEmojiLegacy": "NotoColorEmoji",
}
GENERIC = {"sans-serif", "serif", "monospace", "cursive", "fantasy"}


def stem(filename):
    s = re.sub(r"\.(ttf|otf|ttc)$", "", filename)
    s = re.sub(r"-.*$", "", s)
    s = ANDROID_FOLD.get(s, s)
    if s.endswith("UI") and s.startswith("Noto"):
        s = s[:-2]
    return s


def android_name(s):
    return ANDROID_NAME.get(s) or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)


def parse_android(xml_text):
    """-> (set of families, {lowercase alias: family it resolves to})"""
    root = ET.fromstring(xml_text)
    fams, named = set(), {}
    for fam in root.iter("family"):
        files = [(f.text or "").strip().split()[0] for f in fam.iter("font")]
        names = {android_name(stem(f)) for f in files if f}
        fams |= names
        if fam.get("name") and names:
            named[fam.get("name")] = sorted(names)[0]
    aliases = {}
    for a in root.iter("alias"):
        name, to = a.get("name"), a.get("to")
        if a.get("weight") or name in GENERIC or "serif" in name or to not in named:
            continue
        aliases[name.lower()] = named[to]
    return fams, aliases


# --- Windows ----------------------------------------------------------------

def parse_windows(page):
    """-> {family: [faces]} from the first table (fonts in every Windows 11 install)."""
    table = re.search(r"<table>(.*?)</table>", page, re.S).group(1)
    fams, family = {}, None
    for row in re.findall(r"<tr>(.*?)</tr>", table, re.S):
        cells = [html.unescape(re.sub(r"<[^>]+>", "", c)).strip()
                 for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]
        if len(cells) < 2 or cells[0] == "Font family":
            continue
        if cells[0]:
            family = cells[0]
        if family:
            fams.setdefault(family, []).append(cells[1])
    return fams


# --- Output -----------------------------------------------------------------

def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": "tinytype-build"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "replace")


def load(path, url):
    return Path(path).read_text("utf-8", "replace") if path else fetch(url)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apple", help="saved copy of Apple's System Fonts page")
    ap.add_argument("--android", help="saved fonts.xml (plain or base64)")
    ap.add_argument("--windows", help="saved copy of Microsoft's Windows 11 font list")
    ap.add_argument("--date", default=datetime.date.today().isoformat())
    args = ap.parse_args()

    apple = load(args.apple, APPLE_URL)
    android = load(args.android, ANDROID_URL)
    if not android.lstrip().startswith("<"):
        android = base64.b64decode(android).decode("utf-8")
    windows = load(args.windows, WINDOWS_URL)

    on = parse_apple(apple)
    droid, aliases = parse_android(android)
    on["android"] = {name: [] for name in droid}
    on["windows"] = parse_windows(windows)
    for key, fams in on.items():
        if len(fams) < 50:
            raise SystemExit("%s parsed suspiciously short (%d); has the source changed?"
                             % (key, len(fams)))

    meta_path = ROOT / "data" / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}
    facts = meta.get("fonts", {})

    rows, missing = [], []
    for name in sorted(set().union(*on.values()), key=str.lower):
        row = {"name": name}
        for key in PLATFORMS:
            row[key] = name in on[key]
        if not row["android"] and name.lower() in aliases:
            row["androidAlias"] = aliases[name.lower()]
        fact = facts.get(name)
        if fact is None:
            missing.append(name)
            fact = {}
        row["script"] = fact.get("script")
        row["style"] = fact.get("style")
        if fact.get("note"):
            row["note"] = fact["note"]
        rows.append(row)

    names = {r["name"] for r in rows}
    stacks = []
    for s in meta.get("stacks", []):
        unknown = [f for f in s["fonts"] if f not in names]
        if unknown:
            print("stack %r names fonts not in any list: %s" % (s["name"], ", ".join(unknown)),
                  file=sys.stderr)
        stacks.append(s)

    counts = {key: sum(1 for r in rows if r[key]) for key in PLATFORMS}
    counts["all"] = len(rows)
    counts["mobileBoth"] = sum(1 for r in rows if r["ios"] and r["android"])
    data = {
        "checked": args.date,
        "sources": {"ios": APPLE_URL, "macos": APPLE_URL,
                    "android": ANDROID_URL.split("?")[0], "windows": WINDOWS_URL},
        "counts": counts,
        "scripts": meta.get("scripts", {}),
        "androidAliases": aliases,
        "stacks": stacks,
        "fonts": rows,
    }
    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "data" / "fonts.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n")

    print("%d fonts: %d iOS, %d Android, %d macOS, %d Windows; %d on both mobile platforms"
          % (len(rows), counts["ios"], counts["android"], counts["macos"], counts["windows"],
             counts["mobileBoth"]))
    if missing:
        print("%d fonts have no entry in data/meta.json:\n  %s"
              % (len(missing), "\n  ".join(missing)), file=sys.stderr)


if __name__ == "__main__":
    main()
