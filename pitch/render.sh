#!/bin/sh
# pptx -> pdf (LibreOffice) -> one PNG per slide (PyMuPDF), for review. Tools live in ~/money/.cache/pitch.
set -e
T=~/money/.cache/pitch
cd "$(dirname "$0")"
"$T"/lo/opt/libreoffice*/program/soffice -env:UserInstallation=file://$T/lo-profile --headless --convert-to pdf --outdir . Catalyst-pitch.pptx >/dev/null
rm -rf renders && mkdir renders
"$T"/venv/bin/python - <<'EOF'
import pymupdf
doc = pymupdf.open("Catalyst-pitch.pdf")
for i, p in enumerate(doc, 1):
    p.get_pixmap(dpi=110).save(f"renders/slide-{i}.png")
print(f"{doc.page_count} pages -> renders/")
EOF
