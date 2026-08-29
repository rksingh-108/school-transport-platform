import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

// This monorepo uses a single root-level .env (see .env.example), not a
// per-app one. Package manager / task runners typically set cwd to the
// package directory when running a script, so ConfigModule's default
// (process.cwd()) would miss it — resolve explicitly relative to this file
// instead, which stays correct whether running from src/ (ts-node) or dist/
// (compiled), since both sit one level under apps/api.
const ROOT_ENV_PATH = resolve(__dirname, '../../../../.env');

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ROOT_ENV_PATH,
      validate: validateEnv,
    }),
  ],
})
export class AppConfigModule {}
