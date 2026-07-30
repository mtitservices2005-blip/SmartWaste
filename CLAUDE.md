# Reglas permanentes — SmartWaste

Este archivo fue creado en la auditoría técnica SW-020 (2026-07-29, ver `docs/CURRENT_STATE_AUDIT.md`, `docs/TECHNICAL_DEBT_REGISTER.md`, `docs/NEXT_MILESTONE_RECOMMENDATION.md`, `docs/MTIT_OS_BOUNDARY_REVIEW.md`). Estas reglas son permanentes y se aplican a todo trabajo futuro en este repositorio, no solo a esta auditoría.

1. **Nunca trabajar directamente sobre `main`.** Todo cambio empieza en una rama dedicada.
2. **Una rama por hito.** No mezclar el trabajo de dos hitos SW-XXX en la misma rama/PR.
3. **No hacer merge.** Preparar la rama y el PR; el merge a `main` lo decide el Project Owner.
4. **No modificar MTIT-OS.** Este repo no toca código de MTIT-OS ni de repos relacionados (p. ej. `ayuntamiento-Chatbot`). Consultar su documentación es válido únicamente para definir límites y contratos de integración (qué datos cruzan, en qué formato, bajo qué autenticación) — nunca para copiar su arquitectura o código dentro de SmartWaste. Ver `docs/MTIT_OS_BOUNDARY_REVIEW.md`.
5. **No borrar ni reemplazar la demo aprobada.** Ampliar o corregir, no reiniciar la arquitectura ni sustituir la Alpha visual existente.
6. **No afirmar integraciones reales sin evidencia.** Un componente solo se clasifica `VERIFIED_REAL` si se ejecutó contra el sistema real y hay evidencia reproducible (comando, resultado). Código, migración, contrato o test estático no son prueba de funcionamiento real — ver taxonomía en `docs/CURRENT_STATE_AUDIT.md`.
7. **Preservar la etiqueta de datos demo.** Cualquier UI o documento que muestre datos no reales debe mantener su disclaimer ("Datos demo · no producción" o equivalente).
8. **No usar secretos ni credenciales.** Nunca commitear claves, tokens ni credenciales reales; nunca exponer `service_role` de Supabase al frontend o a dispositivos físicos (GPS trackers, etc.).
9. **Ejecutar pruebas antes de publicar.** Correr los tests relevantes en `tests/` (y cualquier prueba nueva que aplique) antes de abrir un PR.
10. **Detenerse antes de commit, push o PR salvo autorización explícita.** Preparar los cambios y describir qué se haría; esperar confirmación explícita del Project Owner antes de ejecutar `git commit`, `git push` o crear un PR.
