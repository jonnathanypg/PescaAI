-- ══════════════════════════════════════════════════════════════
-- 🐟 Pesca AI OS — Script de Migración Inicial para MariaDB / MySQL
-- Base de Datos de Producción / Staging en VPS (Contabo)
-- Base de datos: tecopesca_staging / pescaai_production
-- Compatible con MariaDB 10.x+ y MySQL 8.0+
-- ══════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `tecopesca_staging` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `tecopesca_staging`;

-- 1. Tabla de Usuarios y Roles (Admin, Directivo, Supervisor)
CREATE TABLE IF NOT EXISTS `usuarios` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `username` VARCHAR(64) UNIQUE NOT NULL,
  `password` VARCHAR(128) NOT NULL,
  `nombre` VARCHAR(128) NOT NULL,
  `rol` VARCHAR(32) NOT NULL,
  `telefono` VARCHAR(32) NULL,
  `activo` INT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Tabla de Operarias de Deslomado
CREATE TABLE IF NOT EXISTS `operarias` (
  `id` VARCHAR(32) PRIMARY KEY,
  `nombre` VARCHAR(128) NOT NULL,
  `mesa_asignada` INT DEFAULT 6,
  `turno` VARCHAR(32) DEFAULT 'TURNO_1',
  `activa` INT DEFAULT 1,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Tabla Principal de Pesajes en Estación de Deslomado
CREATE TABLE IF NOT EXISTS `pesajes` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `uuid` VARCHAR(64) UNIQUE,
  `mesa` INT NOT NULL,
  `operaria_id` VARCHAR(32) NOT NULL,
  `tipo_producto` VARCHAR(64) NOT NULL,
  `peso_kg` DECIMAL(8,3) NOT NULL,
  `origen_captura` VARCHAR(32) DEFAULT 'VOZ_ZERO_UI',
  `audio_transcripcion` TEXT,
  `lem_energy` DECIMAL(6,4),
  `lem_status` VARCHAR(32),
  `rendimiento_estimado` DECIMAL(5,2),
  `turno` VARCHAR(32) DEFAULT 'TURNO_1',
  `timestamp_emision` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  `timestamp_db` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_pesajes_mesa` (`mesa`),
  INDEX `idx_pesajes_operaria` (`operaria_id`),
  INDEX `idx_pesajes_timestamp` (`timestamp_db`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Paradas de Línea e Incidencias Operativas
CREATE TABLE IF NOT EXISTS `paradas_linea` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `mesa` INT NOT NULL,
  `motivo` VARCHAR(255) NOT NULL,
  `tiempo_estimado_min` INT DEFAULT 5,
  `reportado_por` VARCHAR(64) DEFAULT 'SUPERVISOR',
  `audio_transcripcion` TEXT,
  `resuelto` INT DEFAULT 0,
  `timestamp_inicio` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_paradas_mesa` (`mesa`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Registros de Calidad e Inocuidad HACCP / Autoclaves / Temperatura
CREATE TABLE IF NOT EXISTS `registros_haccp` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `uuid` VARCHAR(64) UNIQUE,
  `mesa` INT DEFAULT 6,
  `lote_cuba` VARCHAR(64) DEFAULT 'CUBA-04',
  `parametro` VARCHAR(64) NOT NULL,
  `valor_medido` DECIMAL(8,2) NOT NULL,
  `unidad` VARCHAR(16) DEFAULT 'C',
  `cumple_norma` INT DEFAULT 1,
  `lem_energy` DECIMAL(8,4) DEFAULT 0.0,
  `audio_transcripcion` TEXT,
  `inspector` VARCHAR(64) DEFAULT 'SUPERVISOR_CALIDAD',
  `timestamp_db` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_haccp_parametro` (`parametro`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Telemetría y Auditoría Inmutable LEM (C99 Silicon + Multi-Layer Guard)
CREATE TABLE IF NOT EXISTS `lem_telemetria` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `event_type` VARCHAR(64),
  `z_vector` TEXT,
  `energy` DECIMAL(8,4),
  `verdict` VARCHAR(32),
  `reason` TEXT,
  `latency_ms` INT,
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. Trazas del Sistema Multi-Agente
CREATE TABLE IF NOT EXISTS `agent_traces` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `trace_id` VARCHAR(64),
  `agent_name` VARCHAR(64) NOT NULL,
  `intent` VARCHAR(64) NOT NULL,
  `tool_called` VARCHAR(64),
  `input_text` TEXT,
  `output_text` TEXT,
  `lem_pre_energy` DECIMAL(8,4) DEFAULT 0.0,
  `lem_tool_energy` DECIMAL(8,4) DEFAULT 0.0,
  `lem_post_energy` DECIMAL(8,4) DEFAULT 0.0,
  `contingency_triggered` INT DEFAULT 0,
  `latency_ms` INT DEFAULT 0,
  `signature_hash` VARCHAR(64),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_traces_trace_id` (`trace_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Línea de Tiempo Inmutable y Versionamiento de Registros
CREATE TABLE IF NOT EXISTS `pesajes_versiones` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `pesaje_id` INT NOT NULL,
  `version_numero` INT NOT NULL,
  `mesa` INT NOT NULL,
  `operaria_id` VARCHAR(32) NOT NULL,
  `tipo_producto` VARCHAR(64) NOT NULL,
  `peso_kg` DECIMAL(8,3) NOT NULL,
  `accion` VARCHAR(32) NOT NULL,
  `motivo_cambio` TEXT,
  `modificado_por` VARCHAR(64) DEFAULT 'SUPERVISOR',
  `signature_hash` VARCHAR(64),
  `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_versiones_pesaje_id` (`pesaje_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Datos Semilla Iniciales
INSERT IGNORE INTO `operarias` (`id`, `nombre`, `mesa_asignada`, `turno`, `activa`) VALUES
  ('14', 'María Cedeño', 6, 'TURNO_1', 1),
  ('15', 'Rosa Anchundia', 6, 'TURNO_1', 1),
  ('16', 'Carmen Delgado', 6, 'TURNO_1', 1),
  ('17', 'Juana Mero', 6, 'TURNO_1', 1),
  ('18', 'Patricia Bailón', 6, 'TURNO_1', 1),
  ('19', 'Lourdes López', 6, 'TURNO_1', 1),
  ('20', 'Ana Macías', 6, 'TURNO_1', 1),
  ('21', 'Glenda Lucas', 6, 'TURNO_1', 1),
  ('22', 'Tatiana Quijije', 6, 'TURNO_1', 1),
  ('23', 'Silvia Zambrano', 6, 'TURNO_1', 1);

INSERT IGNORE INTO `usuarios` (`username`, `password`, `nombre`, `rol`, `telefono`, `activo`) VALUES
  ('admin', '123', 'Administrador de Planta', 'admin', '593999999999', 1),
  ('directivo', '123', 'Dirección de Operaciones', 'directivo', '593999999999', 1),
  ('supervisor', '123', 'Supervisor Planta Mesa 6', 'supervisor', '593988888888', 1);
