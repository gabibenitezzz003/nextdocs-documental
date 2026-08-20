# Integración con n8n

Los flujos que conectan la conversación de WhatsApp con IA-Docs.

Viven acá y no en `follow-docker` porque `follow-docker` no es un repositorio:
todo lo que quedaba ahí no tenía historial ni forma de revisarse.

| Archivo | Qué es |
|---|---|
| `b49_documentos.cjs` | las reglas de decisión, sin n8n adentro |
| `probar_b49_documentos.cjs` | 28 pruebas que corren con node, sin levantar nada |
| `B49_DOCUMENTO_CHOFER.json` | flujo: el chofer manda un documento |
| `B49_RESULTADO_DOCUMENTO.json` | flujo: IA-Docs terminó y hay que contestarle |
| `LEEME-B49-DOCUMENTOS.md` | cómo funcionan y qué falta |

## Probar las reglas

```bash
node integraciones/n8n/probar_b49_documentos.cjs
```

## Importar los flujos al n8n local

```bash
docker cp integraciones/n8n/B49_RESULTADO_DOCUMENTO.json n8n-local:/tmp/
```

```bash
docker exec n8n-local n8n import:workflow --input=/tmp/B49_RESULTADO_DOCUMENTO.json
```

Después hay que activarlo y reiniciar, porque n8n registra los webhooks al
arrancar:

```bash
docker exec n8n-local n8n update:workflow --id=b49docresult0001 --active=true && docker restart n8n-local
```

## Por qué el código está duplicado

`b49_documentos.cjs` es la fuente. El generador lo pega adentro de los nodos
`code` del flujo, porque n8n no puede importar módulos del disco. Si cambiás las
reglas, hay que regenerar los JSON y volver a importarlos.

No es lindo, pero la alternativa es tener la lógica sólo dentro del JSON de n8n,
donde no se puede testear ni revisar en un diff.
