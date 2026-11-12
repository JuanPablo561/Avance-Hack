# Verificación de la integración

Comprobación realizada el 12 de noviembre de 2026.

- `npm test`: dos pruebas de integración aprobadas, con registro, autenticación, cookie de sesión, historial por usuario, rechazo de acceso ajeno, almacenamiento sin fotografía, cierre de sesión, validación, duplicados, protección de origen y fallo del detector. Usa `pg-mem` y un sustituto de inferencia.
- `cd neural && python -m unittest -v`: cinco pruebas aprobadas; validación de imágenes, límites, formato de respuesta, ausencia de detecciones y filtrado real de cajas con PyTorch.
- `npm run test:browser`: Chromium, registro desde la interfaz, subida, resultados, historial, recarga con sesión y cierre. Cuatro anchos: 320, 768, 1024 y 1440 px, sin desbordamiento horizontal ni excepciones JavaScript. Usa base temporal en memoria y respuesta neuronal de prueba.
- Prueba adicional con servicios reales: PostgreSQL 17 en contenedor, Node/Express y Flask/Gunicorn con OWL-ViT en CPU. El mismo flujo de navegador terminó correctamente, guardó resultados y los recuperó después de recargar.
- `npm audit --omit=dev --audit-level=high`: cero vulnerabilidades reportadas en dependencias de ejecución.
- `docker compose config --quiet`: configuración válida con las variables requeridas.

## Precisión observada

La integración y la precisión del modelo son aspectos distintos. La [foto de camiseta usada en la prueba](https://raw.githubusercontent.com/alexeygrigorev/clothing-dataset-small/master/test/t-shirt/01fd527c-da05-4141-861c-3aaec8070601.jpg) produjo una detección etiquetada como **Bolso**, puntuación 0.4729, en aproximadamente 1.14 segundos. Es una clasificación incorrecta del motor heredado. No se atribuye una precisión global ni se ajustaron consultas a esta única foto. Para evaluar y mejorar el modelo se necesita un conjunto anotado separado en entrenamiento/validación/prueba.

## Límite de infraestructura

Se intentó construir la imagen Docker de Node. El daemon falló al crear una capa de la imagen base por `no space left on device` en el disco de este entorno. No se completó la construcción de las imágenes ni una ejecución completa con Compose. Sí se verificaron el flujo completo ejecutando Node/Python directamente y PostgreSQL en Docker. Los Dockerfiles incluyen soporte opcional para un certificado de proxy mediante el secreto BuildKit `proxy_ca`; un entorno sin proxy no necesita ese secreto.

## Repetir con los servicios reales

Con el proyecto iniciado, Chromium instalado y una imagen de prueba disponible:

```bash
TEST_BASE_URL=http://localhost:3000 TEST_IMAGE=/ruta/a/foto.jpg npm run test:browser
```

Crea una cuenta de prueba nueva y una entrada de historial en esa base. El archivo de imagen no se guarda en PostgreSQL. Opcional: `SCREENSHOT_PATH=/ruta/a/captura.png` guarda una captura de la vista de resultados.
