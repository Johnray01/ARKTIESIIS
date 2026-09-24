DECLARE @processorDefaultConstraint sysname;
DECLARE @dropDefaultConstraintSql NVARCHAR(MAX);

SELECT @processorDefaultConstraint = dc.name
FROM sys.default_constraints AS dc
INNER JOIN sys.columns AS c
    ON c.object_id = dc.parent_object_id
    AND c.column_id = dc.parent_column_id
WHERE dc.parent_object_id = OBJECT_ID(N'dbo.document_validations')
  AND c.name = N'processor';

IF @processorDefaultConstraint IS NOT NULL
BEGIN
    SET @dropDefaultConstraintSql = N'ALTER TABLE dbo.document_validations DROP CONSTRAINT '
        + QUOTENAME(@processorDefaultConstraint);
    EXEC sys.sp_executesql @dropDefaultConstraintSql;
END;

ALTER TABLE dbo.document_validations
ADD CONSTRAINT DF_document_validations_processor
    DEFAULT (N'Tesseract OCR') FOR processor;
