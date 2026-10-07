//! Vault layer — files on disk are the truth.
//!
//! This crate never writes an index and never caches. It reads markdown from a
//! vault directory and turns it into [`Note`] values. Everything downstream
//! (indexing, search, MCP tools) is built on top of this and is disposable.
//!
//! Obsidian-flavoured markdown parsing is delegated to `turbovault-parser`.
//! What this crate adds is the part specific to Axonix: **trust status**.
//! A note's `status:` frontmatter is promoted to a first-class [`VerifyStatus`],
//! because retrieval ranks verified notes above unverified ones.

use camino::{Utf8Path, Utf8PathBuf};
use turbovault_parser::prelude::*;
use walkdir::WalkDir;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("vault root does not exist: {0}")]
    RootMissing(Utf8PathBuf),
    #[error("vault root is not a directory: {0}")]
    RootNotDir(Utf8PathBuf),
    #[error("path escapes the vault root: {0}")]
    OutsideVault(Utf8PathBuf),
    #[error("non-UTF8 path encountered: {0}")]
    NonUtf8Path(String),
    #[error("io error reading {path}: {source}")]
    Io {
        path: Utf8PathBuf,
        #[source]
        source: std::io::Error,
    },
}

/// Trust state of a note, read from `status:` frontmatter.
///
/// This is not decoration. Verification is a human act, and the index ranks
/// [`VerifyStatus::Verified`] notes above unverified ones when retrieving
/// context for agents. Anything an agent writes must land as `Unverified`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifyStatus {
    /// `status: verified` — reviewed by a human.
    Verified,
    /// `status: unverified` — explicitly marked as a draft.
    Unverified,
    /// No `status:` key. Hand-written notes that predate the convention.
    #[default]
    Unknown,
}

impl VerifyStatus {
    /// Retrieval weight. Used by the index to rank context for agent runs.
    pub fn weight(self) -> f32 {
        match self {
            VerifyStatus::Verified => 1.0,
            VerifyStatus::Unknown => 0.6,
            VerifyStatus::Unverified => 0.3,
        }
    }
}

/// A resolved wikilink.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct NoteLink {
    /// Link target as written, e.g. `00 Implementation Plan` or `Note#Heading`.
    pub target: String,
    /// Display alias from `[[target|alias]]`.
    pub alias: Option<String>,
}

/// A single note, parsed.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Note {
    /// Path relative to the vault root, forward-slashed.
    pub path: Utf8PathBuf,
    pub title: String,
    pub status: VerifyStatus,
    /// `generated_by:` frontmatter, e.g. `claude` or `hermes`.
    pub generated_by: Option<String>,
    /// Frontmatter tags and inline `#tags`, deduplicated, `#` stripped.
    pub tags: Vec<String>,
    pub links: Vec<NoteLink>,
    pub embeds: Vec<String>,
    pub headings: Vec<String>,
    pub tasks_total: usize,
    pub tasks_done: usize,
    pub word_count: usize,
}

/// A vault rooted at a directory of markdown files.
#[derive(Debug, Clone)]
pub struct Vault {
    root: Utf8PathBuf,
}

/// Directory names never treated as vault content.
const EXCLUDED_DIRS: &[&str] = &["node_modules", "target", ".git", ".obsidian", ".axonix"];

