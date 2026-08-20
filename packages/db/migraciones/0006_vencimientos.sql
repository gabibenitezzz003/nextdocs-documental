ALTER TABLE documento
  ADD COLUMN vence_en date,
  ADD COLUMN familia text;

CREATE INDEX documento_vencimiento
  ON documento (inquilino_id, vence_en)
  WHERE vence_en IS NOT NULL AND estado NOT IN ('RECHAZADO', 'DIVIDIDO');

CREATE INDEX documento_por_sujeto
  ON documento (inquilino_id, sujeto_tipo, sujeto_id)
  WHERE sujeto_id IS NOT NULL;
