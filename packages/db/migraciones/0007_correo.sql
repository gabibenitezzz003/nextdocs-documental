CREATE TABLE destinatario_documental (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id   uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  nombre         text NOT NULL,
  correo         text NOT NULL,
  familias       text[] NOT NULL DEFAULT '{}',
  plantillas     text[] NOT NULL DEFAULT '{}',
  situaciones    text[] NOT NULL DEFAULT '{APROBADO}',
  activo         boolean NOT NULL DEFAULT true,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquilino_id, correo)
);

CREATE TABLE envio_documental (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id   uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id   uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  destinatario   text NOT NULL,
  asunto         text NOT NULL,
  motivo         text NOT NULL,
  estado         text NOT NULL DEFAULT 'PENDIENTE',
  intentos       integer NOT NULL DEFAULT 0,
  ultimo_error   text,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  enviado_en     timestamptz,
  UNIQUE (documento_id, destinatario, motivo)
);

CREATE INDEX envio_pendiente ON envio_documental (estado, creado_en)
  WHERE estado = 'PENDIENTE';
