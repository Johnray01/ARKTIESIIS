# AI-Assisted Document Validation

## Intended flow
1. User selects the document type before upload.
2. Server checks role permission, file type, and size.
3. File is stored securely and marked `processing`.
4. Server sends the document to Google Document AI.
5. OCR/document parsing returns extracted text/data.
6. ARKTIESIIS applies document-type-specific validation rules.
7. System stores the result and shows it to authorized users.
8. Documents that need judgment are sent to human review.

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

Google Document AI provides the document processing/OCR capability. Node.js handles application logic, API calls, storage, and validation rules. PyTorch is not required for this architecture unless the thesis scope is formally changed to include a custom ML model.
