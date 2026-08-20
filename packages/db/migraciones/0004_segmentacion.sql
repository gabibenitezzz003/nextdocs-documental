ALTER TABLE documento
  ADD COLUMN documento_padre_id uuid REFERENCES documento(id) ON DELETE CASCADE,
  ADD COLUMN pagina_desde integer,
  ADD COLUMN pagina_hasta integer;

CREATE INDEX documento_por_padre ON documento (documento_padre_id, pagina_desde)
  WHERE documento_padre_id IS NOT NULL;
