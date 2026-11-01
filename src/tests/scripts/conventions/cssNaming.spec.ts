import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filePath) : [filePath];
  });
}

describe('CSS naming convention', () => {
  it('uses underscores for component class names', () => {
    const sourceFiles = walk(path.resolve('src')).filter(
      (filePath) => filePath.endsWith('.vue') || filePath.endsWith('.scss'),
    );
    const classAttributePattern = /class\s*=\s*"([^"]*)"/g;
    const selectorPattern = /\.([a-z][a-z0-9]*-[a-z0-9_-]*)/g;

    for (const filePath of sourceFiles) {
      const source = fs.readFileSync(filePath, 'utf8');
      for (const match of source.matchAll(classAttributePattern)) {
        expect(match[1], filePath).not.toMatch(/\b[a-z][a-z0-9]*-[a-z0-9_-]*\b/);
      }
      if (filePath.endsWith('.scss')) {
        expect(source.match(selectorPattern), filePath).toBeNull();
      }
    }
  });
});
