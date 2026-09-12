import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
  { ignores: ['dist/**', '.local/**', 'node_modules/**'] },
  {
    files: ['spikes/**/*.ts'],
    extends: [...obsidianmd.configs.recommended],
    languageOptions: { parserOptions: { projectService: true } },
    rules: { 'obsidianmd/ui/sentence-case': ['warn', { brands: ['AI Inbox', 'Chrome', 'Obsidian'], acronyms: ['P0'] }] },
  },
  {
    files: ['spikes/extension/**/*.ts', 'spikes/capture/**/*.ts', 'spikes/assets/**/*.ts',
      'spikes/persistence/**/*.ts', 'spikes/transport/**/*.ts', 'spikes/shared/**/*.ts', 'spikes/render/**/*.ts', 'spikes/core/**/*.ts'],
    // These modules target Chrome or Node, not Obsidian UI or lifecycle APIs.
    rules: { ...Object.fromEntries(Object.keys(obsidianmd.rules).map(name => [`obsidianmd/${name}`, 'off'])),
      'no-restricted-globals': 'off' },
  },
  {
    files: ['spikes/extension/**/*.ts'],
    languageOptions: { globals: { chrome: 'readonly' } },
  },
]);
