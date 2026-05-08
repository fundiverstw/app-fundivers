# Survey poster

Landscape advertisement poster (QR codes: website, LINK, Instagram, survey). Generate a PDF:

```bash
npm run poster-pdf
```

Output: `posters/survey_poster/fundivers-poster.pdf`. You can also open `poster.html` in a browser and print to PDF (or paper) in landscape orientation.

**Background:** Add a landscape blue underwater/ocean image as `imgs/ocean_bg.jpg` for the poster background. If missing, a blue gradient is used.

**QR corners (replace placeholders in `poster.html`):**
- **Top-left:** Website — already set to https://www.fundiverstw.com
- **Top-right:** LINK — replace `linktr.ee/fundiverstw` with your real LINK profile URL
- **Bottom-left:** Instagram — replace `instagram.com/fundiverstw` with your handle/URL
- **Bottom-right:** Survey — replace the `docs.google.com/forms/...` URL with your Google form link

To change a QR target: use [encodeURIComponent(yourUrl)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent) and put the result in the `data=` parameter of the `api.qrserver.com` URL for that corner.
