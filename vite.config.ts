
import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    
    let geminiApiKey = env.GEMINI_API_KEY;

    // Lógica para Docker Secrets
    if (geminiApiKey && geminiApiKey.startsWith('/run/secrets/')) {
        try {
            if (fs.existsSync(geminiApiKey)) {
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
        allowedHosts: true,
        // PROXY: Redirige llamadas /api al backend Express en puerto 3001
        proxy: {
          '/api': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            secure: false,
          }
        }
      },
      plugins: [react()],
      define: {
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
