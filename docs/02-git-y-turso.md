# Puesta en producción: GitHub y Turso

Estos son los pasos que tienes que hacer tú, porque implican crear cuentas y
recursos. Todo lo demás ya está listo y funciona hoy contra el fichero local.

Hazlos **en este orden**: el workflow de GitHub Actions necesita los secrets de
Turso, así que la base tiene que existir antes de que el cron sirva de algo.

---

## 1. Turso (la base de datos)

### 1.1 Instalar la CLI y crear la base

En PowerShell:

```powershell
irm https://tur.so/install.ps1 | iex
turso auth signup      # o `turso auth login` si ya tienes cuenta
turso db create tennis-trader --location scl   # scl = Santiago; usa el más cercano
```

El plan gratuito de Turso da 500 bases, 9 GB de almacenamiento y 1.000 millones
de lecturas de fila al mes. Esta base pesa unos **40 MB** con las 14 temporadas
cargadas, así que va sobradísima.

### 1.2 Sacar la URL y el token

```powershell
turso db show tennis-trader --url
turso db tokens create tennis-trader
```

Guarda las dos cosas. **El token da acceso total a la base** — Turso no tiene
RLS, así que no hay nada por debajo que lo limite. No lo pegues en el chat, no lo
commitees y no lo pongas en ninguna variable `PUBLIC_*`.

### 1.3 Apuntar el proyecto a Turso

En `.env` (que está en `.gitignore`):

```
TURSO_DATABASE_URL=libsql://tennis-trader-<tu-org>.turso.io
TURSO_AUTH_TOKEN=<el token>
```

### 1.4 Cargar el esquema y los datos

```powershell
npm run db:migrate
npm run db:ingest
npm run db:elo -- --reset
npx tsx scripts/fit-model.ts
```

La ingesta contra Turso tarda bastante más que en local (cada lote va por red).
Si prefieres no esperar, `data/tennis.db` ya tiene todo y puedes subirlo de una:

```powershell
turso db shell tennis-trader < volcado.sql
```

...pero lo simple y seguro es dejar correr los cuatro comandos de arriba.

---

## 2. GitHub (el repositorio y los crons)

### 2.1 Crear el repositorio

`tennis-trader-intelligence/` ya es un repo git con los commits hechos, pero
**sin remoto**. En github.com crea un repositorio vacío — sin README, sin
.gitignore, sin licencia, o el primer push chocará.

Sugerencia de nombre: `tennis-trader-intelligence`. Ten en cuenta que el de
fútbol se llama `deportismo` en GitHub aunque la carpeta local se llame otra
cosa; aquí puedes evitar esa confusión.

### 2.2 Conectarlo y subir

```powershell
cd C:\Users\danig\OneDrive\Desktop\web\tennis-trader-intelligence
git remote add origin https://github.com/danielwaren/tennis-trader-intelligence.git
git push -u origin main
```

No hay `gh` CLI instalada en este equipo, así que el repositorio hay que crearlo
desde la web.

### 2.3 Cargar los secrets

En el repo: **Settings → Secrets and variables → Actions → New repository secret**.

| Nombre | Valor |
|---|---|
| `TURSO_DATABASE_URL` | la URL `libsql://...` del paso 1.2 |
| `TURSO_AUTH_TOKEN` | el token del paso 1.2 |

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

## Aviso sobre las claves

Si en algún momento pegas el token de Turso en un chat, en un commit o en una
captura, **rótalo**:

```powershell
turso db tokens invalidate tennis-trader
turso db tokens create tennis-trader
```
