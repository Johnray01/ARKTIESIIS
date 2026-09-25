function normalize(text = '') {
  return String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
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

function linkedStudentNameFound(extractedText, student = {}) {
  const normalizedText = ` ${normalize(extractedText)} `;
  const firstName = normalize(student.first_name);
  const lastName = normalize(student.last_name);
  if (!firstName || !lastName || firstName.length < 2 || lastName.length < 2) return false;
  return normalizedText.includes(` ${firstName} `) && normalizedText.includes(` ${lastName} `);
}

function possibleSchoolNameFound(extractedText) {
  return findPossibleSchoolNames(extractedText).length > 0;
}

function apparentGradeEntriesFound(extractedText) {
  return findApparentGradeEntries(extractedText).length > 0;
}

function candidateLines(extractedText, predicate) {
  return String(extractedText).split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line && predicate(line))
    .slice(0, 3)
    .map((line) => line.slice(0, 200));
}

function findPossibleSchoolNames(extractedText) {
  return candidateLines(extractedText, (line) => /\b(?:school|academy|college|university|institute|educational|education|learning center)\b/i.test(line));
}

function findApparentGradeEntries(extractedText) {
  return candidateLines(extractedText, (line) => {
    const hasGradeLabel = /\b(?:grade|grades|final grade|average|mark|score|rating)\b/i.test(line);
    const hasGradeLikeValue = /\b(?:[a-f][+-]?|\d{1,3}(?:\.\d+)?\s*%?)\b/i.test(line);
    const hasSubjectAndValue = /[a-z]{3,}.*\s(?:[a-f][+-]?|\d{1,3}(?:\.\d+)?\s*%?)$/i.test(line);
    return (hasGradeLabel && hasGradeLikeValue) || hasSubjectAndValue;
  });
}

function advisoryChecks(documentType, extractedText, student) {
  const checks = [{
    key: 'linked_student_name',
    label: 'Linked student name appears in the extracted text',
    found: linkedStudentNameFound(extractedText, student)
  }];

  if (documentType === 'report_card') {
    checks.push(
      { key: 'possible_school_name', label: 'Possible school name', found: possibleSchoolNameFound(extractedText), candidates: findPossibleSchoolNames(extractedText) },
      { key: 'apparent_grade_entries', label: 'Apparent grade entries', found: apparentGradeEntriesFound(extractedText), candidates: findApparentGradeEntries(extractedText) }
    );
  } else if (documentType === 'good_moral') {
    checks.push({ key: 'possible_school_name', label: 'Possible school name', found: possibleSchoolNameFound(extractedText), candidates: findPossibleSchoolNames(extractedText) });
  }

  return checks;
}

function form137AdvisoryChecks(extractedText, student) {
  const possibleSchoolNames = findPossibleSchoolNames(extractedText);
  return [
    {
      key: 'linked_student_name',
      label: 'Linked student name appears in the scanned text',
      found: linkedStudentNameFound(extractedText, student)
    },
    {
      key: 'possible_school_name',
      label: 'Possible school name',
      found: possibleSchoolNames.length > 0,
      candidates: possibleSchoolNames
    }
  ];
}

module.exports = {
  advisoryChecks,
  form137AdvisoryChecks,
  validateRequiredText,
  linkedStudentNameFound,
  possibleSchoolNameFound,
  apparentGradeEntriesFound,
  findPossibleSchoolNames,
  findApparentGradeEntries
};
