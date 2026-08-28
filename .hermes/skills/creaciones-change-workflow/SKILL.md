---
name: creaciones-change-workflow
description: Usa para cambios sustanciales de Creaciones Melvin.
version: 0.1.0
author: Melvin Arana, Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [creaciones-melvin, pwa, node, planning, testing]
    related_skills: [test-driven-development, requesting-code-review]
---

# Workflow de cambios de Creaciones Melvin

Adapta el routing orgánico y la disciplina de especificación de Gentle AI a esta aplicación pequeña, independiente y con dinero real. Mantiene el trabajo acotado directo y reserva artefactos durables para decisiones o cambios que cruzan módulos.

## Cuándo usar

Usa este workflow cuando ocurra al menos una condición:

- El cambio afecta dinero, ventas, anulaciones, catálogo, autenticación, seguridad o la cola offline.
- Hay decisiones abiertas de diseño, API, datos o despliegue que deben quedar registradas.
- La implementación cruza `server/`, `public/` y pruebas, y una lista verificable reduce omisiones.
- El usuario solicita una propuesta, plan, especificación o revisión explícita.

No lo uses para:

- Consultas o diagnósticos que requieren hasta tres archivos.
- Un cambio mecánico de un archivo ya entendido.
- Documentación pasiva sin decisión de diseño.

## Prerrequisitos

1. Leer `README.md`, `docs/DECISIONS.md` y `CHANGELOG.md`; respetar las decisiones registradas.
2. Confirmar con `mem_current_project` que Engram reporta `creaciones-melvin`.
3. Consultar `mem_search` antes de repetir investigación o contradecir una decisión previa.
4. Cero dependencias: no introducir `npm install` ni dependencias nuevas sin decisión explícita.
5. Dinero siempre en centavos enteros; ventas nunca editadas ni eliminadas (solo anulación con motivo).

## Routing mínimo

| Situación | Ruta |
|---|---|
| Decidir o verificar con 1–3 archivos | Trabajar inline. |
| Comprender 4+ archivos | Delegar un mapper acotado con `delegate_task`. |
| Escribir 2+ archivos no triviales | Delegar un solo writer. |
| Ejecutar pruebas, build o revisión independiente | Puede usarse un worker fresco sin crear ceremonia. |
| Persisten decisiones sustanciales o ambigüedad de diseño | Aplicar las cuatro etapas de este workflow. |

La cantidad de archivos decide topología de contexto, no el riesgo. El riesgo aumenta la verificación, no la ceremonia.

## Procedimiento

### 1. Propuesta

Define brevemente:

- problema y resultado esperado;
- alcance incluido y excluido;
- decisiones de diseño afectadas y alternativas;
- riesgo y estrategia de reversión;
- actualizaciones documentales requeridas.

Cuando la propuesta sea durable, guárdala con:

```text
title: cm/{change}/proposal
topic_key: cm/{change}/proposal
type: architecture
project: creaciones-melvin
scope: project
```

**Criterio de salida:** alcance explícito y ninguna decisión de dinero o seguridad implícita.

### 2. Contrato

Convierte la propuesta aprobada en requisitos verificables:

- comportamiento observable y casos límite;
- invariantes de dinero, idempotencia, anulación y auditoría;
- cambios de API, esquema o catálogo;
- criterios de aceptación con prueba asociada.

Guarda el artefacto durable como `cm/{change}/contract`.

**Criterio de salida:** cada requisito tiene al menos una prueba o escenario verificable.

### 3. Tareas e implementación

Descompón en unidades pequeñas y ordenadas. Cada tarea indica:

- archivos o módulos afectados;
- prueba que falla primero cuando aplica TDD;
- implementación mínima;
- verificación;
- documentación a actualizar.

Guarda las tareas como `cm/{change}/tasks`. Para dinero, anulaciones, catálogo, sesiones o seguridad, carga y sigue `test-driven-development` antes de escribir producción. Mantén `npm test` y `npm run check` en verde al cerrar cada lote.

**Criterio de salida:** código, pruebas, `CHANGELOG.md` y `docs/DECISIONS.md` describen el mismo estado real.

