//! Axonix MCP server — the seam between the vault and Hermes.
//!
//! Runs standalone over stdio. Register it with Hermes and the vault becomes
//! readable and writable from `hermes chat` with no Axonix UI running at all.
//!
//! # The invariant that matters
//!
//! [`VaultServer::note_write`] **always** stamps AI-draft frontmatter with
//! `status: unverified`. There is deliberately no parameter to override it.
//! An agent cannot write a note that claims to be human-verified — verification
//! is a human act, and the index ranks on it.

use std::sync::Arc;

use axonix_index::Index;
use axonix_vault::{Vault, VerifyStatus};
use camino::Utf8PathBuf;
use rmcp::{
    ErrorData, ServiceExt,
    handler::server::wrapper::Parameters,
    schemars,
    transport::stdio,
};
use tokio::sync::Mutex;

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct SearchParams {
    /// Words to search for. Plain text; FTS operators are not interpreted.
    pub query: String,
    /// Maximum hits to return. Defaults to 10.
    pub limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct PathParams {
    /// Vault-relative path, e.g. `Projects/Project AXONIX/00 Implementation Plan.md`.
    pub path: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct WriteParams {
    /// Vault-relative path. `.md` is appended if missing.
    pub path: String,
    /// Markdown body. Do not include frontmatter — it is generated.
    pub content: String,
    /// Title for the note. Defaults to the filename.
    pub title: Option<String>,
    /// Which agent produced this, e.g. `hermes`. Recorded in `generated_by`.
    pub agent: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct AppendParams {
    pub path: String,
    /// Markdown appended to the end of the note.
    pub content: String,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct TreeParams {
    /// Optional path prefix filter, e.g. `Personal/`.
    pub prefix: Option<String>,
}

#[derive(Debug, serde::Deserialize, schemars::JsonSchema)]
pub struct BacklinkParams {
    /// Link target as authored, usually the note title without `.md`.
    pub target: String,
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct VaultServer {
    vault: Arc<Vault>,
    index: Arc<Mutex<Index>>,
}

#[rmcp::tool_router(server_handler)]
impl VaultServer {
    /// Full-text search across the vault. Verified notes rank above drafts.
    #[rmcp::tool(
        description = "Search the Axonix vault. Returns paths, titles, verification status and snippets, ranked with verified notes above unverified drafts."
    )]
    async fn vault_search(
        &self,
        Parameters(p): Parameters<SearchParams>,
    ) -> Result<String, ErrorData> {
        let limit = p.limit.unwrap_or(10).clamp(1, 50) as usize;
        self.sync().await?;
        let index = self.index.lock().await;
        let hits = index
            .search(&p.query, limit)
            .map_err(|e| internal("search failed", e))?;

        if hits.is_empty() {
            return Ok(format!("No matches for {:?}.", p.query));
        }
        let mut out = format!("{} result(s) for {:?}:\n\n", hits.len(), p.query);
        for h in hits {
            out.push_str(&format!(
                "- {} [{}] (score {:.2})\n  {}\n  {}\n",
                h.title,
                status_label(h.status),
                h.score,
                h.path,
                h.snippet.replace('\n', " ")
            ));
        }
        Ok(out)
    }

    /// Read a note's full content.
    #[rmcp::tool(
        description = "Read a note from the Axonix vault by its vault-relative path. Returns raw markdown including frontmatter."
    )]
    async fn note_read(&self, Parameters(p): Parameters<PathParams>) -> Result<String, ErrorData> {
        let rel = self.safe_rel(&p.path)?;
        let abs = self.vault.abs(&rel);
        std::fs::read_to_string(abs.as_std_path())
            .map_err(|e| invalid(format!("cannot read {rel}: {e}")))
    }

    /// Create or overwrite a note. Always written as an unverified AI draft.
    #[rmcp::tool(
        description = "Write a note into the Axonix vault. The note is ALWAYS stamped as an unverified AI draft; this cannot be overridden. Overwrites the file if it exists."
    )]
    async fn note_write(&self, Parameters(p): Parameters<WriteParams>) -> Result<String, ErrorData> {
        let rel = self.safe_rel(&p.path)?;
        let title = p
            .title
            .unwrap_or_else(|| rel.file_stem().unwrap_or("Untitled").to_owned());
        let agent = p.agent.unwrap_or_else(|| "hermes".into());
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();

        // Goes through the vault layer's single draft implementation — this crate
        // deliberately has no frontmatter builder of its own, so the "always
        // unverified" invariant cannot drift between here and the capture server.
        let path = self
            .vault
            .write_draft(&rel, &title, &agent, &today, &[], &p.content)
            .map_err(|e| invalid(e.to_string()))?;
        self.sync().await?;

        Ok(format!(
            "Wrote {path} as an unverified draft. Review it in Obsidian and set `status: verified` if it is correct."
        ))
    }

    /// Append to an existing note without touching its frontmatter.
    #[rmcp::tool(
        description = "Append markdown to the end of an existing note. Does not modify frontmatter or verification status."
    )]
    async fn note_append(
        &self,
        Parameters(p): Parameters<AppendParams>,
    ) -> Result<String, ErrorData> {
        let rel = self.safe_rel(&p.path)?;
        let abs = self.vault.abs(&rel);
        if !abs.exists() {
            return Err(invalid(format!("{rel} does not exist; use note_write")));
        }
        let mut existing =
            std::fs::read_to_string(abs.as_std_path()).map_err(|e| internal("cannot read", e))?;
        if !existing.ends_with('\n') {
            existing.push('\n');
        }
        existing.push('\n');
        existing.push_str(p.content.trim_end());
        existing.push('\n');
        std::fs::write(abs.as_std_path(), existing).map_err(|e| internal("cannot write", e))?;
        self.sync().await?;
        Ok(format!("Appended to {rel}."))
    }

    /// List notes, optionally under a path prefix.
    #[rmcp::tool(
        description = "List notes in the Axonix vault with their verification status. Optionally filter by path prefix."
    )]
    async fn vault_tree(&self, Parameters(p): Parameters<TreeParams>) -> Result<String, ErrorData> {
        self.sync().await?;
        let prefix = p.prefix.unwrap_or_default();
        let paths = self
            .vault
            .note_paths()
            .map_err(|e| internal("cannot list vault", e))?;

        let mut out = String::new();
        let mut n = 0;
        for path in paths {
            if !prefix.is_empty() && !path.as_str().starts_with(&prefix) {
                continue;
            }
            let status = self
                .vault
                .read_note(&path)
                .map(|nt| nt.status)
                .unwrap_or_default();
            out.push_str(&format!("- {} [{}]\n", path, status_label(status)));
            n += 1;
        }
        if n == 0 {
            return Ok(format!("No notes under {prefix:?}."));
        }
        Ok(format!("{n} note(s):\n\n{out}"))
    }

    /// Notes linking to a target.
    #[rmcp::tool(description = "Find notes that link to a given note title via [[wikilinks]].")]
    async fn backlinks(
        &self,
        Parameters(p): Parameters<BacklinkParams>,
    ) -> Result<String, ErrorData> {
        self.sync().await?;
        let index = self.index.lock().await;
        let back = index
            .backlinks(&p.target)
            .map_err(|e| internal("backlink lookup failed", e))?;
        if back.is_empty() {
            return Ok(format!("Nothing links to [[{}]].", p.target));
        }
        let list = back
            .iter()
            .map(|p| format!("- {p}"))
            .collect::<Vec<_>>()
            .join("\n");
        Ok(format!(
            "{} note(s) link to [[{}]]:\n\n{list}",
            back.len(),
            p.target
        ))
    }

    /// Vault statistics.
    #[rmcp::tool(
        description = "Summary statistics for the Axonix vault: note counts by verification status, links and tags."
    )]
    async fn vault_stats(&self) -> Result<String, ErrorData> {
        self.sync().await?;
        let index = self.index.lock().await;
        let s = index.stats().map_err(|e| internal("stats failed", e))?;
        Ok(format!(
            "Vault: {}\n{} notes — {} verified, {} unverified, {} without status\n{} links · {} distinct tags",
            self.vault.root(),
            s.notes,
            s.verified,
            s.unverified,
            s.unknown,
            s.links,
            s.tags
        ))
    }
}

