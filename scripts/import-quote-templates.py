#!/usr/bin/env python3
"""Import the two owner-approved DOCX masters from the original quote-fill ZIP.

Usage: python3 scripts/import-quote-templates.py '/path/to/TIG_Quote_Fill_Codex_Package_v1(1).zip'
This script only writes the two fixture files; it never touches SharePoint.
"""
import sys
from pathlib import Path
from zipfile import ZipFile
from xml.etree import ElementTree as ET

TEMPLATES = ("COM-PRP-v1.8.docx", "BII-QSOW-v1.6.docx")
EXPECTED = {"COM-PRP-v1.8.docx": 62, "BII-QSOW-v1.6.docx": 60}
N = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

def tags(data):
    from io import BytesIO
    with ZipFile(BytesIO(data)) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    return {tag.get(N + "val") for tag in root.iter(N + "tag")}

def main():
    if len(sys.argv) != 2:
        raise SystemExit("Pass the path to the original approved quote-fill ZIP.")
    source = Path(sys.argv[1])
    if not source.is_file():
        raise SystemExit(f"Missing approved source ZIP: {source}")
    pending = {}
    with ZipFile(source) as z:
        for name in TEMPLATES:
            data = z.read("test/fixtures/" + name)
            actual = tags(data)
            if len(actual) != EXPECTED[name]:
                raise SystemExit(f"{name}: expected {EXPECTED[name]} unique content-control tags, got {len(actual)}")
            pending[name] = data
    target = Path(__file__).resolve().parent.parent / "test" / "fixtures"
    target.mkdir(parents=True, exist_ok=True)
    for name, data in pending.items():
        (target / name).write_bytes(data)
        print(f"Imported {name} ({len(data)} bytes, {len(tags(data))} unique tags)")
    print("Both approved Word masters imported; review and commit these binary files.")

if __name__ == "__main__":
    main()
