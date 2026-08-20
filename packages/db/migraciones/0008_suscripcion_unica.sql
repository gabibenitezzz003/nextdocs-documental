DELETE FROM suscripcion_webhook s
 WHERE EXISTS (
   SELECT 1 FROM suscripcion_webhook otra
    WHERE otra.inquilino_id = s.inquilino_id
      AND otra.url = s.url
      AND otra.creado_en < s.creado_en
 );

CREATE UNIQUE INDEX suscripcion_url_unica
  ON suscripcion_webhook (inquilino_id, url);
