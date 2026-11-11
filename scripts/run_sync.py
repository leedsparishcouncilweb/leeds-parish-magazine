#!/usr/bin/env python3
"""Hugo Fox attachment adapter, with a fallback for already published editions."""
import re
from html import unescape
from pathlib import Path
from urllib.parse import urljoin,urlparse,parse_qs,unquote
from bs4 import BeautifulSoup
import sync_pdfs as sync

original_links=sync.links_from_page

def links_from_page(source):
    response=sync.S.get(source,timeout=50)
    response.raise_for_status()
    html=response.text
    soup=BeautifulSoup(html,"html.parser")
    print("Source response:",response.status_code,"bytes:",len(html),"anchors:",len(soup.find_all("a")))
    # Diagnostic: Hugo Fox file cards sometimes store URLs in custom markup.
    # Keep logging short and avoid exposing cookies or other unrelated page HTML.
    for phrase in ("Aug 2022.pdf","Oct 26 Digital.pdf","Sept 2026 digital.pdf","Nov-2026","November 2026"):
        pos=html.lower().find(phrase.lower())
        if pos!=-1:
            print("Attachment markup around",phrase,repr(html[max(0,pos-950):pos+420]))
    # Public-page diagnostics for locating the JavaScript-populated file list.
    main=soup.find(id="main-content-bookmark") or soup.find("main")
    if main:
        print("MAIN OUTER HTML:",str(main.parent if main.name=="a" else main)[:11000])
    print("SCRIPTS:",[(x.get("src") or "") for x in soup.find_all("script") if x.get("src")][-35:])
    print("HTML TAIL:",html[-3500:])
    result={}
    # Parse URLs in any HTML attributes, not only links: Hugo Fox sometimes
    # embeds attachment references in data attributes and script JSON.
    for node in soup.find_all(True):
        for key,value in node.attrs.items():
            if isinstance(value,list):value=" ".join(value)
            if not isinstance(value,str):continue
            if not ("pdf" in value.lower() or "attachments.asp" in value.lower()):continue
            cleaned=unescape(value.strip()).replace("\\/","/")
            for candidate in [cleaned]:
                if not (candidate.startswith("http") or candidate.startswith("/")):continue
                link=urljoin(response.url,candidate.split("#")[0])
                if sync.pdf_link(link):
                    result.setdefault(link,sync.label_for(node,link))
    # Look for attachment URLs inside JavaScript-embedded text.
    for match in re.findall(r"(?:https?://[^\s\"'<>]+|/shared/attachments\.asp\?[^\s\"'<>]+)",html,re.I):
        link=unescape(match).replace("\\/","/")
        link=link.rstrip(");,")
        link=urljoin(response.url,link)
        if sync.pdf_link(link):result.setdefault(link,parse_qs(urlparse(link).query).get("o",[""])[0])
    print("Discovered PDF URLs:",len(result))
    if not result:
        print("HTML sample:",re.sub(r"\s+"," ",soup.get_text(" ",strip=True))[:900])
        print("HTML link samples:",[str(x.get("href",""))[:150] for x in soup.find_all("a",href=True)[:25]])
    # Include every official known link until Hugo Fox starts exposing its links
    # in a conventional form. This allows the first sync to build cover thumbnails.
    for existing in sync.previous_seed_links():
        result.setdefault(*existing)
    return list(result.items())[:80]

def known():
    try:
        catalogue=sync.json.loads(sync.MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [(i.get("sourceUrl"),i.get("sourceTitle",i.get("title",""))) for i in catalogue.get("issues",[]) if i.get("sourceUrl")]

sync.previous_seed_links=known
sync.links_from_page=links_from_page
if __name__=="__main__":
    raise SystemExit(sync.main())
