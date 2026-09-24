ALTER TABLE dbo.documents
ADD processing_started_at DATETIME2(3) NULL;
GO

CREATE INDEX IX_documents_status_processing_started_at
    ON dbo.documents (processing_started_at, id)
    WHERE status = 'processing';
