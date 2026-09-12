import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['dist/**', '.local/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    extends: [...obsidianmd.configs.recommended],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: ['AI Inbox', 'Chrome', 'Obsidian'], acronyms: ['P0'] }] },
  },
  {
    files: ['src/extension/**/*.ts', 'src/capture/**/*.ts', 'src/assets/**/*.ts',
      'src/persistence/**/*.ts', 'src/transport/**/*.ts', 'src/shared/**/*.ts', 'src/render/**/*.ts', 'src/core/**/*.ts'],
    // These modules target Chrome or Node, not Obsidian UI or lifecycle APIs.
    rules: { ...Object.fromEntries(Object.keys(obsidianmd.rules).map(name => [`obsidianmd/${name}`, 'off'])),
      'no-restricted-globals': 'off' },
  },
  {
    files: ['src/extension/**/*.ts'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
]);
