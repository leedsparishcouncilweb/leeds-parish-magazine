#!/usr/bin/env python3
"""Discover all public Hugo Fox magazine PDFs, including URL-encoded .pdf links."""
from urllib.parse import urljoin, urlparse, parse_qs
from bs4 import BeautifulSoup
import sync_pdfs as sync

def attachment_key(url):
    """Use Hugo Fox's stable attachment identifier to deduplicate encoded URLs."""
    params=parse_qs(urlparse(url).query)
    return params.get("f",[url])[0].lower()

def links_from_page(source):
    response=sync.S.get(source,timeout=50)
    response.raise_for_status()
    soup=BeautifulSoup(response.text,"html.parser")

    # Preserve established URLs for already imported editions; the same link
    # can have a different percent-encoding on successive Hugo Fox requests.
    known=sync.json.loads(sync.MANIFEST.read_text(encoding="utf-8")) if sync.MANIFEST.exists() else {"issues":[]}
    previous=[(item.get("sourceUrl"),item.get("sourceTitle") or item.get("title",""))
              for item in known.get("issues",[]) if item.get("sourceUrl")]
    previous_by_id={attachment_key(url):url for url,_ in previous}

    results=[]
    used=set()
    for link in soup.select(".cms-attachments a[href]"):
        url=urljoin(response.url,link.get("href",""))
        if not sync.pdf_link(url):continue
        key=attachment_key(url)
        if key in used:continue
        used.add(key)
        # Only the publication title, not the File Uploaded date.
        title_tag=link.select_one(".dl-link-name")
        label=sync.clean(title_tag.get_text(" ",strip=True)) if title_tag else sync.label_for(link,url)
        results.append((previous_by_id.get(key,url),label))

    # Retain previously available issues even if the Hugo Fox site is
    # temporarily unavailable or removes an older attachment.
    for url,label in previous:
        key=attachment_key(url)
        if key not in used:
            results.append((url,label))
            used.add(key)
    print("Magazine PDFs discovered:",len(results),
          "| currently on Hugo Fox:",len(used.intersection(
              {attachment_key(urljoin(response.url,link.get("href","")))
               for link in soup.select(".cms-attachments a[href]")})))
    return results[:80]

sync.links_from_page=links_from_page
if __name__=="__main__":
    raise SystemExit(sync.main())
