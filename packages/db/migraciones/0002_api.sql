CREATE TABLE clave_api (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  nombre        text NOT NULL,
  prefijo       text NOT NULL,
  huella        text NOT NULL,
  rol           text NOT NULL DEFAULT 'INTEGRACION',
  activa        boolean NOT NULL DEFAULT true,
  usada_en      timestamptz,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (huella)
);

CREATE INDEX clave_api_activa ON clave_api (prefijo) WHERE activa;

CREATE TABLE objeto_negocio (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id   uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  tipo           text NOT NULL,
  clave_externa  text NOT NULL,
  etiqueta       text NOT NULL,
  estado         text NOT NULL DEFAULT 'ABIERTO',
  atributos      jsonb NOT NULL DEFAULT '{}'::jsonb,
  creado_en      timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquilino_id, tipo, clave_externa)
);

CREATE INDEX objeto_negocio_abierto ON objeto_negocio (inquilino_id, tipo, actualizado_en DESC)
  WHERE estado = 'ABIERTO';

CREATE INDEX objeto_negocio_atributos ON objeto_negocio USING gin (atributos jsonb_path_ops);