### 4. Verificación y cierre

Verifica contra el contrato, no contra el relato de implementación:

1. Ejecutar `npm test` y `npm run check` completos.
2. Revisar el diff y confirmar ausencia de secretos, `.env` reales y datos de ventas.
3. Confirmar estado con precisión: diseñado, implementado, probado o desplegado.
4. Para cambios en producción de gym-node-02, coordinar con `infraestructura` y `seguridad`.
5. Cargar `requesting-code-review` cuando la entrega vaya a commit o PR.

Guarda `cm/{change}/verify` con comandos ejecutados, resultados reales, requisitos cubiertos, riesgos residuales y pendientes. No guardes logs extensos ni output rutinario.

**Criterio de salida:** todos los criterios de aceptación están vinculados a evidencia real o marcados explícitamente como pendientes.

## Convención Engram

```text
cm/{change}/proposal
cm/{change}/contract
cm/{change}/tasks
cm/{change}/verify
cm/{change}/state
```

- Reutiliza el mismo `topic_key` para actualizar un artefacto; no crees duplicados por fecha.
- Usa `mem_get_observation` para recuperar contenido completo después de `mem_search`.
- Engram es memoria de trabajo recuperable; Git, `docs/DECISIONS.md` y las pruebas siguen siendo la fuente durable.
- La memoria nativa conserva preferencias y hechos personales estables; no dupliques esos datos en Engram salvo contexto operativo del proyecto.

## Despliegue en gym-node-02 (procedimiento verificado 2026-08-28)

1. Acceso SSH por Tailscale: `ssh root@100.97.20.79` (el check web de Tailscale se
   aprueba una vez en login.tailscale.com; `admin@192.168.1.134` directo NO está autorizado).
2. El stack es una copia SIN `.git` en `/home/operator1/stacks/creaciones-melvin`
   (con `.env` real y `rollback.sh`). No es repo: no se hace `git pull`.
3. Subir cambios: desde el repo local, empaquetar excluyendo secretos/datos:
   `tar -czf /tmp/cm-deploy.tar.gz --exclude='.git' --exclude='.env' --exclude='data' --exclude='.engram' --exclude='.hermes' --exclude='*.db*' .`
   luego `scp` a `/tmp/`, extraer en el stack, `chown -R operator1:operator1` y
   `docker compose up -d --build`.
4. Verificar: `curl http://192.168.1.134:3002/api/health`, el HTML con el botón nuevo,
   `sw.js` con la caché nueva y `docker ps` `(healthy)`.
5. Al cambiar el frontend, subir la caché del service worker (`public/sw.js`, `CACHE`)
   o los clientes seguirán ejecutando el `app.js` viejo (cache-first).

## Pitfalls

- No fuerces este workflow por tamaño solamente.
- No delegues varios writers sobre el mismo árbol de trabajo.
- No cambies el esquema SQLite sin migración o re-siembra probada.
- No confundas una memoria guardada con una respuesta al usuario.
- No marques como desplegado algo solo diseñado o probado localmente.
- No uses Engram para secretos, `ADMIN_PASSWORD`, `SELLER_TOKEN`, cookies, datos de ventas reales ni respaldos.
- La versión estable Engram 1.20.0 usa el override del proceso MCP `--project creaciones-melvin`; no dependas únicamente del cwd en sesiones del gateway.

## Verificación

Antes de declarar terminado:

- `mem_current_project` reporta `creaciones-melvin`.
- Los artefactos guardados se recuperan por su `topic_key`.
- `npm test` y `npm run check` pasan completos.
- Cada requisito está cubierto por prueba/evidencia o aparece como pendiente.
- El diff respeta `docs/DECISIONS.md` y no mezcla cambios de Gym OS.
- La respuesta final distingue qué se diseñó, implementó, probó y desplegó.

## Procedencia

Workflow original adaptado para Creaciones Melvin, inspirado en Organic Routing, SDD y Engram de Gentle AI y Engram, publicados bajo licencia MIT por Gentleman Programming. No incorpora la persona, RDD ni el orquestador completo de Gentle AI.
