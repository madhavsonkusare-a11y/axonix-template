//! Sync the index from a real vault and run a search.
//!
//!     cargo run -p axonix-index --example search -- "D:/05 Notes/My Vault" venturi

use axonix_index::Index;
use axonix_vault::{Vault, VerifyStatus};
use camino::Utf8PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args().skip(1);
    let root: Utf8PathBuf = args.next().ok_or("usage: search <vault-root> [query...]")?.into();
    let query: String = args.collect::<Vec<_>>().join(" ");

    let vault = Vault::open(&root)?;
    let db = Index::default_path(vault.root());
    println!("index db: {db}");
    let mut index = Index::open(&db)?;

    let t0 = std::time::Instant::now();
    let report = index.sync(&vault)?;
    let elapsed = t0.elapsed();

    println!(
        "sync: +{} ~{} -{} ={}  in {:?}",
        report.added, report.updated, report.removed, report.unchanged, elapsed
    );

    let s = index.stats()?;
    println!(
        "index: {} notes ({} verified, {} unverified, {} no status) · {} links · {} tags\n",
        s.notes, s.verified, s.unverified, s.unknown, s.links, s.tags
    );

    if query.trim().is_empty() {
        println!("(no query given)");
        return Ok(());
    }

    let hits = index.search(&query, 10)?;
    println!("search {query:?} → {} hits\n", hits.len());
    for h in &hits {
        let badge = match h.status {
            VerifyStatus::Verified => "[verified]  ",
            VerifyStatus::Unverified => "[unverified]",
            VerifyStatus::Unknown => "[-]         ",
        };
        println!("{badge} {:>7.2}  {}", h.score, h.title);
        println!("             {}", h.path);
        if !h.snippet.is_empty() {
            println!("             {}", h.snippet.replace('\n', " "));
        }
        println!();
    }
    Ok(())
}
