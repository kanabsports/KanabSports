"""Render immutable, public Instagram assets from verified Kanab wins."""
import json
import random
import re
from datetime import date
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "social/cards"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
CREAM, RED, INK = "#fff3df", "#ff453d", "#151416"


def validate(g):
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,125}", g["id"]):
        raise ValueError("Invalid game id")
    date.fromisoformat(g["date"])
    if g["team"] not in {"Cowboys", "Cowgirls", "Lady Cowboys"}:
        raise ValueError("Unknown team")
    for field in ("sport", "opponent"):
        if not isinstance(g[field], str) or not 1 <= len(g[field].strip()) <= 64:
            raise ValueError(f"Invalid {field}")
    scores = (g["teamScore"], g["opponentScore"])
    if any(type(n) is not int or not 0 <= n <= 999 for n in scores) or scores[0] <= scores[1]:
        raise ValueError("Expected a final Kanab win")
    url = urlparse(g["maxprepsUrl"])
    if url.scheme != "https" or url.hostname not in {"maxpreps.com", "www.maxpreps.com"}:
        raise ValueError("Missing MaxPreps source")


def render(g, height):
    im = Image.new("RGB", (1080, height), INK)
    d = ImageDraw.Draw(im)
    def line(text, x, y, size, width=936, color=CREAM, anchor="lm"):
        while size > 10:
            f = ImageFont.truetype(FONT, size)
            if d.textlength(text, font=f) <= width:
                break
            size -= 2
        d.text((x, y), text, font=f, anchor=anchor, fill=color)
    # Original screen-print landscape; the same composition fits both safe areas.
    base = (height - 1080) // 2
    rng = random.Random(g["id"])
    for i in range(3):
        y = base + 190 + i * 65
        ridge = [(x, y + rng.randrange(-65, 36)) for x in range(-10, 1121, 46)]
        d.polygon([(0, height)] + ridge + [(1080, height)], fill=["#331c24", "#512029", "#70212a"][i])
    for _ in range(62):
        x, y = rng.randrange(1080), rng.randrange(height)
        if y < base+270 or y > base+960:
            d.polygon([(x,y),(x+8,y-3),(x+12,y+3),(x+4,y+7)], fill=rng.choice(["#943135","#b84336","#b29377"]))
    d.rectangle((56,base+70,64,base+125),fill=RED)
    line("KANAB SPORTS",82,base+96,36)
    line(g["sport"].upper(),1008,base+96,27,410,anchor="rm")
    line(g["team"].upper(),64,base+319,168)
    line("WIN!",60,base+482,224,color=CREAM)
    d.rectangle((62,base+620,1018,base+906), fill=INK)
    d.rectangle((62,base+620,1018,base+632), fill=RED)
    for i,(name,score) in enumerate([("KANAB",g["teamScore"]),(g["opponent"].upper(),g["opponentScore"])]):
        y=base+700+i*133
        line(name,91,y,60,710)
        line(str(score),985,y,89,148,color=RED if not i else CREAM,anchor="rm")
    d.line((90,base+764,985,base+764),fill="#4d4142",width=2)
    day=date.fromisoformat(g["date"])
    line(f"FINAL   /   {day:%b} {day.day}, {day.year}".upper(),65,base+962,25,515)
    line("@kanabsports",1010,base+962,25,340,anchor="rm")
    return im


if __name__ == "__main__":
    games = json.loads((ROOT / "social/games.json").read_text())
    if len({g["id"] for g in games}) != len(games):
        raise ValueError("Duplicate game IDs")
    for g in games:
        validate(g)
        folder = OUT / g["id"]
        folder.mkdir(parents=True, exist_ok=True)
        for name, h in [("feed",1080),("story",1920)]:
            path = folder / (name+".jpg")
            if not path.exists():
                render(g,h).save(path, quality=91, optimize=True, progressive=False)
