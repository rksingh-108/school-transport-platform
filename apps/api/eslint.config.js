// @ts-check
const base = require('@school-transport/config/eslint.base.js');

module.exports = [
  ...base,
  {
    languageOptions: {
      sourceType: 'commonjs',
    },
    rules: {
      // NestJS's DI/decorator patterns rely on classes with no explicit
      // runtime use of some constructor-injected params in a few places
      // (e.g. Terminus health indicator functions); keep this a warning, not
      // an error, for this app.
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // OFF, not just relaxed: this rule cannot distinguish "used only as a
      // type in this file's syntax" from "needed as a value for Nest's
      // emitDecoratorMetadata-based constructor injection." Its autofix
      // silently broke DI here once already (converted ConfigService,
      // HealthCheckService, etc. to `import type`, which Nest then couldn't
      // resolve at runtime) — see the comments in health.controller.ts,
      // prisma.service.ts, redis.service.ts, s3-storage.provider.ts.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
