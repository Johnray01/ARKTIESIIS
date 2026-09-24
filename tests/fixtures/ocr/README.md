# Synthetic OCR smoke fixtures

These generated, non-personal samples contain large, high-contrast text for checking that the installed OCR tools work together. The two-page PDF contains `SYNTHETIC PDF PAGE ONE` followed by `SYNTHETIC PDF PAGE TWO`.

Run `npm run ocr:smoke` after configuring Tesseract, English language data, and Poppler. The smoke command checks recognized phrases, PDF page order, and cleanup of its private temporary files. It does not access the database or change application data.
