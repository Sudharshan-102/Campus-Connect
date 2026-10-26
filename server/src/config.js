import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });
dotenv.config();

const bool = (v, d) => (v === undefined ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

export const config = {
  surreal: {
    url: process.env.SURREAL_URL || 'ws://127.0.0.1:8000/rpc',
    user: process.env.SURREAL_USER || 'root',
    pass: process.env.SURREAL_PASS || 'root',
    namespace: process.env.SURREAL_NS || 'campus',
    database: process.env.SURREAL_DB || 'connect',
  },
  port: Number(process.env.PORT || 4000),
  corsOrigins: (process.env.CORS_ORIGIN || 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  autoSeed: bool(process.env.AUTO_SEED, true),
  allowReset: bool(process.env.ALLOW_RESET, true),
};

export const isEmbedded = () => config.surreal.url.startsWith('mem://') || config.surreal.url.startsWith('surrealkv://');
