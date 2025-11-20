
import express from 'express';
import pg from 'pg';
import cors from 'cors';

const { Pool } = pg;
const app = express();
const PORT = 3001;

// Configuración de la Base de Datos
const pool = new Pool({
  host: 'usdcfscmdn8n01.ajc.bz',
  port: 5432,
  database: 'oneglobe',
  user: 'og_mcp',
  password: 'og_mcp',
  ssl: {
    rejectUnauthorized: false // Necesario para algunas conexiones remotas sin certificados validados
  },
  connectionTimeoutMillis: 5000 // 5 segundos timeout
});

app.use(cors());
app.use(express.json());

// Endpoint de Salud (Verificar conexión DB)
app.get('/api/health', async (req, res) => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    res.json({ status: 'connected', time: result.rows[0].now });
  } catch (err) {
    console.error('Database connection error:', err);
    res.status(500).json({ 
      status: 'error', 
      message: err.message, 
      detail: 'No se pudo conectar al servidor PostgreSQL.' 
    });
  }
});

// Endpoint para Ejecutar Query
app.post('/api/query', async (req, res) => {
  const { sql } = req.body;

  if (!sql) {
    return res.status(400).json({ error: 'SQL query is required' });
  }

  // SEGURIDAD BÁSICA: Prevenir comandos destructivos simples
  const upperSql = sql.toUpperCase();
  if (upperSql.includes('DROP ') || upperSql.includes('DELETE ') || upperSql.includes('TRUNCATE ') || upperSql.includes('UPDATE ') || upperSql.includes('INSERT ')) {
     return res.status(403).json({ error: 'READ-ONLY MODE: Solo se permiten consultas SELECT por seguridad.' });
  }

  let client;
  try {
    client = await pool.connect();
    const result = await client.query(sql);
    res.json({ 
      rows: result.rows, 
      rowCount: result.rowCount, 
      fields: result.fields.map(f => f.name) 
    });
  } catch (err) {
    console.error('Query execution error:', err);
    res.status(400).json({ error: err.message });
  } finally {
    if (client) client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
