# Leeds & Broomfield Parish Magazine

The page-turning PDF reader for Leeds & Broomfield Church & Village News.

## Website

Publish GitHub Pages from branch **main**, directory **/docs**. The eventual address is:

https://leedsparishcouncilweb.github.io/leeds-parish-magazine/

This project is separate from the council's existing news RSS repository.

## How it works

- The PDF files are uploaded only to [the existing Hugo Fox Parish News page](https://www.leedsparishcouncil.gov.uk/community/leeds-parish-council-18464/parish-news/).
- The GitHub Actions workflow runs daily (07:20 UTC) and on demand.
- The workflow discovers PDFs on that page, downloads same-origin copies, creates front-cover thumbnails, and updates the magazine catalogue.
- The viewer shows the **newest edition** in the main area, month/year from the publication title, and previous issues in the sidebar.
- PDF files are provided as **single pages**. The reader automatically presents the cover alone and subsequent pages in double-page spreads on larger screens; on narrow screens it shows individual pages.
- Readers may use animated page turns, page slider, zoom/full screen and the link back to the original.

## First-time publishing

1. **Settings → Pages → Build and deployment**: select **Deploy from a branch**, **main**, **/docs**, then Save.
2. **Settings → Actions → General → Workflow permissions**: allow **Read and write permissions** if the sync workflow lacks permission to commit.
3. **Actions → Sync Parish Magazine PDFs → Run workflow**. This first run downloads the PDFs and creates cover images.
4. Review the Actions log: all intended editions should appear under \`docs/pdfs/\`, and \`docs/library.json\` should reference local PDFs rather than external-host PDFs.
5. Visit the Pages URL above and add it to the parish website's menu.

The first sync is essential: browser CORS restrictions can otherwise prevent direct PDFs on Hugo Fox from displaying within the reader. The official PDFs remain available via the Original PDF link.

## Files

- \`docs/index.html\` — reader page
- \`docs/styles.css\` — appearance and responsive layout
- \`docs/app.js\` — PDF.js rendering and page flipping
- \`docs/library.json\` — edition index (rewritten by sync)
- \`docs/config.json\` — source webpage
- \`scripts/sync_pdfs.py\` — PDF discovery and caching
- \`.github/workflows/sync-pdfs.yml\` — daily automated refresh

## Notes

The magazine PDFs must be publicly accessible and authorised for public copying. The workflow only inspects public PDF links on the configured source webpage. If Hugo Fox changes its page markup, discovery may require an update. GitHub Pages and GitHub Actions quotas apply.
