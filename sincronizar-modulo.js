// Copia el módulo de cotizador desde ../cotizador-module a src/cotizador.
// Ejecutar después de cambiar algo en el módulo: npm run sync
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const origen = path.resolve(aqui, '..', 'cotizador-module', 'src', 'cotizador');
const destino = path.resolve(aqui, 'src', 'cotizador');

fs.cpSync(origen, destino, { recursive: true, force: true });
console.log('Módulo sincronizado en src/cotizador');
