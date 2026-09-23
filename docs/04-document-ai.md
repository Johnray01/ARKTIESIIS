# AI-Assisted Document Validation

## Intended flow
1. Uploader selects the document type before upload; AI does not classify it.
2. Server checks role permission, file type, and size.
3. File is stored securely and marked `processing`.
4. Server sends the document to Google Document AI for OCR/text extraction.
5. ARKTIESIIS applies required-field, completeness, and configured format/compliance checks for the uploader-selected type.
6. System stores the result and shows it to authorized users.
7. Documents that need judgment are sent to human review.

## Example validation
For a report card, configured rules may check for values such as:
- student name
- school name
- school year
- grade level
- grading information

The exact fields must be confirmed with the institution before final implementation.

## Status meanings
- `valid`: configured completeness/format rules passed.
- `needs_review`: OCR result is uncertain or one or more checks need human review.
- `failed`: processing failed or required checks could not be satisfied.

## Not included
- Forgery detection.
- Signature authentication.
- Seal authentication.
- Paper/material authenticity.
- Forensic examination.
- Training a new machine-learning model.
- Classifying a document or claiming it is authentic.

Google Document AI provides OCR/text extraction. Node.js handles application logic, API calls, storage, and validation rules. No custom model or forensic analysis is in scope.
