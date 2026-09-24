const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const environment = require('../src/config/environment');
const { createLocalOcrService } = require('../src/services/localOcrService');

const fixtures = [
  { name: 'synthetic-jpeg.jpg', mimeType: 'image/jpeg', expected: ['SYNTHETIC JPEG'] },
  { name: 'synthetic-png.png', mimeType: 'image/png', expected: ['SYNTHETIC PNG'] },
  {
    name: 'synthetic-two-page.pdf',
    mimeType: 'application/pdf',
    expected: ['SYNTHETIC PDF PAGE ONE', 'SYNTHETIC PDF PAGE TWO']
  }
];

function normalizeText(text) {
  return text.normalize('NFKC').replace(/[^a-zA-Z0-9]+/g, ' ').toUpperCase();
}

async function runOcrSmoke() {
  const fixtureDirectory = path.join(__dirname, '../tests/fixtures/ocr');
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'arktiesiis-ocr-smoke-'));

  try {
    const service = createLocalOcrService({
      ocrConfig: environment.ocr,
      uploadConfig: environment.upload,
      temporaryDirectory
    });
    for (const fixture of fixtures) {
      const result = await service.processDocument(
        path.join(fixtureDirectory, fixture.name),
        fixture.mimeType
      );
      const text = normalizeText(result.text);
      const indexes = fixture.expected.map((phrase) => text.indexOf(phrase));
      if (indexes.some((index) => index < 0)) {
        throw new Error('Expected fixture text was not recognized.');
      }
      if (indexes.some((index, position) => position > 0 && index <= indexes[position - 1])) {
        throw new Error('PDF page text was not returned in page order.');
      }
      if ((await fs.readdir(temporaryDirectory)).length !== 0) {
        throw new Error('OCR left files in its temporary directory.');
      }
    }
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  runOcrSmoke().then(() => {
    process.stdout.write('OCR smoke passed for synthetic JPEG, PNG, and two-page PDF; page order and temporary-file cleanup verified.\n');
  }).catch(() => {
    process.stderr.write('OCR smoke failed. Check Tesseract, English language data, Poppler, and the configured executable paths.\n');
    process.exitCode = 1;
  });
}

module.exports = { normalizeText, runOcrSmoke };
