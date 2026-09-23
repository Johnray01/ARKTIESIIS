/**
 * ARKTIESIIS validation is NOT forensic verification.
 * It only checks OCR-readable content, required fields, completeness,
 * and configured format rules.
 */
function normalize(text = '') {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function validateRequiredText(extractedText, requirements = []) {
  const normalized = normalize(extractedText);
  const checks = requirements.map((requirement) => ({
    key: requirement.key,
    label: requirement.label,
    found: requirement.keywords.some((keyword) => normalized.includes(normalize(keyword)))
  }));

  return {
    checks,
    complete: checks.every((item) => item.found)
  };
}

module.exports = { validateRequiredText };
