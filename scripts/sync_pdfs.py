#!/usr/bin/env python3
"""Automatically mirror public Parish Magazine PDFs from the Hugo Fox page.

Hugo Fox is the source of truth. GitHub Pages hosts cached public PDF copies
because cross-origin browser PDF reading would otherwise be unreliable.
"""
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse, parse_qs

import requests
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
DOCS=ROOT/"docs"
PDFS=DOCS/"pdfs"
COVERS=DOCS/"covers"
MANIFEST=DOCS/"library.json"
CONFIG=DOCS/"config.json"
MAX_BYTES=45*1024*1024
MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"]
MONTH_RE=re.compile(r"(?<![A-Za-z])(January|February|March|April|May|June|July|August|September|Sept|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*[-_/\s]*\s*(19\d{2}|20\d{2}|\d{2})(?!\d)",re.I)
S=requests.Session()
S.headers.update({"User-Agent":"Mozilla/5.0 (compatible; LeedsVillageMagazine/1.0)"})

def pdf_link(url):
    parsed=urlparse(url)
    return parsed.scheme in ("https","http") and ".pdf" in unquote(parsed.path+"?"+parsed.query).lower()

def clean(text):
    return re.sub(r"\s+"," ",text or "").strip()

def edition_date(label,url):
    filename=parse_qs(urlparse(url).query).get("o",[""])[0] or unquote(Path(urlparse(url).path).name)
    for candidate in (label,filename):
        candidate=re.split(r"(?i)\bFile\s+Uploaded\s*:",candidate)[0]
        found=MONTH_RE.search(candidate)
        if found:
            month=found.group(1).lower()[:3]
            month_number=next((i+1 for i,name in enumerate(MONTHS) if name.lower().startswith(month)),None)
            if month_number:
                year=int(found.group(2))
                if year<100:year+=2000 if year<70 else 1900
                return f"{year:04d}-{month_number:02d}",f"{MONTHS[month_number-1]} {year}"
    return "",""

def label_for(tag,url):
    candidates=[tag.get("title",""),tag.get("aria-label",""),clean(tag.get_text(" ",strip=True))]
    for parent in [tag.parent,tag.parent.parent if tag.parent else None]:
        if parent:
            candidates.append(clean(parent.get_text(" ",strip=True))[:240])
    candidates.append(parse_qs(urlparse(url).query).get("o",[""])[0])
    candidates.append(unquote(Path(urlparse(url).path).name))
    # Prefer a title that explicitly contains a month/year; never the upload date.
    for candidate in candidates:
        if candidate and MONTH_RE.search(re.split(r"(?i)\bFile\s+Uploaded\s*:",candidate)[0]):
            return candidate[:200]
    return next((x[:200] for x in candidates if x and len(x)>4),"Parish Magazine")

def links_from_page(source):
    response=S.get(source,timeout=50)
    response.raise_for_status()
    soup=BeautifulSoup(response.text,"html.parser")
    results={}
    for tag in soup.select("a[href],iframe[src],embed[src],object[data]"):
        href=tag.get("href") or tag.get("src") or tag.get("data")
        if not href:continue
        url=urljoin(response.url,href.split("#")[0])
        if pdf_link(url):
            results.setdefault(url,label_for(tag,url))
    return list(results.items())[:80]

def download(url):
    pieces=[]
    size=0
    with S.get(url,timeout=110,stream=True) as response:
        response.raise_for_status()
        for chunk in response.iter_content(chunk_size=262144):
            if not chunk:continue
            size+=len(chunk)
            if size>MAX_BYTES:raise ValueError("PDF exceeds 45MB")
            pieces.append(chunk)
    data=b"".join(pieces)
    if not data.startswith(b"%PDF-"):raise ValueError("The URL did not return PDF data")
    return data

def cover_image(data,path):
    import fitz
    with fitz.open(stream=data,filetype="pdf") as pdf:
        if not pdf.page_count:raise ValueError("Empty document")
        page=pdf[0]
        scale=min(460/page.rect.width,460/page.rect.height)
        pix=page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False,colorspace=fitz.csRGB)
        path.write_bytes(pix.tobytes("png"))

def slug(text):
    return re.sub(r"[^a-z0-9]+","-",text.lower()).strip("-")[:60] or "magazine"

def main():
    source=json.loads(CONFIG.read_text(encoding="utf-8"))["sourcePageUrl"]
    if not urlparse(source).scheme.startswith("http"):raise ValueError("Invalid source URL")
    discovered=links_from_page(source)
    if not discovered:
        print("No public PDFs discovered: existing catalogue kept.",file=sys.stderr)
        return 1
    PDFS.mkdir(parents=True,exist_ok=True)
    COVERS.mkdir(parents=True,exist_ok=True)
    previous=json.loads(MANIFEST.read_text(encoding="utf-8")) if MANIFEST.exists() else {"issues":[]}
    cache={i.get("sourceUrl"):i for i in previous.get("issues",[])}
    issues=[]
    used=set()
    errors=0
    for n,(url,label) in enumerate(discovered,1):
        date,title=edition_date(label,url)
        # Do not confuse upload dates with actual edition dates.
        if not date:
            print(f"Skipping undated PDF: {label}",file=sys.stderr)
            continue
        name=slug(title)
        ident=name
        if ident in used:ident+="-"+hashlib.sha1(url.encode()).hexdigest()[:7]
        used.add(ident)
        try:
            data=download(url)
            digest=hashlib.sha256(data).hexdigest()[:12]
            pdfname=f"{name}-{digest}.pdf"
            covername=f"{name}-{digest}.png"
            if not (PDFS/pdfname).exists():(PDFS/pdfname).write_bytes(data)
            if not (COVERS/covername).exists():cover_image(data,COVERS/covername)
            issues.append({"id":ident,"title":title,"editionDate":date,"sourceTitle":label,
                           "url":"pdfs/"+pdfname,"sourceUrl":url,"cover":"covers/"+covername})
            print(f"[{n}/{len(discovered)}] {title}: {len(data)//1024} KiB")
        except Exception as exc:
            errors+=1
            print(f"WARNING: {title}: {exc}",file=sys.stderr)
            old=cache.get(url)
            if old and str(old.get("url","")).startswith("pdfs/") and (DOCS/old["url"]).exists():
                issues.append(old)
    # Retain previously synced issues if the source webpage temporarily drops a link.
    # Avoid silently removing past publications during redesigns/outages.
    known={i.get("sourceUrl") for i in issues}
    for old in previous.get("issues",[]):
        if old.get("sourceUrl") not in known and str(old.get("url","")).startswith("pdfs/") and (DOCS/old["url"]).exists():
            issues.append(old)
    if not issues:
        print("No PDFs could be mirrored, keeping the previous library.",file=sys.stderr)
        return 1
    issues.sort(key=lambda i:(i.get("editionDate",""),i.get("title","")),reverse=True)
    manifest={"generatedAt":"","sourcePageUrl":source,"issues":issues}
    if manifest!=previous:
        MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print(f"Library ready: {len(issues)} editions; {errors} failures")
    return 0 if errors==0 else 1

if __name__=="__main__":
    sys.exit(main())
