# Avance Hack · Prendas en contexto

Un proyecto que integra el frontend y backend de `Frontend-y-Backend` con la detección de prendas de `Red-Neuronal-Mk3`.

**Flujo:** registro/inicio de sesión → foto → detección de prendas y accesorios → cajas interactivas → exportación JSON e historial personal en PostgreSQL.

## Iniciar todo junto

Necesitas Docker con Compose y varios GB de RAM y disco libres. La construcción instala PyTorch para CPU; el primer arranque descarga OWL-ViT de Hugging Face (aproximadamente 600 MB adicionales). Necesita Internet durante esa descarga. Los arranques siguientes usan el volumen de modelos.

```bash
cp .env.example .env
# Edita POSTGRES_PASSWORD en .env con una contraseña propia alfanumérica larga.
docker compose up --build
```

Abre **http://localhost:3000**. Usa exactamente ese host: la protección de origen compara con `APP_ORIGIN`. Crea una cuenta con nombre, correo y contraseña de al menos 12 caracteres. Selecciona una foto JPEG/PNG/WebP de hasta 14 MB y 20 megapíxeles. Puedes cambiar el umbral y volver a analizar, seleccionar cajas y exportar el JSON. Cada análisis completado guarda sus resultados en tu cuenta.

Compose espera a que PostgreSQL y el detector estén listos antes de iniciar la web. La primera descarga puede tardar varios minutos. Diagnóstico: `docker compose logs neural` y `docker compose logs app`.

Para detener: `docker compose down`. Conserva cuentas, historial y modelo en volúmenes. **`docker compose down -v` elimina esos datos.**

## Arquitectura y procedencia

- `frontend/`: HTML/CSS/JavaScript sin compilación. Conserva el visor, selección de cajas y exportación de Mk3. Integra los flujos de cuenta y formularios del frontend anterior en la misma pantalla, con la paleta sobria de las prácticas existentes.
- `backend/`: Node.js + Express + PostgreSQL, a partir de los contratos de registro/login y el hash scrypt del backend existente. Sirve la web, autentica y comunica con Python desde el servidor. Incorpora sesiones persistentes HttpOnly, consultas parametrizadas, límites de carga y acceso al historial por usuario.
- `neural/`: detector OWL-ViT, validación de imágenes y API Flask de Mk3. Se ejecuta con Gunicorn, un proceso y una inferencia simultánea para controlar memoria. No publica puertos fuera de la red interna de Compose.
- `compose.yaml`: arranca los tres servicios con una orden. No incluye credenciales de los repositorios originales ni sus archivos `.env`.

Fuentes: [Frontend-y-Backend](https://github.com/JuanPablo561/Frontend-y-Backend), [Pr-ctica-con-HTML](https://github.com/JuanPablo561/Pr-ctica-con-HTML), [Red-Neuronal-Mk3](https://github.com/JuanPablo561/Red-Neuronal-Mk3).

Mk1 y Mk2 son clasificadores de una imagen completa; Mk3 localiza múltiples prendas. Esta integración usa **Mk3 como motor activo**. No mezcla sus pesos con los clasificadores anteriores ni requiere entrenarlos. Consulta la [ficha de OWL-ViT](https://huggingface.co/google/owlvit-base-patch32) para licencia, datos y limitaciones.

## Desarrollo sin Docker

Node.js 22+; Python 3.11/3.12; PostgreSQL 17 disponible.

```bash
npm ci
python -m venv .venv
# Activa el entorno virtual según tu sistema.
pip install torch==2.6.0 torchvision==0.21.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r neural/requirements.txt gunicorn==23.0.0
# Terminal 1 (Linux/macOS):
cd neural
gunicorn --bind 127.0.0.1:8000 --timeout 240 --threads 2 wsgi:app
# Terminal 2, desde la raíz:
export DATABASE_URL='postgresql://usuario:clave@localhost:5432/avance'
export NEURAL_URL='http://127.0.0.1:8000'
npm start
```

En Windows puedes iniciar el servicio con `cd neural` y `python servidor.py`; ese servidor es solo para desarrollo. La aplicación Node crea tablas al arrancar. Las variables de `.env` las lee Compose; al ejecutar Node directamente, expórtalas o usa `node --env-file=.env backend/server.cjs` con un `.env` que incluya `DATABASE_URL`.

## API

Errores: `{ "error": "mensaje" }`. Las rutas de cuenta usan JSON. La sesión dura 24 horas y se conserva en PostgreSQL; la cookie es HttpOnly y SameSite=Strict.

| Método y ruta | Entrada / respuesta |
|---|---|
| `POST /api/register` | `{name,email,password}` → 201 `{user}` y cookie |
| `POST /api/login` | `{email,password}` → `{user}` y cookie |
| `GET /api/me` | `{user}`; 401 sin sesión |
| `POST /api/logout` | Revoca sesión → 204 |
| `POST /api/analyses` | Multipart `imagen`, `umbral` opcional (0.01–0.9) → 201 `{id,detecciones,ancho,alto,segundos,vista}` |
| `GET /api/analyses?page=1` | `{data,page,pageSize:20}`, solo del usuario actual; resultados sin imagen |
| `GET /api/health` | Comprueba conexión a PostgreSQL; `{status:"ok"}` |

Cada detección: `{clase,puntuacion,caja:[xMin,yMin,xMax,yMax]}`. Coordenadas normalizadas respecto a `vista`. La vista corrige orientación EXIF y limita el lado mayor a 1600 px. La puntuación no es una probabilidad calibrada. Los POST de registro y análisis no son idempotentes: no se reintentan automáticamente.

## Pruebas

```bash
npm test
cd neural
python -m unittest -v
```

Las pruebas de Node usan `pg-mem` y un detector sustituido: verifican registro/login, privacidad del historial, persistencia sin fotos, errores, origen y cierre de sesión. Las de Python usan un detector sustituido para comprobar validación y operaciones reales de PyTorch para las cajas. Ninguna mide precisión del detector real.

`npm run test:browser` verifica registro, subida, resultados, historial y cierre en Chromium con el backend real y una base temporal en memoria; sustituye solo la inferencia por una respuesta de prueba. Requiere Chromium en `/usr/bin/chromium` o `CHROMIUM_PATH`.

## Alcance

Las fotos se procesan en memoria y no se guardan; el historial conserva el nombre del archivo y anotaciones. El modelo procesa localmente en el servidor; no llama a una API de inferencia de pago. Puede omitir prendas, duplicarlas o confundir categorías; no hay una precisión global evaluada en fotos propias. No interpreta relaciones ni recomienda combinaciones.

La configuración de Compose es para uso local. Para publicar: HTTPS con proxy inverso, `APP_ORIGIN` con el dominio real, `NODE_ENV=production` para cookies Secure, credenciales propias y respaldo de PostgreSQL. No exponer directamente PostgreSQL ni el servicio neuronal. El limitador es por proceso y las contraseñas usan scrypt síncrono; antes de escalar a muchos usuarios, revisar concurrencia y recursos con mediciones.
