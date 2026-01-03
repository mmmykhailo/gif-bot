import { Database } from "bun:sqlite";

export interface GifRecord {
  file_unique_id: string;
  file_id: string;
  description: string;
  added_by: number;
}

export class GifDatabase {
  private db: Database;

  constructor(dbPath: string = "gifs.db") {
    this.db = new Database(dbPath, { create: true });
    this.initialize();
  }

  private initialize(): void {
    // Create main gifs table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS gifs (
        file_unique_id TEXT PRIMARY KEY,
        file_id TEXT NOT NULL,
        description TEXT NOT NULL,
        added_by INTEGER NOT NULL
      )
    `);

    // Create FTS5 virtual table with porter tokenizer for word-based search
    // Porter tokenizer works better with prefix matching for any length query
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS gifs_search USING fts5(
        file_unique_id UNINDEXED,
        description,
        tokenize="porter"
      )
    `);

    // Trigger: Insert into FTS when inserting into main table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS gifs_ai AFTER INSERT ON gifs BEGIN
        INSERT INTO gifs_search(file_unique_id, description)
        VALUES (new.file_unique_id, new.description);
      END
    `);

    // Trigger: Update FTS when updating main table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS gifs_au AFTER UPDATE ON gifs BEGIN
        UPDATE gifs_search
        SET description = new.description
        WHERE file_unique_id = new.file_unique_id;
      END
    `);

    // Trigger: Delete from FTS when deleting from main table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS gifs_ad AFTER DELETE ON gifs BEGIN
        DELETE FROM gifs_search WHERE file_unique_id = old.file_unique_id;
      END
    `);

    console.log("Database initialized successfully");
  }

  /**
   * Check if a GIF exists by file_unique_id
   */
  exists(fileUniqueId: string): boolean {
    const stmt = this.db.query<{ count: number }, [string]>(
      "SELECT COUNT(*) as count FROM gifs WHERE file_unique_id = ?"
    );
    const result = stmt.get(fileUniqueId);
    return result ? result.count > 0 : false;
  }

  /**
   * Get a GIF record by file_unique_id
   */
  get(fileUniqueId: string): GifRecord | null {
    const stmt = this.db.query<GifRecord, [string]>(
      "SELECT * FROM gifs WHERE file_unique_id = ?"
    );
    return stmt.get(fileUniqueId) || null;
  }

  /**
   * Insert a new GIF record
   */
  insert(record: GifRecord): void {
    const stmt = this.db.query(
      "INSERT INTO gifs (file_unique_id, file_id, description, added_by) VALUES (?, ?, ?, ?)"
    );
    stmt.run(
      record.file_unique_id,
      record.file_id,
      record.description,
      record.added_by
    );
  }

  /**
   * Update an existing GIF record (append description and update file_id)
   */
  update(fileUniqueId: string, newDescription: string, fileId: string): void {
    const existing = this.get(fileUniqueId);
    if (!existing) {
      throw new Error(`GIF with file_unique_id ${fileUniqueId} not found`);
    }

    const updatedDescription = `${existing.description} ${newDescription}`.trim();

    const stmt = this.db.query(
      "UPDATE gifs SET description = ?, file_id = ? WHERE file_unique_id = ?"
    );
    stmt.run(updatedDescription, fileId, fileUniqueId);
  }

  /**
   * Search GIFs using hybrid approach:
   * - LIKE search for partial substring matching (works for any length)
   * - FTS5 for full-text search with ranking (for complete words)
   * Returns up to 20 results optimized for speed
   */
  search(query: string, limit: number = 20): GifRecord[] {
    const lowerQuery = query.toLowerCase().trim();

    // Use LIKE for direct partial matching (handles short queries like "al" finding "albania")
    // This ensures any substring match is found
    const likeStmt = this.db.query<GifRecord, [string, number]>(`
      SELECT file_unique_id, file_id, description, added_by
      FROM gifs
      WHERE LOWER(description) LIKE '%' || ? || '%'
      LIMIT ?
    `);

    const likeResults = likeStmt.all(lowerQuery, limit);

    // If we have enough results from LIKE, return them
    if (likeResults.length >= limit) {
      return likeResults;
    }

    // Try FTS5 with prefix matching for additional results
    try {
      const sanitizedQuery = query.replace(/"/g, '""') + '*';
      const ftsStmt = this.db.query<GifRecord, [string, number]>(`
        SELECT DISTINCT g.file_unique_id, g.file_id, g.description, g.added_by
        FROM gifs_search gs
        JOIN gifs g ON gs.file_unique_id = g.file_unique_id
        WHERE gs.description MATCH ?
        ORDER BY rank
        LIMIT ?
      `);

      const ftsResults = ftsStmt.all(sanitizedQuery, limit);

      // Merge results, avoiding duplicates
      const resultMap = new Map<string, GifRecord>();

      // Add LIKE results first (they're more relevant for partial matches)
      for (const result of likeResults) {
        resultMap.set(result.file_unique_id, result);
      }

      // Add FTS results
      for (const result of ftsResults) {
        if (!resultMap.has(result.file_unique_id) && resultMap.size < limit) {
          resultMap.set(result.file_unique_id, result);
        }
      }

      return Array.from(resultMap.values()).slice(0, limit);
    } catch (error) {
      // If FTS fails, return LIKE results
      return likeResults;
    }
  }

  /**
   * Get the most recently added GIFs
   */
  getRecent(limit: number = 20): GifRecord[] {
    const stmt = this.db.query<GifRecord, [number]>(`
      SELECT file_unique_id, file_id, description, added_by
      FROM gifs
      ORDER BY ROWID DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Get database statistics
   */
  getStats(): { totalGifs: number } {
    const stmt = this.db.query<{ count: number }, []>(
      "SELECT COUNT(*) as count FROM gifs"
    );
    const result = stmt.get();
    return { totalGifs: result?.count || 0 };
  }
}
