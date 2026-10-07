//! Index — a **disposable** cache over the vault.
//!
//! Nothing here is authoritative. Delete the SQLite file and [`Index::sync`]
//! rebuilds it from disk. That invariant is what keeps files-as-truth honest,
//! so no code in this crate may ever be the only place a fact lives.
//!
//! Ranking is **trust-weighted**: BM25 relevance is multiplied by
//! [`VerifyStatus::weight`], so notes you have reviewed outrank drafts. This is
//! the mechanism by which review effort compounds.

use axonix_vault::{Note, Vault, VaultError, VerifyStatus};
use camino::{Utf8Path, Utf8PathBuf};
use rusqlite::{Connection, OptionalExtension, params};

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("vault: {0}")]
    Vault(#[from] VaultError),
}

/// How a sync changed the index.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct SyncReport {
    pub added: usize,
    pub updated: usize,
    pub removed: usize,
    pub unchanged: usize,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct SearchHit {
    pub path: Utf8PathBuf,
    pub title: String,
    pub status: VerifyStatus,
    /// Trust-weighted score. Higher is better.
    pub score: f64,
    pub snippet: String,
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Stats {
    pub notes: usize,
    pub verified: usize,
    pub unverified: usize,
    pub unknown: usize,
    pub links: usize,
    pub tags: usize,
}

pub struct Index {
    conn: Connection,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS notes (
    path         TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    status       TEXT NOT NULL,
    generated_by TEXT,
    word_count   INTEGER NOT NULL DEFAULT 0,
    tasks_total  INTEGER NOT NULL DEFAULT 0,
    tasks_done   INTEGER NOT NULL DEFAULT 0,
    mtime        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS links (
    source TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
    target TEXT NOT NULL,
    alias  TEXT
);
CREATE INDEX IF NOT EXISTS idx_links_source ON links(source);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target);

CREATE TABLE IF NOT EXISTS tags (
    path TEXT NOT NULL REFERENCES notes(path) ON DELETE CASCADE,
    tag  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
    path UNINDEXED,
    title,
    body,
    tokenize = 'porter unicode61'
);

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

/// Bump whenever parsing or the schema changes in a way that makes existing rows
/// stale.
///
/// Sync detects file changes by mtime, so a change to *how* a file is parsed
/// would otherwise never be applied to already-indexed notes — the fix would look
/// like it silently did nothing. On a version mismatch the index is emptied and
/// rebuilt from disk, which is safe precisely because the index is disposable.
///
/// History:
///   1 — initial
///   2 — lenient frontmatter fallback for YAML-invalid blocks
const INDEX_VERSION: i64 = 2;

impl Index {
    /// Where the index for a given vault lives by default.
    ///
    /// Deliberately **outside the vault**: `%LOCALAPPDATA%\Axonix\<hash>\index.sqlite`
    /// on Windows. The index is a disposable cache, and a hidden multi-megabyte SQLite
    /// file inside an Obsidian vault would be indexed by Obsidian and synced to mobile
    /// for no reason. The path is keyed by a hash of the vault root so several vaults
    /// can coexist.
    pub fn default_path(vault_root: &Utf8Path) -> Utf8PathBuf {
        use std::hash::{Hash, Hasher};
        let mut h = std::collections::hash_map::DefaultHasher::new();
        vault_root.as_str().to_lowercase().hash(&mut h);
        let key = format!("{:016x}", h.finish());

        let base = std::env::var("LOCALAPPDATA")
            .ok()
            .or_else(|| std::env::var("XDG_CACHE_HOME").ok())
            .or_else(|| std::env::var("HOME").map(|h| format!("{h}/.cache")).ok())
            .unwrap_or_else(|| ".".into());

        Utf8PathBuf::from(base.replace('\\', "/"))
            .join("Axonix")
            .join(key)
            .join("index.sqlite")
    }

    /// Open (creating if needed) an index at `db_path`. Use `:memory:` for tests.
    ///
    /// If `db_path` points at a real file on disk that is corrupt (SQLite
    /// "database disk image is malformed" — almost always a leftover WAL after a
    /// hard kill), the file is deleted and recreated, because the index is a
    /// disposable cache that `sync` rebuilds from the vault. This lets the capture
    /// server self-heal on launch instead of crashing and leaving the app stuck on
    /// "Server unreachable".
    pub fn open(db_path: impl AsRef<Utf8Path>) -> Result<Self, IndexError> {
        let p = db_path.as_ref();
        if p == ":memory:" {
            let mut this = Self {
                conn: Connection::open_in_memory()?,
            };
            this.conn.execute_batch(SCHEMA)?;
            this.migrate()?;
            return Ok(this);
        }

        let std = p.as_std_path();
        match Self::open_inner(std) {
            Ok(index) => Ok(index),
            Err(e) if Self::is_corruption(&e) => {
                tracing::warn!(path = %p, error = %e, "index corrupt; deleting and rebuilding from disk");
                Self::remove_index_files(std);
                Self::open_inner(std)
            }
            Err(e) => Err(e),
        }
    }

    fn open_inner(std: &std::path::Path) -> Result<Self, IndexError> {
        if let Some(parent) = std.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let conn = Connection::open(std)?;
        conn.execute_batch(SCHEMA)?;
        let mut this = Self { conn };
        this.migrate()?;
        Ok(this)
    }

    /// True when `e` looks like on-disk SQLite corruption — the only failure we
    /// are willing to repair by deleting the file, since the index is disposable.
    fn is_corruption(e: &IndexError) -> bool {
        if let IndexError::Sqlite(rusqlite::Error::SqliteFailure(f, _)) = e {
            if f.extended_code == 11 || f.code == rusqlite::ErrorCode::DatabaseCorrupt {
                return true;
            }
        }
        let msg = e.to_string().to_lowercase();
        msg.contains("malformed") || msg.contains("database disk image") || msg.contains("file is not a database")
    }

    /// Remove the index file plus its WAL/SHM/journal siblings so a fresh open is
    /// not poisoned by a stale companion file.
    fn remove_index_files(std: &std::path::Path) {
        let _ = std::fs::remove_file(std);
        for ext in ["sqlite-wal", "sqlite-shm", "sqlite-journal"] {
            let _ = std::fs::remove_file(std.with_extension(ext));
        }
    }

    /// Empty the index if it was written by a different parser version.
    fn migrate(&mut self) -> Result<(), IndexError> {
        let found: Option<i64> = self
            .conn
            .query_row("SELECT value FROM meta WHERE key='index_version'", [], |r| {
                r.get::<_, String>(0)
            })
            .optional()?
            .and_then(|s| s.parse().ok());

        if found == Some(INDEX_VERSION) {
            return Ok(());
        }

        if found.is_some() {
            tracing::info!(
                from = ?found,
                to = INDEX_VERSION,
                "index version changed; rebuilding from disk"
            );
        }
        let tx = self.conn.transaction()?;
        tx.execute_batch(
            "DELETE FROM notes_fts; DELETE FROM links; DELETE FROM tags; DELETE FROM notes;",
        )?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('index_version', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![INDEX_VERSION.to_string()],
        )?;
        tx.commit()?;
        Ok(())
    }

    /// Bring the index in line with the vault on disk.
    ///
    /// Change detection is by mtime. Notes on disk that are unchanged are skipped;
    /// notes in the index that no longer exist on disk are removed.
    pub fn sync(&mut self, vault: &Vault) -> Result<SyncReport, IndexError> {
        let mut report = SyncReport::default();
        let on_disk = vault.note_paths()?;

        for rel in &on_disk {
            let mtime = vault.mtime(rel)?;
            let known: Option<i64> = self
                .conn
                .query_row(
                    "SELECT mtime FROM notes WHERE path = ?1",
                    params![rel.as_str()],
                    |r| r.get(0),
                )
                .optional()?;

            match known {
                Some(m) if m == mtime => {
                    report.unchanged += 1;
                    continue;
                }
                Some(_) => report.updated += 1,
                None => report.added += 1,
            }

            let (note, body) = vault.read_note_with_content(rel)?;
            self.upsert(&note, &body, mtime)?;
        }

        // Anything indexed but no longer present.
        let indexed: Vec<String> = {
            let mut stmt = self.conn.prepare("SELECT path FROM notes")?;
            let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
            rows.collect::<Result<_, _>>()?
        };
        let present: std::collections::HashSet<&str> =
            on_disk.iter().map(|p| p.as_str()).collect();
        for path in indexed {
            if !present.contains(path.as_str()) {
                self.remove(&path)?;
                report.removed += 1;
            }
        }

        Ok(report)
    }

    /// Insert or replace a single note.
    pub fn upsert(&mut self, note: &Note, body: &str, mtime: i64) -> Result<(), IndexError> {
        let tx = self.conn.transaction()?;
        let path = note.path.as_str();

        tx.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        tx.execute(
            "INSERT INTO notes (path, title, status, generated_by, word_count,
                                tasks_total, tasks_done, mtime)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(path) DO UPDATE SET
                title=excluded.title, status=excluded.status,
                generated_by=excluded.generated_by, word_count=excluded.word_count,
                tasks_total=excluded.tasks_total, tasks_done=excluded.tasks_done,
                mtime=excluded.mtime",
            params![
                path,
                note.title,
                status_str(note.status),
                note.generated_by,
                note.word_count as i64,
                note.tasks_total as i64,
                note.tasks_done as i64,
                mtime,
            ],
        )?;

        tx.execute("DELETE FROM links WHERE source = ?1", params![path])?;
        for l in &note.links {
            tx.execute(
                "INSERT INTO links (source, target, alias) VALUES (?1, ?2, ?3)",
                params![path, l.target, l.alias],
            )?;
        }

        tx.execute("DELETE FROM tags WHERE path = ?1", params![path])?;
        for t in &note.tags {
            tx.execute(
                "INSERT INTO tags (path, tag) VALUES (?1, ?2)",
                params![path, t],
            )?;
        }

        tx.execute(
            "INSERT INTO notes_fts (path, title, body) VALUES (?1, ?2, ?3)",
            params![path, note.title, body],
        )?;

        tx.commit()?;
        Ok(())
    }

    pub fn remove(&mut self, path: &str) -> Result<(), IndexError> {
        let tx = self.conn.transaction()?;
        tx.execute("DELETE FROM notes_fts WHERE path = ?1", params![path])?;
        tx.execute("DELETE FROM notes WHERE path = ?1", params![path])?;
        tx.commit()?;
        Ok(())
    }

    /// Trust-weighted full-text search.
    ///
    /// FTS5 `bm25()` returns a *negative* score where more negative is more relevant.
    /// It is negated to a positive relevance, then multiplied by the note's trust
    /// weight, so a verified note beats an equally relevant draft.
    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, IndexError> {
        let fts_query = sanitize_fts_query(query);
        if fts_query.is_empty() {
            return Ok(Vec::new());
        }

        let mut stmt = self.conn.prepare(
            "SELECT f.path,
                    n.title,
                    n.status,
                    -bm25(notes_fts, 4.0, 1.0) AS relevance,
                    snippet(notes_fts, 2, '', '', '…', 12) AS snip
             FROM notes_fts f
             JOIN notes n ON n.path = f.path
             WHERE notes_fts MATCH ?1
             ORDER BY relevance DESC
             LIMIT ?2",
        )?;

        let rows = stmt.query_map(params![fts_query, (limit * 4) as i64], |r| {
            let status = status_from(&r.get::<_, String>(2)?);
            let relevance: f64 = r.get(3)?;
            Ok(SearchHit {
                path: Utf8PathBuf::from(r.get::<_, String>(0)?),
                title: r.get(1)?,
                status,
                score: relevance * status.weight() as f64,
                snippet: r.get::<_, String>(4)?.trim().to_owned(),
            })
        })?;

        let mut hits: Vec<SearchHit> = rows.collect::<Result<_, _>>()?;
        hits.sort_by(|a, b| b.score.total_cmp(&a.score));
        hits.truncate(limit);
        Ok(hits)
    }

    /// Notes linking *to* `target` (by link target string, as authored).
    pub fn backlinks(&self, target: &str) -> Result<Vec<Utf8PathBuf>, IndexError> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT source FROM links WHERE target = ?1 ORDER BY source")?;
        let rows = stmt.query_map(params![target], |r| r.get::<_, String>(0))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(Utf8PathBuf::from)
            .collect())
    }

    pub fn notes_with_tag(&self, tag: &str) -> Result<Vec<Utf8PathBuf>, IndexError> {
        let mut stmt = self
            .conn
            .prepare("SELECT DISTINCT path FROM tags WHERE tag = ?1 ORDER BY path")?;
        let rows = stmt.query_map(params![tag], |r| r.get::<_, String>(0))?;
        Ok(rows
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .map(Utf8PathBuf::from)
            .collect())
    }

    pub fn stats(&self) -> Result<Stats, IndexError> {
        let count = |sql: &str| -> Result<usize, IndexError> {
            Ok(self.conn.query_row(sql, [], |r| r.get::<_, i64>(0))? as usize)
        };
        Ok(Stats {
            notes: count("SELECT COUNT(*) FROM notes")?,
            verified: count("SELECT COUNT(*) FROM notes WHERE status='verified'")?,
            unverified: count("SELECT COUNT(*) FROM notes WHERE status='unverified'")?,
            unknown: count("SELECT COUNT(*) FROM notes WHERE status='unknown'")?,
            links: count("SELECT COUNT(*) FROM links")?,
            tags: count("SELECT COUNT(DISTINCT tag) FROM tags")?,
        })
    }
}

