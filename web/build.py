"""Inline src/*.js into the templates -> single self-contained HTML files."""
import pathlib
d = pathlib.Path(__file__).parent
touch = (d / "src/touch.js").read_text()
for tpl, core, out in (("template.html", "core.js", "trickwall.html"), ("template20.html", "core20.js", "trickwall20.html")):
    f = d / "src" / tpl
    if not f.exists():
        continue
    html = f.read_text().replace("/*CORE*/", touch + "\n" + (d / "src" / core).read_text())
    (d / out).write_text(html)
    print("wrote", out, len(html), "bytes")
