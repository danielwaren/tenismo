# Auditoría de seguridad

## Fronteras

Los secretos de DB permanecen en servidor y `.env` no está versionado. Sin embargo, el producto carece de identidad, autorización y aislamiento de tenant. Esto invalida la publicación segura de banca/apuestas.

| Severidad | Evidencia | Archivo/módulo | Impacto | Recomendación | Esfuerzo | Riesgo cambio | Prioridad |
|---|---|---|---|---|---|---|---|
| Crítica | CRUD financiero sin sesión; IDs enumerables | `src/pages/api/bets/index.ts`, `bankroll.ts`, `settle.ts` | Lectura/modificación arbitraria | Bloquear en producción hasta auth; añadir `user_id`, checks servidor y migración segura | Alto | Alto | P0 |
| Alta | Se devuelven mensajes de excepción/DB en JSON | mismas rutas | Fuga de host, SQL o estructura | Correlation ID + log servidor; respuesta genérica | Bajo | Bajo | P0 |
| Alta | `npm audit --omit=dev` informa 9 vulnerabilidades (6 altas), incluidas múltiples XSS/SSRF/path override en Astro/adaptador y vulnerabilidades en routing/sharp | `package-lock.json`, Astro 5, `@astrojs/vercel` 8 | Exposición web según rutas/features utilizadas | Planificar actualización soportada de Astro/adaptador con guía de migración y regresión completa; no usar `npm audit fix --force` a ciegas | Medio | Medio | P0 |
| Alta | Sin CSRF/origin checks en POST con cookies futuras | APIs mutables | Riesgo al incorporar auth | SameSite, token CSRF o validación Origin según arquitectura | Medio | Medio | P0 |
| Alta | Sin rate limit/body limit explícitos | búsqueda, forecast, banca | abuso y coste/DoS | Límites en plataforma y validación de tamaño | Medio | Bajo | P1 |
| Media | Conexión DB usa usuario/contraseña sin evidencia de rol mínimo | `src/lib/db.ts` | Compromiso amplificado | Rol dedicado con mínimos grants y rotación | Medio | Medio | P1 || Media | `sql.unsafe` detrás de traducción artesanal | `src/lib/db.ts` | Riesgo futuro de inyección si entra SQL dinámico | Prohibir concatenación de input; tests/queries parametrizadas | Medio | Medio | P1 |
| Media | No CSP/HSTS/Referrer-Policy documentados | despliegue | XSS/clickjacking con menor defensa | Headers en Vercel/Astro, desplegados gradualmente | Bajo | Bajo | P1 |
| Baja | `.env.example` omite claves activas | `.env.example` | Configuraciones improvisadas | Documentar solo nombres y mínimos permisos | Bajo | Bajo | P0 |

## Secretos

No se imprimieron valores. `.env` está ignorado y no aparece en `git ls-files`. Rotar credenciales si alguna vez se compartió el archivo fuera de canales seguros.

La actualización automática completa propuesta por npm implica saltos mayores a Astro 7 y `@astrojs/vercel` 11. No se aplicó porque contradice el requisito de no reemplazar o actualizar destructivamente el framework sin una migración probada.