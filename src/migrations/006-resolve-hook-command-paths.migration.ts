import * as fs from 'fs/promises';
import path from 'path';
import { homedir } from 'os';
import type { Migration, MigrationResult } from './types.js';
import { MigrationRegistry } from './registry.js';
import { resolveCodemieBinary, rewriteHooksCommandTree } from '../utils/hook-command.js';
import { logger } from '../utils/logger.js';

/**
 * Migration 006: Rewrite installed hook commands to the absolute codemie path.
 *
 * Installed Claude/Gemini hook files historically used a bare `codemie` command,
 * which fails with `codemie: command not found` when the hook shell's PATH does
 * not contain the codemie bin directory (e.g. a user-prefix install without
 * admin rights). This one-time migration localizes existing installs so users
 * on the fixed version are repaired even if their plugin version did not bump.
 *
 * See EPMCDME-14035.
 */
class RewriteHookCommandPathsMigration implements Migration {
  id = '006-resolve-hook-command-paths';
  description = 'Rewrite installed Claude/Gemini hook commands to the absolute codemie path';
  minVersion = '0.1.0';

  private hookFiles(): string[] {
    return [
      path.join(homedir(), '.codemie', 'claude-plugin', 'hooks', 'hooks.json'),
      path.join(homedir(), '.gemini', 'extensions', 'codemie', 'hooks', 'hooks.json'),
    ];
  }

  async up(): Promise<MigrationResult> {
    logger.info('[006-resolve-hook-command-paths] Starting installed-hook path rewrite');

    let migrated = false;
    let anyWriteFailed = false;
    let binary: string | undefined;

    for (const file of this.hookFiles()) {
      let parsed: { hooks?: unknown };
      try {
        parsed = JSON.parse(await fs.readFile(file, 'utf-8')) as { hooks?: unknown };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== 'ENOENT') {
          logger.warn(`[006-resolve-hook-command-paths] Skipped ${file}: ${(error as Error)?.message ?? error}`);
        }
        continue;
      }

      binary ??= await resolveCodemieBinary();
      if (rewriteHooksCommandTree(parsed.hooks, binary)) {
        try {
          await fs.writeFile(file, JSON.stringify(parsed, null, 2), 'utf-8');
          logger.info(`[006-resolve-hook-command-paths] Rewrote ${file}`);
          migrated = true;
        } catch (error) {
          // A rewrite was needed but could not be persisted. Report failure so the
          // MigrationRunner does NOT record this migration as applied — otherwise a
          // transient write error (EACCES/EPERM/disk full) would leave the hooks
          // broken forever with no retry. success:false keeps it pending.
          anyWriteFailed = true;
          logger.warn(
            `[006-resolve-hook-command-paths] Failed to write ${file}: ${(error as Error)?.message ?? error}`,
          );
        }
      }
    }

    if (anyWriteFailed) {
      return { success: false, migrated, reason: 'write-failed' };
    }
    return { success: true, migrated, reason: migrated ? undefined : 'nothing-to-rewrite' };
  }
}

// Auto-register the migration
MigrationRegistry.register(new RewriteHookCommandPathsMigration());

// Export for testing
export { RewriteHookCommandPathsMigration };
