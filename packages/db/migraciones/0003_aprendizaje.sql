CREATE TABLE correccion_aprendida (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id    uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  plantilla_codigo text NOT NULL,
  emisor_clave    text NOT NULL DEFAULT '*',
  clave_campo     text NOT NULL,
  valor_leido     text NOT NULL,
  valor_corregido jsonb NOT NULL,
  veces           integer NOT NULL DEFAULT 1,
  ultimo_documento_id uuid REFERENCES documento(id) ON DELETE SET NULL,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  actualizado_en  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquilino_id, plantilla_codigo, emisor_clave, clave_campo, valor_leido)
);

CREATE INDEX correccion_por_emisor
  ON correccion_aprendida (inquilino_id, plantilla_codigo, emisor_clave, veces DESC);

CREATE TABLE item_extraido (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  corrida_id    uuid NOT NULL REFERENCES corrida_extraccion(id) ON DELETE CASCADE,
  orden         integer NOT NULL,
  contenido     jsonb NOT NULL,
  UNIQUE (corrida_id, orden)
);

CREATE INDEX item_por_corrida ON item_extraido (corrida_id, orden);