impl VaultServer {
    fn new(vault: Vault, index: Index) -> Self {
        Self {
            vault: Arc::new(vault),
            index: Arc::new(Mutex::new(index)),
        }
    }

    async fn sync(&self) -> Result<(), ErrorData> {
        let mut index = self.index.lock().await;
        index
            .sync(&self.vault)
            .map_err(|e| internal("index sync failed", e))?;
        Ok(())
    }

    /// Validate an agent-supplied path.
    ///
    /// Agents write here, so this is a security boundary. The rules live in
    /// `axonix-vault::checked_rel` so the MCP server and the capture server cannot
    /// diverge on what counts as a safe path.
    fn safe_rel(&self, raw: &str) -> Result<Utf8PathBuf, ErrorData> {
        self.vault
            .checked_rel(raw)
            .map_err(|e| invalid(format!("{e}: {raw}")))
    }
}

// ---------------------------------------------------------------------------

fn status_label(s: VerifyStatus) -> &'static str {
    match s {
        VerifyStatus::Verified => "verified",
        VerifyStatus::Unverified => "unverified",
        VerifyStatus::Unknown => "no status",
    }
}

fn invalid(msg: impl Into<String>) -> ErrorData {
    ErrorData::invalid_params(msg.into(), None)
}

fn internal(ctx: &str, e: impl std::fmt::Display) -> ErrorData {
    ErrorData::internal_error(format!("{ctx}: {e}"), None)
}

// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // stdout is the MCP transport — logs must go to stderr or the protocol breaks.
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "axonix_mcp=info".into()),
        )
        .init();

    let root: Utf8PathBuf = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("AXONIX_VAULT").ok())
        .ok_or_else(|| anyhow::anyhow!("usage: axonix-mcp <vault-root>  (or set AXONIX_VAULT)"))?
        .into();

    let vault = Vault::open(&root)?;
    // Never inside the vault — see Index::default_path.
    let db = std::env::var("AXONIX_INDEX")
        .map(Utf8PathBuf::from)
        .unwrap_or_else(|_| Index::default_path(vault.root()));
    let mut index = Index::open(&db)?;
    let report = index.sync(&vault)?;
    tracing::info!(
        vault = %vault.root(),
        added = report.added,
        updated = report.updated,
        removed = report.removed,
        "axonix-mcp ready"
    );

    let service = VaultServer::new(vault, index).serve(stdio()).await?;
    service.waiting().await?;
    Ok(())
}
