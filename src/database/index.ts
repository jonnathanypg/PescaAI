import Database from 'better-sqlite3';
import mysql from 'mysql2/promise';
import { config } from '../config';

export interface DatabaseAdapter {
  query<T = any>(sql: string, params?: any[]): Promise<T[]>;
  execute(sql: string, params?: any[]): Promise<{ insertId?: number; changes?: number }>;
  close(): Promise<void>;
}

class SQLiteAdapter implements DatabaseAdapter {
  private db: Database.Database;

  constructor(filePath: string) {
    this.db = new Database(filePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...params) as T[];
  }

  async execute(sql: string, params: any[] = []): Promise<{ insertId?: number; changes?: number }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...params);
    return {
      insertId: Number(info.lastInsertRowid),
      changes: info.changes
    };
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

class MySQLAdapter implements DatabaseAdapter {
  private pool: mysql.Pool;

  constructor(mysqlConfig: mysql.PoolOptions) {
    this.pool = mysql.createPool(mysqlConfig);
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await this.pool.query(sql, params);
    return rows as T[];
  }

  async execute(sql: string, params: any[] = []): Promise<{ insertId?: number; changes?: number }> {
    const [result] = await this.pool.execute(sql, params) as any;
    return {
      insertId: result.insertId,
      changes: result.affectedRows
    };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

let dbInstance: DatabaseAdapter;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (!dbInstance) {
    if (config.db.type === 'mysql') {
      console.log('[DB] Conectando a MySQL remoto/local...');
      dbInstance = new MySQLAdapter(config.db.mysql);
    } else {
      console.log(`[DB] Usando SQLite local (WAL Ultra-Low Latency): ${config.db.sqlitePath}`);
      dbInstance = new SQLiteAdapter(config.db.sqlitePath);
    }
    await initSchema(dbInstance);
  }
  return dbInstance;
}

export async function initSchema(db: DatabaseAdapter) {
  const isMysql = config.db.type === 'mysql';
  const primaryId = isMysql ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
  const insertIgnore = isMysql ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';

  // Usuarios y Roles del Sistema (Admin, Directivo, Supervisor)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id ${primaryId},
      username VARCHAR(64) UNIQUE NOT NULL,
      password VARCHAR(128) NOT NULL,
      nombre VARCHAR(128) NOT NULL,
      rol VARCHAR(32) NOT NULL, -- 'admin', 'directivo', 'supervisor'
      telefono VARCHAR(32),
      activo INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Operarias
  await db.execute(`
    CREATE TABLE IF NOT EXISTS operarias (
      id VARCHAR(32) PRIMARY KEY,
      nombre VARCHAR(128) NOT NULL,
      mesa_asignada INT DEFAULT 6,
      turno VARCHAR(32) DEFAULT 'TURNO_1',
      activa INT DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Pesajes en estación de deslomado (Lomo limpio / Sangacho / Trozos)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pesajes (
      id ${primaryId},
      uuid VARCHAR(64) UNIQUE,
      mesa INT NOT NULL,
      operaria_id VARCHAR(32) NOT NULL,
      tipo_producto VARCHAR(64) NOT NULL,
      peso_kg DECIMAL(8,3) NOT NULL,
      origen_captura VARCHAR(32) DEFAULT 'VOZ_ZERO_UI',
      audio_transcripcion TEXT,
      lem_energy DECIMAL(6,4),
      lem_status VARCHAR(32),
      rendimiento_estimado DECIMAL(5,2),
      turno VARCHAR(32) DEFAULT 'TURNO_1',
      timestamp_emision TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      timestamp_db TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Paradas de línea / Incidencias operativas
  await db.execute(`
    CREATE TABLE IF NOT EXISTS paradas_linea (
      id ${primaryId},
      mesa INT NOT NULL,
      motivo VARCHAR(255) NOT NULL,
      tiempo_estimado_min INT DEFAULT 5,
      reportado_por VARCHAR(64) DEFAULT 'SUPERVISOR',
      audio_transcripcion TEXT,
      resuelto INT DEFAULT 0,
      timestamp_inicio TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Registros de Calidad e Inocuidad HACCP / Autoclaves / Cadena de Frío
  await db.execute(`
    CREATE TABLE IF NOT EXISTS registros_haccp (
      id ${primaryId},
      uuid VARCHAR(64) UNIQUE,
      mesa INT DEFAULT 6,
      lote_cuba VARCHAR(64) DEFAULT 'CUBA-04',
      parametro VARCHAR(64) NOT NULL, -- 'TEMPERATURA_AUTOCLAVE', 'TEMPERATURA_ESPINA', 'HISTAMINA', 'ORGANOLEPTICO'
      valor_medido DECIMAL(8,2) NOT NULL,
      unidad VARCHAR(16) DEFAULT 'C',
      cumple_norma INT DEFAULT 1,
      lem_energy DECIMAL(8,4) DEFAULT 0.0,
      audio_transcripcion TEXT,
      inspector VARCHAR(64) DEFAULT 'SUPERVISOR_CALIDAD',
      timestamp_db TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Telemetría & Auditoría Inmutable LEM (C99 Silicon + Multi-Layer Guard)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS lem_telemetria (
      id ${primaryId},
      event_type VARCHAR(64),
      z_vector TEXT,
      energy DECIMAL(8,4),
      verdict VARCHAR(32),
      reason TEXT,
      latency_ms INT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Trazas del Sistema Multi-Agente
  await db.execute(`
    CREATE TABLE IF NOT EXISTS agent_traces (
      id ${primaryId},
      trace_id VARCHAR(64),
      agent_name VARCHAR(64) NOT NULL,
      intent VARCHAR(64) NOT NULL,
      tool_called VARCHAR(64),
      input_text TEXT,
      output_text TEXT,
      lem_pre_energy DECIMAL(8,4) DEFAULT 0.0,
      lem_tool_energy DECIMAL(8,4) DEFAULT 0.0,
      lem_post_energy DECIMAL(8,4) DEFAULT 0.0,
      contingency_triggered INT DEFAULT 0,
      latency_ms INT DEFAULT 0,
      signature_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Línea de Tiempo Inmutable y Versionamiento de Registros (Trazabilidad HACCP / IFS / BAP)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS pesajes_versiones (
      id ${primaryId},
      pesaje_id INT NOT NULL,
      version_numero INT NOT NULL,
      mesa INT NOT NULL,
      operaria_id VARCHAR(32) NOT NULL,
      tipo_producto VARCHAR(64) NOT NULL,
      peso_kg DECIMAL(8,3) NOT NULL,
      accion VARCHAR(32) NOT NULL, -- 'CREACION', 'CORRECCION_VOZ', 'AJUSTE_MANUAL', 'ANULACION'
      motivo_cambio TEXT,
      modificado_por VARCHAR(64) DEFAULT 'SUPERVISOR',
      signature_hash VARCHAR(64),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Sembrar operarias iniciales si no existen
  const rows = await db.query('SELECT COUNT(*) as count FROM operarias');
  const count = rows[0]?.count || 0;
  if (count === 0) {
    console.log('[DB] Sembrando 10 operarias asignadas para Mesa 6 (Piloto Tecopesca)...');
    const operariasSeed = [
      { id: '14', nombre: 'María Cedeño', mesa: 6 },
      { id: '15', nombre: 'Rosa Anchundia', mesa: 6 },
      { id: '16', nombre: 'Carmen Delgado', mesa: 6 },
      { id: '17', nombre: 'Juana Mero', mesa: 6 },
      { id: '18', nombre: 'Patricia Bailón', mesa: 6 },
      { id: '19', nombre: 'Lourdes López', mesa: 6 },
      { id: '20', nombre: 'Ana Macías', mesa: 6 },
      { id: '21', nombre: 'Glenda Lucas', mesa: 6 },
      { id: '22', nombre: 'Tatiana Quijije', mesa: 6 },
      { id: '23', nombre: 'Silvia Zambrano', mesa: 6 }
    ];

    for (const op of operariasSeed) {
      await db.execute(
        `${insertIgnore} operarias (id, nombre, mesa_asignada, turno, activa) VALUES (?, ?, ?, ?, ?)`,
        [op.id, op.nombre, op.mesa, 'TURNO_1', 1]
      );
    }
  }

  // Sembrar usuarios iniciales para demo/piloto
  const uRows = await db.query('SELECT COUNT(*) as count FROM usuarios');
  const uCount = uRows[0]?.count || 0;
  if (uCount === 0) {
    console.log('[DB] Sembrando usuarios base (admin, directivo, supervisor)...');
    const users = [
      { username: 'admin', password: '123', nombre: 'Administrador de Planta', rol: 'admin', tel: '593999999999' },
      { username: 'directivo', password: '123', nombre: 'Dirección de Operaciones', rol: 'directivo', tel: '593999999999' },
      { username: 'supervisor', password: '123', nombre: 'Supervisor Planta Mesa 6', rol: 'supervisor', tel: '593988888888' }
    ];

    for (const u of users) {
      await db.execute(
        `${insertIgnore} usuarios (username, password, nombre, rol, telefono, activo) VALUES (?, ?, ?, ?, ?, 1)`,
        [u.username, u.password, u.nombre, u.rol, u.tel]
      );
    }
  } else {
    await db.execute(`UPDATE usuarios SET nombre = 'Administrador de Planta' WHERE username = 'admin'`);
  }
}
