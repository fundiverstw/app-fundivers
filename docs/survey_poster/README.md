# Survey poster

Landscape advertisement poster (QR codes: website, LINK, Instagram, survey).
`fundivers-poster.pdf` is the last generated copy. You can also open
`poster.html` in a browser and print it to PDF (or paper) in landscape.

To regenerate the PDF with `generate-pdf.js`, it needs two images in an `imgs/`
folder at the repository root, `imgs/fd_logo.png` (copy `public/imgs/fd_logo.png`)
and `imgs/boat_pic.png` (not in the repository), and Puppeteer:

```bash
npm install --no-save puppeteer
node docs/survey_poster/generate-pdf.js
```

It writes `docs/survey_poster/fundivers-poster.pdf`.

For a photo background, add a landscape ocean image as `imgs/ocean_bg.jpg`;
without it the poster uses a blue gradient.

**QR corners (replace placeholders in `poster.html`):**
- **Top-left:** Website — already set to https://www.fundiverstw.com
- **Top-right:** LINK — replace `linktr.ee/fundiverstw` with your real LINK profile URL
- **Bottom-left:** Instagram — replace `instagram.com/fundiverstw` with your handle/URL
- **Bottom-right:** Survey — replace the `docs.google.com/forms/...` URL with your Google form link

To change a QR target: use [encodeURIComponent(yourUrl)](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/encodeURIComponent) and put the result in the `data=` parameter of the `api.qrserver.com` URL for that corner.
