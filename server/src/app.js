import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { router } from './routes/index.js';
import { withActor, notFoundHandler, errorHandler } from './middleware.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    cors({
      origin(origin, cb) {
        // allow tools like curl (no Origin) and the configured React origins
        if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
        cb(new Error(`Origin ${origin} is not allowed by CORS`));
      },
      allowedHeaders: ['Content-Type', 'X-Demo-User', 'X-Confirm', 'Last-Event-ID'],
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', withActor, router);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
