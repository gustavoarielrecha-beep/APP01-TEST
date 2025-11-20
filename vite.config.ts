import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    let geminiApiKey = env.GEMINI_API_KEY;

    // Lógica para Docker Secrets:
    // Si la variable existe y parece una ruta a un secreto (comienza con /run/secrets/),
    // intentamos leer el contenido del archivo.
    if (geminiApiKey && geminiApiKey.startsWith('/run/secrets/')) {
        try {
            if (fs.existsSync(geminiApiKey)) {
                // Leemos el archivo y eliminamos espacios en blanco (newlines)
                geminiApiKey = fs.readFileSync(geminiApiKey, 'utf-8').trim();
                console.log('✅ API Key cargada exitosamente desde Docker Secret');
            } else {
                console.warn(`⚠️ La variable apunta a ${geminiApiKey}, pero el archivo no existe.`);
            }
        } catch (e) {
            console.error(`❌ Error leyendo Docker Secret en ${geminiApiKey}:`, e);
        }
    }

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // ESTA LÍNEA PERMITE CUALQUIER HOST (Incluyendo el de Docker)
        allowedHosts: true,
      },
      plugins: [react()],
      define: {
        // Inyectamos el valor LEÍDO del archivo, no la ruta
        'process.env.API_KEY': JSON.stringify(geminiApiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve('.'),
        }
      }
    };
});