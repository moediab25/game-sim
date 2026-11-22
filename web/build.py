"""Inline src/core.js into src/template.html -> trickwall.html (single self-contained file)."""
import pathlib
d = pathlib.Path(__file__).parent
t = (d / "src/template.html").read_text()
core = (d / "src/core.js").read_text()
(d / "trickwall.html").write_text(t.replace("/*CORE*/", core))
print("wrote trickwall.html", len(t) + len(core), "bytes")
