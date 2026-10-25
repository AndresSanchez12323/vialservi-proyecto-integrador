# Cambios de la rama `la-mole`

- Se agregó lectura OCR de tarjetas de propiedad mediante Amazon Textract, con subida temporal a S3 y eliminación de la imagen después del análisis.
- El OCR extrae placa, marca, línea/modelo y color, y rellena el formulario sin guardar automáticamente los datos.
- Se agregaron los modos `OCR_MODO=local|aws` y la validación de configuración S3 para activar Textract únicamente en AWS.
- Se añadió el permiso IAM `textract:AnalyzeDocument` al rol de Lambda.
- Se agregó límite de seis caracteres para las placas en frontend y backend.
- Se añadió eliminación de vehículos, bloqueada cuando existen expedientes o servicios no cerrados.
- Se reemplazó la confirmación nativa de eliminación por un modal con el estilo visual de la aplicación y manejo de errores.
- El botón de un vehículo abre directamente el formulario de solicitud con ese vehículo preseleccionado y permite cambiarlo.
- Al usar la ubicación del navegador, se completa automáticamente la dirección mediante geocodificación inversa.
- Se agregó validación backend para impedir asignar otro servicio a un técnico con un servicio `ASIGNADO` o `EN_EJECUCION`.
- Se actualizaron dependencias y pruebas relacionadas con el límite de placas y la integración OCR.

No se incluyen archivos de entorno con credenciales ni valores locales, como `apps/api/.env`.
