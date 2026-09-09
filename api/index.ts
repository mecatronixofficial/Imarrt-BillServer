import type { Request, Response } from 'express';
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main.js';

type ExpressHandler = (request: Request, response: Response) => void;

let appPromise: Promise<INestApplication> | undefined;

async function getApp(): Promise<INestApplication> {
  if (!appPromise) {
    appPromise = createApp().then(async (app) => {
      await app.init();
      return app;
    });
  }

  return appPromise;
}

export default async function handler(request: Request, response: Response) {
  const app = await getApp();
  const expressHandler = app.getHttpAdapter().getInstance() as ExpressHandler;
  expressHandler(request, response);
}
