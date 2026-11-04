# PDF browser discovery

The PDF service previously relied on Puppeteer's downloaded Chrome unless an executable was configured explicitly. On this computer that download was absent, causing document thermal-PDF requests to fail with `Could not find Chrome`.

The service now resolves browsers in this order:

1. A configured `PUPPETEER_EXECUTABLE_PATH` (invalid explicit paths report a configuration error).
2. An existing Puppeteer browser download.
3. Installed Chrome, Edge, or Chromium in standard system/user locations.

The existing sandbox setting and shared browser lifecycle are preserved. Browser resolution supports the installed Puppeteer's asynchronous API. `.env.example` documents the optional executable setting; `.env` was not changed.

Verification: the backend build and 25 PDF-related tests passed. Four actual PDFs (invoice/document, regular/thermal) were generated concurrently with `C:\Program Files\Google\Chrome\Application\chrome.exe`, without database access. Synthetic PDFs and results are in `.work/pdf-browser-verification`.

Restart a backend process running the previous build before retrying the PDF request. Watch-mode servers may already have reloaded the updated source.
