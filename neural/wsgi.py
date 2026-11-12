"""Servicio interno de inferencia; no publicar su puerto en Internet."""
from modelo import Detector
from servidor import crear_app
app = crear_app(Detector())
@app.get('/health')
def health():
    return {'status': 'ok', 'model': 'OWL-ViT'}