impl Vault {
    pub fn open(root: impl AsRef<Utf8Path>) -> Result<Self, VaultError> {
        let root = root.as_ref().to_path_buf();
        if !root.exists() {
            return Err(VaultError::RootMissing(root));
        }
        if !root.is_dir() {
            return Err(VaultError::RootNotDir(root));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Utf8Path {
        &self.root
    }

    /// Relative paths of every file that counts as vault content, any extension.
    ///
    /// Skips hidden directories, known build/tooling directories, and — importantly —
    /// **any directory containing a `.git`**. The Axonix repo lives inside this vault,
    /// and its `README.md` is not a note.
    pub fn all_paths(&self) -> Result<Vec<Utf8PathBuf>, VaultError> {
        let mut out = Vec::new();
        let walker = WalkDir::new(&self.root)
            .into_iter()
            .filter_entry(|e| !is_excluded_dir(e));

        for entry in walker {
            let entry = entry.map_err(|e| VaultError::Io {
                path: self.root.clone(),
                source: e.into(),
            })?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = Utf8Path::from_path(entry.path())
                .ok_or_else(|| VaultError::NonUtf8Path(entry.path().display().to_string()))?;
            let rel = path
                .strip_prefix(&self.root)
                .map_err(|_| VaultError::OutsideVault(path.to_path_buf()))?;
            out.push(normalize(rel));
        }
        out.sort();
        Ok(out)
    }

    /// Relative paths of markdown notes.
    pub fn note_paths(&self) -> Result<Vec<Utf8PathBuf>, VaultError> {
        Ok(self
            .all_paths()?
            .into_iter()
            .filter(|p| p.extension() == Some("md"))
            .collect())
    }

    /// Relative paths of non-markdown files — images, PDFs, video.
    ///
    /// These are legitimate wikilink targets: `[[04 Profile - Annotated]]` may point
    /// at a `.png`. Link resolution must consider these, not just notes.
    pub fn asset_paths(&self) -> Result<Vec<Utf8PathBuf>, VaultError> {
        Ok(self
            .all_paths()?
            .into_iter()
            .filter(|p| p.extension() != Some("md"))
            .collect())
    }

    /// Absolute path for a vault-relative path.
    pub fn abs(&self, rel: impl AsRef<Utf8Path>) -> Utf8PathBuf {
        self.root.join(rel.as_ref())
    }

    /// Read and parse a single note by vault-relative path.
    pub fn read_note(&self, rel: impl AsRef<Utf8Path>) -> Result<Note, VaultError> {
        Ok(self.read_note_with_content(rel)?.0)
    }

    /// Read and parse a note, also returning its raw content.
    ///
    /// The indexer needs the body text for full-text search; this avoids reading
    /// every file twice.
    pub fn read_note_with_content(
        &self,
        rel: impl AsRef<Utf8Path>,
    ) -> Result<(Note, String), VaultError> {
        let rel = rel.as_ref();
        let abs = self.root.join(rel);
        let content = std::fs::read_to_string(&abs).map_err(|source| VaultError::Io {
            path: abs.clone(),
            source,
        })?;
        let note = parse_note(normalize(rel), &content);
        Ok((note, content))
    }

    /// Write a note as an unverified AI draft, creating parent directories.
    ///
    /// Returns the vault-relative path written. Rejects paths that escape the
    /// vault root — callers include an HTTP server reachable from a browser
    /// extension, so this is a boundary, not a convenience.
    pub fn write_draft(
        &self,
        rel: impl AsRef<Utf8Path>,
        title: &str,
        agent: &str,
        created: &str,
        tags: &[String],
        body: &str,
    ) -> Result<Utf8PathBuf, VaultError> {
        let rel = self.checked_rel(rel.as_ref())?;
        let abs = self.root.join(&rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).map_err(|source| VaultError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        let doc = draft_note(title, agent, created, tags, body);
        std::fs::write(&abs, doc).map_err(|source| VaultError::Io {
            path: abs.clone(),
            source,
        })?;
        Ok(rel)
    }

    /// Validate a caller-supplied relative path.
    ///
    /// Rejects absolute paths, drive letters and `..` components. Appends `.md`.
    pub fn checked_rel(&self, raw: impl AsRef<Utf8Path>) -> Result<Utf8PathBuf, VaultError> {
        let cleaned = raw.as_ref().as_str().trim().replace('\\', "/");
        if cleaned.is_empty() {
            return Err(VaultError::OutsideVault(Utf8PathBuf::from(cleaned)));
        }
        let p = Utf8Path::new(&cleaned);
        if p.is_absolute() || cleaned.starts_with('/') || cleaned.contains(':') {
            return Err(VaultError::OutsideVault(p.to_path_buf()));
        }
        if p.components()
            .any(|c| matches!(c, camino::Utf8Component::ParentDir))
        {
            return Err(VaultError::OutsideVault(p.to_path_buf()));
        }
        let mut out = Utf8PathBuf::from(cleaned);
        if out.extension() != Some("md") {
            out.set_extension("md");
        }
        Ok(out)
    }

    /// Filesystem mtime as seconds since the epoch, for change detection.
    pub fn mtime(&self, rel: impl AsRef<Utf8Path>) -> Result<i64, VaultError> {
        let abs = self.root.join(rel.as_ref());
        let meta = std::fs::metadata(&abs).map_err(|source| VaultError::Io {
            path: abs.clone(),
            source,
        })?;
        let secs = meta
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);
        Ok(secs)
    }

    /// Parse every note in the vault.
    pub fn scan(&self) -> Result<Vec<Note>, VaultError> {
        self.note_paths()?
            .into_iter()
            .map(|p| self.read_note(&p))
            .collect()
    }
}

/// Render a note as an unverified AI draft.
///
/// **This is the single place the draft invariant is implemented.** Both the MCP
/// server and the capture server go through it, so there is no second code path
/// that could drift and emit a note claiming to be verified. There is deliberately
/// no `status` parameter.
///
/// Tags are written as a YAML list with no `#` prefix. Inline flow arrays like
/// `tags: [#a, #b]` are invalid YAML — a `#` after whitespace opens a comment, the
/// bracket never closes, and the whole block silently fails to parse, taking
/// `status` with it. Real notes in this vault hit that.
pub fn draft_note(title: &str, agent: &str, created: &str, tags: &[String], body: &str) -> String {
    let mut s = String::from("---\ncssclasses:\n  - ai-draft\ntags:\n  - ai-draft\n");
    for t in tags {
        let t = t.trim().trim_start_matches('#');
        if !t.is_empty() && t != "ai-draft" {
            s.push_str(&format!("  - {}\n", yaml_scalar(t)));
        }
    }
    s.push_str(&format!(
        "title: {}\ngenerated_by: {}\ncreated: {}\nstatus: unverified\n---\n\n",
        yaml_scalar(title),
        yaml_scalar(agent),
        created
    ));
    s.push_str(&format!(
        "> [!warning] AI DRAFT — unverified\n> Generated by {agent}. Review and verify before trusting.\n\n"
    ));
    s.push_str(body.trim_end());
    s.push('\n');
    s
}

/// Quote a YAML scalar when it would otherwise be misparsed.
fn yaml_scalar(v: &str) -> String {
    let needs_quotes = v.is_empty()
        || v.starts_with(['#', '-', '*', '&', '!', '[', '{', '>', '|', '\'', '"', '%', '@', '`'])
        || v.contains(": ")
        || v.ends_with(':')
        || v.contains('\n');
    if needs_quotes {
        format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        v.to_owned()
    }
}

/// Parse note content that has already been read from disk.
///
/// Split out from [`Vault::read_note`] so it can be tested without touching the
/// filesystem, and reused by the file watcher which already holds the content.
pub fn parse_note(path: Utf8PathBuf, content: &str) -> Note {
    let parsed = ParsedContent::parse(content);
    let fm = parsed.frontmatter.as_ref();

    // Fallback for frontmatter that is not valid YAML. Hermes writes tags as
    // `tags: [#a, #b]`; in YAML a `#` preceded by whitespace opens a comment, so
    // the flow sequence never closes and the whole block fails to parse. Falling
    // back to Unknown would be the dangerous direction — an unverified AI draft
    // would rank *above* where it belongs — so scan the raw block instead.
    let lenient = if fm.is_none() {
        lenient_frontmatter(content)
    } else {
        Default::default()
    };
    let field = |key: &str| -> Option<String> {
        fm.and_then(|f| f.data.get(key))
            .and_then(|v| v.as_str())
            .map(str::to_owned)
            .or_else(|| lenient.get(key).cloned())
    };

    let status = match field("status").as_deref() {
        Some("verified") => VerifyStatus::Verified,
        Some("unverified") => VerifyStatus::Unverified,
        _ => VerifyStatus::Unknown,
    };

    let generated_by = field("generated_by");

    let title = field("title").unwrap_or_else(|| {
        path.file_stem().unwrap_or("untitled").to_owned()
    });

    // Frontmatter tags and inline #tags, deduplicated, order-stable.
    let mut tags: Vec<String> = Vec::new();
    let mut push_tag = |t: String| {
        let t = t.trim_start_matches('#').to_owned();
        if !t.is_empty() && !tags.contains(&t) {
            tags.push(t);
        }
    };
    if let Some(f) = fm {
        for t in f.tags() {
            push_tag(t);
        }
    } else if let Some(raw) = lenient.get("tags") {
        for t in raw
            .trim_matches(|c| c == '[' || c == ']')
            .split(',')
            .map(str::trim)
        {
            push_tag(t.to_owned());
        }
    }
    for t in &parsed.tags {
        push_tag(t.name.clone());
    }

    let links = parsed
        .wikilinks
        .iter()
        .map(|l| NoteLink {
            target: clean_target(&l.target),
            alias: l.display_text.clone(),
        })
        .collect();

    let embeds = parsed
        .embeds
        .iter()
        .map(|e| clean_target(&e.target))
        .collect();
    let headings = parsed.headings.iter().map(|h| h.text.clone()).collect();

    let tasks_total = parsed.tasks.len();
    let tasks_done = parsed.tasks.iter().filter(|t| t.is_completed).count();

    Note {
        path,
        title,
        status,
        generated_by,
        tags,
        links,
        embeds,
        headings,
        tasks_total,
        tasks_done,
        word_count: content.split_whitespace().count(),
    }
}

fn normalize(p: &Utf8Path) -> Utf8PathBuf {
    Utf8PathBuf::from(p.as_str().replace('\\', "/"))
}

/// Scan a frontmatter block line by line, ignoring YAML validity.
///
/// Only used when proper YAML parsing has already failed. Handles top-level
/// `key: value` scalars, which covers `status`, `generated_by` and `title` —
/// the fields the trust model depends on. Nested structures are not attempted.
fn lenient_frontmatter(content: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();

    let Some(rest) = content.strip_prefix("---") else {
        return out;
    };
    let rest = match rest.strip_prefix("\r\n").or_else(|| rest.strip_prefix('\n')) {
        Some(r) => r,
        None => return out,
    };
    // Closing delimiter must be a line of its own.
    let Some(end) = rest
        .match_indices("---")
        .find(|(i, _)| *i == 0 || rest[..*i].ends_with('\n'))
        .map(|(i, _)| i)
    else {
        return out;
    };

    for line in rest[..end].lines() {
        if line.starts_with(char::is_whitespace) || line.trim().starts_with('-') {
            continue;
        }
        let Some((k, v)) = line.split_once(':') else {
            continue;
        };
        let v = v.trim().trim_matches('"').trim_matches('\'').trim();
        if !v.is_empty() {
            out.insert(k.trim().to_owned(), v.to_owned());
        }
    }
    out
}

/// Clean a wikilink target as emitted by the parser.
///
/// Inside a markdown table the alias pipe must be escaped — `[[Note\|Alias]]` — because
/// a bare `|` would end the table cell. `turbovault-parser` splits on the pipe correctly
/// but leaves the backslash attached to the target, yielding `Note\`. Real occurrences
/// of this exist in the vault (`00 ACL PCL Zig.md`), so strip it here rather than letting
/// every downstream link lookup fail.
fn clean_target(raw: &str) -> String {
    raw.trim().trim_end_matches('\\').trim().to_owned()
}

fn is_excluded_dir(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 || !entry.file_type().is_dir() {
        return false;
    }
    let name = entry.file_name().to_string_lossy();
    if name.starts_with('.') || EXCLUDED_DIRS.contains(&name.as_ref()) {
        return true;
    }
    // A nested git repository is not vault content.
    entry.path().join(".git").exists()
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const VERIFIED: &str = r#"---
cssclasses:
  - human-verified
tags:
  - axonix
  - research
status: verified
generated_by: claude
---

> [!human-verified] verified

# Foundations

Links to [[00 Implementation Plan]] and [[01 Decision Log|the log]].
Also embeds ![[diagram.png]] and tags #axonix/research inline.

- [x] done thing
- [ ] pending thing
"#;

    const DRAFT: &str = r#"---
tags: [ai-draft]
status: unverified
generated_by: hermes
---

# Draft
"#;

    fn note(src: &str) -> Note {
        parse_note(Utf8PathBuf::from("Projects/Test Note.md"), src)
    }

    #[test]
    fn reads_verified_status_and_author() {
        let n = note(VERIFIED);
        assert_eq!(n.status, VerifyStatus::Verified);
        assert_eq!(n.generated_by.as_deref(), Some("claude"));
    }

    #[test]
    fn reads_unverified_status() {
        assert_eq!(note(DRAFT).status, VerifyStatus::Unverified);
    }

    #[test]
    fn missing_status_is_unknown_not_unverified() {
        // Hand-written notes predate the convention. Treating them as unverified
        // would wrongly demote them in retrieval.
        let n = note("# Plain\n\nno frontmatter here\n");
        assert_eq!(n.status, VerifyStatus::Unknown);
    }

    #[test]
    fn verified_outranks_unknown_outranks_unverified() {
        assert!(VerifyStatus::Verified.weight() > VerifyStatus::Unknown.weight());
        assert!(VerifyStatus::Unknown.weight() > VerifyStatus::Unverified.weight());
    }

    #[test]
    fn title_falls_back_to_filename() {
        assert_eq!(note(DRAFT).title, "Test Note");
    }

    #[test]
    fn extracts_wikilinks_with_alias() {
        let n = note(VERIFIED);
        assert!(n.links.iter().any(|l| l.target == "00 Implementation Plan"));
        let aliased = n
            .links
            .iter()
            .find(|l| l.target == "01 Decision Log")
            .expect("aliased link missing");
        assert_eq!(aliased.alias.as_deref(), Some("the log"));
    }

    #[test]
    fn recovers_status_from_yaml_invalid_frontmatter() {
        // Verbatim from `Projects/LinkedIn Outreach/Outreach Templates.md`, written
        // by Hermes. `tags: [#a, #b]` is not valid YAML — a `#` after whitespace
        // opens a comment, the flow sequence never closes, the block fails to parse.
        // Falling back to Unknown would rank an unverified draft ABOVE where it
        // belongs, so the raw block is scanned instead.
        let src = "---\ncssclasses: [ai-draft]\ntags: [#ai-draft, #linkedin, #outreach]\n\
                   generated_by: hermes\nstatus: unverified\n---\n\n# Templates\n";
        let n = parse_note(Utf8PathBuf::from("Outreach Templates.md"), src);
        assert_eq!(n.status, VerifyStatus::Unverified, "status must survive bad YAML");
        assert_eq!(n.generated_by.as_deref(), Some("hermes"));
        assert!(n.tags.iter().any(|t| t == "ai-draft"));
        assert!(n.tags.iter().all(|t| !t.starts_with('#')));
    }

    #[test]
    fn lenient_fallback_does_not_fire_on_valid_yaml() {
        // Valid YAML must go through the real parser, not the line scanner.
        let n = note(VERIFIED);
        assert_eq!(n.status, VerifyStatus::Verified);
        assert_eq!(n.generated_by.as_deref(), Some("claude"));
    }

    #[test]
    fn strips_escaped_pipe_backslash_from_table_wikilinks() {
        // Real case from `00 ACL PCL Zig.md`: inside a markdown table the alias pipe
        // must be escaped or it ends the cell. turbovault-parser leaves the backslash
        // on the target, which would break every link lookup.
        let src = "| [[02 Reference - Handle Front\\|02-03 Reference photos]] | traced from |\n";
        let n = parse_note(Utf8PathBuf::from("t.md"), src);
        let l = n.links.first().expect("no link parsed");
        assert_eq!(l.target, "02 Reference - Handle Front");
        assert!(!l.target.ends_with('\\'));
    }

    #[test]
    fn embeds_are_separate_from_links() {
        let n = note(VERIFIED);
        assert!(n.embeds.iter().any(|e| e == "diagram.png"));
        assert!(!n.links.iter().any(|l| l.target == "diagram.png"));
    }

    #[test]
    fn merges_frontmatter_and_inline_tags_without_hashes() {
        let n = note(VERIFIED);
        assert!(n.tags.contains(&"axonix".to_string()));
        assert!(n.tags.contains(&"research".to_string()));
        assert!(n.tags.iter().any(|t| t.starts_with("axonix/")));
        assert!(n.tags.iter().all(|t| !t.starts_with('#')));
    }

    #[test]
    fn counts_tasks() {
        let n = note(VERIFIED);
        assert_eq!(n.tasks_total, 2);
        assert_eq!(n.tasks_done, 1);
    }

    #[test]
    fn draft_note_carries_extra_tags_without_hashes() {
        let tags = vec!["capture".into(), "#already-hashed".into(), "ai-draft".into()];
        let doc = draft_note("T", "a", "2026-08-16", &tags, "body");
        let n = parse_note(Utf8PathBuf::from("x.md"), &doc);
        assert!(n.tags.contains(&"capture".to_string()));
        assert!(n.tags.contains(&"already-hashed".to_string()));
        // ai-draft is emitted once, not duplicated by a caller passing it again.
        assert_eq!(n.tags.iter().filter(|t| *t == "ai-draft").count(), 1);
        assert_eq!(n.status, VerifyStatus::Unverified);
    }

    #[test]
    fn draft_note_is_always_unverified_and_round_trips() {
        let doc = draft_note("Some Page", "hermes", "2026-08-16", &[], "# Body\n\ntext");
        assert!(doc.contains("status: unverified"));
        assert!(!doc.contains("status: verified"));
        // Must parse back as unverified — i.e. the YAML we emit is actually valid.
        let n = parse_note(Utf8PathBuf::from("x.md"), &doc);
        assert_eq!(n.status, VerifyStatus::Unverified);
        assert_eq!(n.title, "Some Page");
        assert_eq!(n.generated_by.as_deref(), Some("hermes"));
        assert!(n.tags.contains(&"ai-draft".to_string()));
    }

    #[test]
    fn draft_note_survives_hostile_titles() {
        // Page titles come from the open web. A title containing YAML syntax must
        // not be able to break the frontmatter block or inject keys.
        for title in [
            "Nasty: colon",
            "#hash start",
            "- dash start",
            "\"quoted\"",
            "status: verified",
            "[bracket]",
        ] {
            let doc = draft_note(title, "hermes", "2026-08-16", &[], "body");
            let n = parse_note(Utf8PathBuf::from("x.md"), &doc);
            assert_eq!(
                n.status,
                VerifyStatus::Unverified,
                "title {title:?} broke the frontmatter"
            );
            assert_eq!(n.title, title, "title {title:?} did not round-trip");
        }
    }

    #[test]
    fn write_draft_rejects_path_traversal() {
        let tmp = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(tmp.path()).unwrap().to_path_buf();
        let v = Vault::open(&root).unwrap();
        for bad in ["../escape", "/abs/path", "C:/windows/system32", "a/../../b"] {
            assert!(
                v.write_draft(bad, "t", "a", "2026-08-16", &[], "b").is_err(),
                "accepted traversal path {bad:?}"
            );
        }
        let ok = v
            .write_draft("Captures/Page", "t", "hermes", "2026-08-16", &[], "b")
            .unwrap();
        assert_eq!(ok.as_str(), "Captures/Page.md");
        assert!(root.join("Captures/Page.md").exists());
    }

    #[test]
    fn scan_skips_hidden_dirs_and_nested_repos() {
        let tmp = tempfile::tempdir().unwrap();
        let root = Utf8Path::from_path(tmp.path()).unwrap().to_path_buf();

        std::fs::write(root.join("Real.md"), "# Real").unwrap();

        std::fs::create_dir_all(root.join(".obsidian")).unwrap();
        std::fs::write(root.join(".obsidian/config.md"), "# nope").unwrap();

        // A nested repo — the Axonix repo lives inside the vault.
        let repo = root.join("AXONIX");
        std::fs::create_dir_all(repo.join(".git")).unwrap();
        std::fs::write(repo.join("README.md"), "# not a note").unwrap();

        let paths = Vault::open(&root).unwrap().note_paths().unwrap();
        assert_eq!(paths, vec![Utf8PathBuf::from("Real.md")]);
    }
}
