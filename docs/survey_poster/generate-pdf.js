const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

function imageToDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  return 'data:image/png;base64,' + buf.toString('base64');
}

async function main() {
  const puppeteer = require('puppeteer');
  const posterDir = path.resolve(__dirname);
  const htmlPath = path.join(posterDir, 'poster.html');
  const outPath = path.join(posterDir, 'fundivers-poster.pdf');
  const stylePath = path.join(posterDir, '../style/poster.css');
  const imgsDir = path.resolve(posterDir, '../../imgs');
  const logoPath = path.join(imgsDir, 'fd_logo.png');
  const boatPath = path.join(imgsDir, 'boat_pic.png');

  if (!fs.existsSync(htmlPath)) {
    console.error('poster.html not found');
    process.exit(1);
  }
  if (!fs.existsSync(logoPath)) {
    console.error('fd_logo.png not found at', logoPath);
    process.exit(1);
  }
  if (!fs.existsSync(boatPath)) {
    console.error('boat_pic.png not found at', boatPath);
    process.exit(1);
  }

  const logoData = imageToDataUrl(logoPath);
  const boatData = imageToDataUrl(boatPath);

  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/src="\.\.\/\.\.\/imgs\/fd_logo\.png"/, 'src="' + logoData + '"');
  html = html.replace(/src="\.\.\/\.\.\/imgs\/boat_pic\.png"/, 'src="' + boatData + '"');

  const css = fs.readFileSync(stylePath, 'utf8');
  html = html.replace(
    /<link\s+rel="stylesheet"\s+href="\.\.\/style\/poster\.css">/,
    '<style>\n' + css + '\n</style>'
  );

  const tempPath = path.join(posterDir, '.poster-pdf.html');
  fs.writeFileSync(tempPath, html, 'utf8');
  const fileUrl = pathToFileURL(tempPath).href;

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({
    width: 1122,
    height: 794,
    deviceScaleFactor: 2,
  });
  await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map(
        (img) =>
          img.complete
            ? Promise.resolve()
            : new Promise((r) => {
                img.onload = r;
                img.onerror = r;
              })
      )
    );
  });
  await new Promise((r) => setTimeout(r, 800));

  await page.pdf({
    path: outPath,
    format: 'A4',
    landscape: true,
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });
  await browser.close();
  if (process.env.DEBUG) {
    const debugPath = path.join(posterDir, 'poster-pdf-debug.html');
    fs.copyFileSync(tempPath, debugPath);
    console.log('Debug HTML written to', debugPath, '(open in browser to verify images)');
  }
  try {
    fs.unlinkSync(tempPath);
  } catch (_) {}
  console.log('Written:', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
