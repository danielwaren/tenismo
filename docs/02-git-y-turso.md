# Puesta en producción: GitHub y Turso

## Estado actual

| Recurso | Valor |
|---|---|
| Base Turso | `tenismo` — `libsql://tenismo-danielgu.aws-us-west-2.turso.io` |
| Repositorio | https://github.com/danielwaren/tenismo (**público**) |
| Rama | `main` |

Lo hecho: esquema migrado en Turso, datos cargados, código subido a GitHub.
Lo que falta lo indica la sección 2.3 (secrets del workflow).

---

## 1. Turso (la base de datos)

Ya está creada y cargada. Esta sección queda como referencia.

El plan gratuito da 500 bases, 9 GB de almacenamiento y 1.000 millones de
lecturas de fila al mes. La base pesa unos **40 MB** con las 14 temporadas, así
que va sobradísima.

### Comandos útiles

```powershell
turso db show tenismo --url
turso db tokens create tenismo
turso db tokens invalidate tenismo    # rota el token; invalida los anteriores
```

**El token da acceso total a la base** — Turso no tiene RLS, no hay nada por
debajo que lo limite. No lo pegues en un chat, no lo commitees y no lo pongas en
ninguna variable `PUBLIC_*`.

### Recargar los datos desde cero

```powershell
npm run db:migrate
npm run db:ingest
npm run db:elo -- --reset
npx tsx scripts/fit-model.ts
npx tsx scripts/predict.ts --all
```

Contra Turso cada lote va por red, así que la carga completa tarda unos 15
minutos y el entreno otros 10. Los lotes reintentan solos ante cortes de red
(`scripts/lib/batch.ts`), y todas las escrituras son idempotentes: si se corta a
mitad, se relanza el mismo comando y continúa sin duplicar nada.

Para trabajar rápido sin gastar red, en `.env`:
`TURSO_DATABASE_URL=file:./data/tennis.db`

---

## 2. GitHub (el repositorio y los crons)

### 2.1 y 2.2 — hechos

El remoto ya está configurado y `main` subida.

⚠️ El repositorio se creó **público**. No contiene secretos (`.env` está
ignorado y nunca se commiteó), pero si lo quieres privado:
Settings → General → Danger Zone → Change repository visibility.

### 2.3 Cargar los secrets

**Este es el único paso que falta.** En
https://github.com/danielwaren/tenismo/settings/secrets/actions → *New
repository secret*:

| Nombre | Valor |
|---|---|
| `TURSO_DATABASE_URL` | `libsql://tenismo-danielgu.aws-us-west-2.turso.io` |
| `TURSO_AUTH_TOKEN` | el token (usa uno **nuevo**, ver aviso del final) |

Sin estos dos, el workflow falla a propósito en el primer paso en vez de correr
en vacío y aparentar que todo va bien.

### 2.4 Probar el cron a mano

En la pestaña **Actions → Ingesta diaria → Run workflow**. Debería tardar unos
minutos y dejar en el log el informe de `evaluate.ts`.

A partir de ahí corre solo a las 06:30 UTC (03:30 en Chile continental).

---

## 3. Vercel (opcional, cuando quieras verlo publicado)

El despliegue no hace falta para nada de lo anterior; la app funciona en local.
Cuando lo quieras:

```powershell
npm run build
npx vercel deploy --prebuilt --prod
```

Y en el panel de Vercel, añadir `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN` como
variables de entorno del proyecto (**no** como `PUBLIC_*`: el navegador no debe
verlas nunca).

---

## Aviso: hay un token que rotar

El token con el que se configuró esto se pegó en una conversación de chat, así
que **ya no es secreto**. Da acceso total de lectura y escritura a la base.
Rótalo y usa el nuevo tanto en `.env` como en los secrets de GitHub:

```powershell
turso db tokens invalidate tenismo    # invalida TODOS los tokens anteriores
turso db tokens create tenismo        # genera uno nuevo
```

Regla general: si un token acaba en un chat, un commit o una captura, se rota.
No se "vigila", se rota.
