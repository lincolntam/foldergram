import { DatabaseSync } from 'node:sqlite';

import { schemaSql } from './schema.js';
import { storageService } from '../services/storage-service.js';

class DatabaseManager {
  private database: DatabaseSync;

  constructor() {
    this.database = new DatabaseSync(storageService.getDatabasePath());
    this.assertNoLegacySchema();
    this.applyCompatColumnMigrations();
    this.database.exec(schemaSql);
    this.applyCompatIndexes();
  }

  get connection(): DatabaseSync {
    return this.database;
  }

  private tableExists(name: string): boolean {
    const row = this.database
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(name) as { name: string } | undefined;

    return row?.name === name;
  }

  private tableHasColumn(tableName: string, columnName: string): boolean {
    if (!this.tableExists(tableName)) {
      return false;
    }

    const columns = this.database.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
    return columns.some((column) => column.name === columnName);
  }

  private assertNoLegacySchema(): void {
    const hasLegacyProfilesTable = this.tableExists('profiles');
    const imagesUseLegacyProfileId = this.tableHasColumn('images', 'profile_id');

    if (!hasLegacyProfilesTable && !imagesUseLegacyProfileId) {
      return;
    }

    throw new Error('Legacy database schema detected. Delete the SQLite file and restart the app to rebuild the database with folders/folder_id tables.');
  }

  private applyCompatColumnMigrations(): void {
    if (this.tableExists('images') && !this.tableHasColumn('images', 'media_type')) {
      this.database.exec("ALTER TABLE images ADD COLUMN media_type TEXT NOT NULL DEFAULT 'image'");
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'duration_ms')) {
      this.database.exec('ALTER TABLE images ADD COLUMN duration_ms REAL NULL');
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'is_animated')) {
      this.database.exec('ALTER TABLE images ADD COLUMN is_animated INTEGER NULL');
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'taken_at')) {
      this.database.exec('ALTER TABLE images ADD COLUMN taken_at INTEGER NULL');
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'taken_at_source')) {
      this.database.exec('ALTER TABLE images ADD COLUMN taken_at_source TEXT NULL');
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'playback_strategy')) {
      this.database.exec("ALTER TABLE images ADD COLUMN playback_strategy TEXT NULL");
    }

    if (this.tableExists('images') && this.tableHasColumn('images', 'playback_strategy')) {
      this.database.exec("UPDATE images SET playback_strategy = 'preview' WHERE media_type != 'video' AND playback_strategy IS NULL");
    }

    if (this.tableExists('images') && this.tableHasColumn('images', 'is_animated')) {
      this.database.exec("UPDATE images SET is_animated = 0 WHERE media_type = 'video' AND is_animated IS NULL");
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'is_trashed')) {
      this.database.exec('ALTER TABLE images ADD COLUMN is_trashed INTEGER NOT NULL DEFAULT 0');
    }

    if (this.tableExists('images') && !this.tableHasColumn('images', 'trashed_at')) {
      this.database.exec('ALTER TABLE images ADD COLUMN trashed_at TEXT NULL');
    }

    if (this.tableExists('images') && this.tableHasColumn('images', 'is_trashed') && this.tableHasColumn('images', 'trashed_at')) {
      this.database.exec('UPDATE images SET trashed_at = NULL WHERE is_trashed = 0');
    }
  }

  private applyCompatIndexes(): void {
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_taken_at ON images(taken_at DESC)');
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_taken_at_source ON images(is_deleted, taken_at_source)');
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_media_type ON images(media_type, is_deleted, sort_timestamp DESC)');
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_folder_media_sort ON images(folder_id, media_type, is_deleted, sort_timestamp DESC)');
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_visibility_flags ON images(is_deleted, is_trashed)');
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_taken_at_source_visibility ON images(is_deleted, is_trashed, taken_at_source)');
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_images_folder_visible_sort ON images(folder_id, is_deleted, is_trashed, sort_timestamp DESC)'
    );
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_images_folder_media_visible_sort ON images(folder_id, media_type, is_deleted, is_trashed, sort_timestamp DESC)'
    );
    this.database.exec(
      'CREATE INDEX IF NOT EXISTS idx_images_media_visible_sort ON images(media_type, is_deleted, is_trashed, sort_timestamp DESC)'
    );
    this.database.exec('CREATE INDEX IF NOT EXISTS idx_images_trashed_listing ON images(is_trashed, is_deleted, trashed_at DESC, id DESC)');
  }
}

export const databaseManager = new DatabaseManager();