fn status_str(s: VerifyStatus) -> &'static str {
    match s {
        VerifyStatus::Verified => "verified",
        VerifyStatus::Unverified => "unverified",
        VerifyStatus::Unknown => "unknown",
    }
}

fn status_from(s: &str) -> VerifyStatus {
    match s {
        "verified" => VerifyStatus::Verified,
        "unverified" => VerifyStatus::Unverified,
        _ => VerifyStatus::Unknown,
    }
}

/// Turn free text into a safe FTS5 query.
///
/// FTS5 has its own syntax where `"`, `*`, `:`, `^`, `-`, `(`, `)` and `NEAR` are
/// operators. Passing raw user or agent input through causes syntax errors at best
/// and surprising matches at worst, so each word is quoted as a literal and the
/// words are AND-ed.
fn sanitize_fts_query(raw: &str) -> String {
    raw.split_whitespace()
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '/'))
        .filter(|w| !w.is_empty())
        .map(|w| format!("\"{}\"", w.replace('"', "")))
        .collect::<Vec<_>>()
        .join(" AND ")
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use axonix_vault::parse_note;

    fn idx() -> Index {
        Index::open(":memory:").unwrap()
    }

    fn add(ix: &mut Index, path: &str, body: &str) {
        let note = parse_note(Utf8PathBuf::from(path), body);
        ix.upsert(&note, body, 1).unwrap();
    }

    #[test]
    fn verified_outranks_unverified_at_equal_relevance() {
        let mut ix = idx();
        add(
            &mut ix,
            "draft.md",
            "---\nstatus: unverified\n---\n\nventuri cavitation venturi cavitation\n",
        );
        add(
            &mut ix,
            "trusted.md",
            "---\nstatus: verified\n---\n\nventuri cavitation venturi cavitation\n",
        );

        let hits = ix.search("venturi", 10).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[0].path.as_str(),
            "trusted.md",
            "verified note must rank first"
        );
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn search_is_not_broken_by_fts5_operators() {
        let mut ix = idx();
        add(&mut ix, "a.md", "notes about rust and sqlite\n");
        // Each of these would be an FTS5 syntax error if passed through raw.
        for q in ["rust*", "\"unterminated", "rust OR", "NEAR(a b)", "-rust", "a:b"] {
            let r = ix.search(q, 5);
            assert!(r.is_ok(), "query {q:?} errored: {:?}", r.err());
        }
    }

    #[test]
    fn empty_query_returns_nothing_rather_than_everything() {
        let mut ix = idx();
        add(&mut ix, "a.md", "content\n");
        assert!(ix.search("   ", 10).unwrap().is_empty());
        assert!(ix.search("!!!", 10).unwrap().is_empty());
    }

    #[test]
    fn backlinks_resolve() {
        let mut ix = idx();
        add(&mut ix, "a.md", "see [[Target Note]]\n");
        add(&mut ix, "b.md", "also [[Target Note|alias]]\n");
        add(&mut ix, "c.md", "unrelated\n");
        let back = ix.backlinks("Target Note").unwrap();
        assert_eq!(back.len(), 2);
        assert!(back.iter().any(|p| p.as_str() == "a.md"));
        assert!(back.iter().any(|p| p.as_str() == "b.md"));
    }

    #[test]
    fn reindex_replaces_rather_than_duplicates() {
        let mut ix = idx();
        add(&mut ix, "a.md", "---\ntags: [one]\n---\n\nalpha [[X]]\n");
        add(&mut ix, "a.md", "---\ntags: [two]\n---\n\nbeta [[Y]]\n");

        let s = ix.stats().unwrap();
        assert_eq!(s.notes, 1, "note duplicated on reindex");
        assert_eq!(s.links, 1, "stale link left behind");
        assert!(ix.backlinks("X").unwrap().is_empty(), "stale backlink");
        assert_eq!(ix.notes_with_tag("one").unwrap().len(), 0, "stale tag");
        assert_eq!(ix.notes_with_tag("two").unwrap().len(), 1);
        // FTS must not still match the old body.
        assert!(ix.search("alpha", 5).unwrap().is_empty(), "stale fts row");
        assert_eq!(ix.search("beta", 5).unwrap().len(), 1);
    }

    #[test]
    fn sync_detects_add_change_and_delete() {
        let tmp = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(tmp.path()).unwrap().to_path_buf();
        std::fs::write(root.join("one.md"), "# One\n\nalpha\n").unwrap();
        let vault = Vault::open(&root).unwrap();
        let mut ix = idx();

        let r = ix.sync(&vault).unwrap();
        assert_eq!((r.added, r.updated, r.removed), (1, 0, 0));

        let r = ix.sync(&vault).unwrap();
        assert_eq!((r.added, r.updated, r.unchanged), (0, 0, 1));

        std::fs::write(root.join("two.md"), "# Two\n\nbeta\n").unwrap();
        let r = ix.sync(&vault).unwrap();
        assert_eq!((r.added, r.unchanged), (1, 1));

        std::fs::remove_file(root.join("one.md")).unwrap();
        let r = ix.sync(&vault).unwrap();
        assert_eq!(r.removed, 1);
        assert_eq!(ix.stats().unwrap().notes, 1);
    }
}
