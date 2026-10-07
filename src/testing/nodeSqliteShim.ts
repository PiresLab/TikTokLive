// Só pros testes: o Vitest 2 não resolve `node:sqlite` (builtin novo) e tenta carregar "sqlite" como pacote.
import { createRequire } from 'node:module';

export const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
