
$env:TESSERACT_PATH = "C:\Users\USER\scoop\apps\tesseract\current\tesseract.exe"
$env:PDFINFO_PATH = "C:\Users\USER\poppler\poppler-24.07.0\Library\bin\pdfinfo.exe"
$env:PDFTOPPM_PATH = "C:\Users\USER\poppler\poppler-24.07.0\Library\bin\pdftoppm.exe"
$env:TESSDATA_PREFIX = "C:\Users\USER\scoop\apps\tesseract-languages\current"

$env:PATH = "C:\Program Files\nodejs;" + $env:PATH

$report = "--- Windows Edition/Version ---`n"
$report += (Get-ComputerInfo | Select-Object OsName, OsVersion, OsArchitecture | Out-String)

$report += "--- PowerShell Version ---`n"
$report += ($PSVersionTable | Out-String)

$report += "--- Node Version ---`n"
$report += (node --version | Out-String)
$report += "--- NPM Version ---`n"
$report += (npm --version | Out-String)

$report += "--- Executable Paths ---`n"
$report += "TESSERACT_PATH: $env:TESSERACT_PATH`n"
$report += "PDFINFO_PATH: $env:PDFINFO_PATH`n"
$report += "PDFTOPPM_PATH: $env:PDFTOPPM_PATH`n"
$report += "TESSDATA_PREFIX: $env:TESSDATA_PREFIX`n`n"

$report += "--- Tesseract Version and Langs ---`n"
$report += (& $env:TESSERACT_PATH --version 2>&1 | Out-String)
$report += (& $env:TESSERACT_PATH --list-langs 2>&1 | Out-String)

$report += "--- Poppler Version ---`n"
$report += (& $env:PDFINFO_PATH -v 2>&1 | Out-String)

$report += "--- npm ci ---`n"
$report += (npm ci 2>&1 | Out-String)
$report += "Exit Code: $LASTEXITCODE`n`n"

$report += "--- npm run ocr:smoke ---`n"
$report += (npm run ocr:smoke 2>&1 | Out-String)
$report += "Exit Code: $LASTEXITCODE`n`n"

$report += "--- npm run check ---`n"
$report += (npm run check 2>&1 | Out-String)
$report += "Exit Code: $LASTEXITCODE`n`n"

$report += "--- npm test ---`n"
$report += (npm test 2>&1 | Out-String)
$report += "Exit Code: $LASTEXITCODE`n"

Set-Content -Path report.txt -Value $report
Write-Host "Report saved to report.txt"

