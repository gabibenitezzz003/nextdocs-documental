CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE inquilino (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre        text NOT NULL,
  estado        text NOT NULL DEFAULT 'ACTIVO',
  plan          text NOT NULL DEFAULT 'STARTER',
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE usuario (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  email         text NOT NULL,
  nombre        text NOT NULL,
  rol           text NOT NULL,
  clave_hash    text,
  activo        boolean NOT NULL DEFAULT true,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquilino_id, email)
);

CREATE TABLE plantilla_documental (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id          uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  codigo                text NOT NULL,
  nombre                text NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  estado                text NOT NULL DEFAULT 'BORRADOR',
  umbral_auto_aprobacion numeric(4,3) NOT NULL DEFAULT 0.900,
  politica_fisica       text NOT NULL DEFAULT 'NO_REQUERIDO',
  definicion            jsonb NOT NULL,
  creado_en             timestamptz NOT NULL DEFAULT now(),
  publicado_en          timestamptz,
  UNIQUE (inquilino_id, codigo, version)
);

CREATE TABLE documento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id        uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  origen              text NOT NULL,
  referencia_externa  text,
  huella              text NOT NULL,
  tipo_mime           text NOT NULL,
  nombre_archivo      text NOT NULL,
  estado              text NOT NULL DEFAULT 'RECIBIDO',
  plantilla_codigo    text,
  sujeto_tipo         text,
  sujeto_id           text,
  confianza           numeric(4,3),
  version             integer NOT NULL DEFAULT 1,
  creado_por          uuid REFERENCES usuario(id),
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX documento_huella_unica
  ON documento (inquilino_id, huella);

CREATE UNIQUE INDEX documento_referencia_unica
  ON documento (inquilino_id, referencia_externa)
  WHERE referencia_externa IS NOT NULL;

CREATE INDEX documento_bandeja
  ON documento (inquilino_id, estado, creado_en DESC);

CREATE TABLE archivo_documento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id  uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  clave_almacen text NOT NULL,
  version       integer NOT NULL DEFAULT 1,
  suma          text NOT NULL,
  tamano_bytes  bigint NOT NULL,
  paginas       integer,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id, version)
);

CREATE TABLE corrida_extraccion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id      uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id      uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  plantilla_codigo  text NOT NULL,
  plantilla_version integer NOT NULL,
  proveedor         text NOT NULL,
  modelo            text NOT NULL,
  version_prompt    text NOT NULL,
  version_esquema   text NOT NULL,
  estado            text NOT NULL,
  iniciado_en       timestamptz NOT NULL,
  terminado_en      timestamptz,
  milisegundos      integer,
  uso               jsonb,
  costo_estimado    numeric(10,6),
  creado_en         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX corrida_por_documento ON corrida_extraccion (documento_id, creado_en DESC);

CREATE TABLE valor_extraido (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id      uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  corrida_id        uuid NOT NULL REFERENCES corrida_extraccion(id) ON DELETE CASCADE,
  clave             text NOT NULL,
  valor_leido       jsonb,
  valor_normalizado jsonb,
  confianza         numeric(4,3) NOT NULL DEFAULT 0,
  pagina            integer,
  recorte           jsonb,
  texto_fuente      text,
  UNIQUE (corrida_id, clave)
);

CREATE TABLE candidato_emparejamiento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id        uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id        uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  tipo_objeto         text NOT NULL,
  objeto_id           text,
  referencia_externa  text,
  puntaje             integer NOT NULL,
  metodo              text NOT NULL,
  estado              text NOT NULL DEFAULT 'PROPUESTO',
  razones             jsonb NOT NULL DEFAULT '[]'::jsonb,
  creado_en           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX candidato_por_documento ON candidato_emparejamiento (documento_id, puntaje DESC);

CREATE TABLE corrida_validacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id    uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id    uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  version_reglas  text NOT NULL,
  resultado       text NOT NULL,
  hallazgos       jsonb NOT NULL DEFAULT '[]'::jsonb,
  iniciado_en     timestamptz NOT NULL,
  terminado_en    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX validacion_por_documento ON corrida_validacion (documento_id, terminado_en DESC);

