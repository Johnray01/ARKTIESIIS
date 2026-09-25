ALTER TABLE dbo.document_decision_events
ADD verification_checklist_json NVARCHAR(500) NULL;

GO

ALTER TABLE dbo.document_decision_events
ADD CONSTRAINT CK_document_decision_event_verification_checklist
    CHECK (
        verification_checklist_json IS NULL
        OR (decision_type = 'verified' AND ISJSON(verification_checklist_json) = 1)
    );
