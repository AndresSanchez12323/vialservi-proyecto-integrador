import { crearApp } from './app.js';
import { config } from './config.js';

crearApp().listen(config.API_PORT, () => {
  console.log(`API de VialServi escuchando en http://localhost:${config.API_PORT}`);
});