CREATE TABLE revision_documento (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id  uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  clave_campo   text,
  revisor_id    uuid REFERENCES usuario(id),
  decision      text NOT NULL,
  motivo        text,
  antes         jsonb,
  despues       jsonb,
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX revision_por_documento ON revision_documento (documento_id, creado_en DESC);

CREATE TABLE instantanea_aprobacion (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id        uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id        uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  documento_version   integer NOT NULL,
  corrida_extraccion_id uuid REFERENCES corrida_extraccion(id),
  corrida_validacion_id uuid REFERENCES corrida_validacion(id),
  aprobado_por        uuid REFERENCES usuario(id),
  sello               text NOT NULL,
  contenido           jsonb NOT NULL,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id, documento_version)
);

CREATE TABLE excepcion (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id      uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id      uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  codigo_motivo     text NOT NULL,
  severidad         text NOT NULL,
  prioridad         text NOT NULL,
  motivos           jsonb NOT NULL DEFAULT '[]'::jsonb,
  accion_sugerida   text,
  responsable_id    uuid REFERENCES usuario(id),
  estado            text NOT NULL DEFAULT 'ABIERTA',
  vence_en          timestamptz,
  resolucion        text,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  resuelto_en       timestamptz
);

CREATE INDEX excepcion_cola
  ON excepcion (inquilino_id, estado, prioridad, vence_en);

CREATE TABLE documento_fisico (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id      uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  documento_id      uuid NOT NULL REFERENCES documento(id) ON DELETE CASCADE,
  requerido         boolean NOT NULL DEFAULT false,
  estado            text NOT NULL DEFAULT 'NO_REQUERIDO',
  custodio          text,
  ubicacion_logica  text,
  vence_en          timestamptz,
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (documento_id)
);

CREATE TABLE evento_auditoria (
  id              bigserial PRIMARY KEY,
  inquilino_id    uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  tipo_agregado   text NOT NULL,
  agregado_id     text NOT NULL,
  accion          text NOT NULL,
  tipo_actor      text NOT NULL,
  actor_id        text,
  origen          text NOT NULL,
  correlacion_id  uuid,
  causacion_id    uuid,
  antes           jsonb,
  despues         jsonb,
  metadatos       jsonb,
  creado_en       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX auditoria_por_agregado
  ON evento_auditoria (inquilino_id, tipo_agregado, agregado_id, creado_en DESC);

CREATE TABLE evento_salida (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id    uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  tipo_agregado   text NOT NULL,
  agregado_id     text NOT NULL,
  tipo_evento     text NOT NULL,
  version_evento  integer NOT NULL DEFAULT 1,
  correlacion_id  uuid,
  causacion_id    uuid,
  contenido       jsonb NOT NULL,
  estado          text NOT NULL DEFAULT 'PENDIENTE',
  intentos        integer NOT NULL DEFAULT 0,
  proximo_intento_en timestamptz NOT NULL DEFAULT now(),
  ultimo_error    text,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  publicado_en    timestamptz
);

CREATE INDEX salida_pendiente
  ON evento_salida (estado, proximo_intento_en)
  WHERE estado = 'PENDIENTE';

CREATE TABLE suscripcion_webhook (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  url           text NOT NULL,
  secreto       text NOT NULL,
  tipos_evento  text[] NOT NULL DEFAULT '{}',
  estado        text NOT NULL DEFAULT 'ACTIVA',
  creado_en     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entrega_webhook (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id    uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  suscripcion_id  uuid NOT NULL REFERENCES suscripcion_webhook(id) ON DELETE CASCADE,
  evento_id       uuid NOT NULL REFERENCES evento_salida(id) ON DELETE CASCADE,
  intento         integer NOT NULL,
  estado          text NOT NULL,
  codigo_respuesta integer,
  proximo_intento_en timestamptz,
  creado_en       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (suscripcion_id, evento_id, intento)
);

CREATE TABLE clave_idempotencia (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  inquilino_id  uuid NOT NULL REFERENCES inquilino(id) ON DELETE CASCADE,
  clave         text NOT NULL,
  recurso       text NOT NULL,
  recurso_id    text NOT NULL,
  creado_en     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (inquilino_id, clave)
);
