//! Scan a real vault and print what the parser found.
//!
//!     cargo run -p axonix-vault --example scan -- "D:/05 Notes/My Vault"

use axonix_vault::{Vault, VerifyStatus};
use camino::Utf8PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root: Utf8PathBuf = std::env::args()
        .nth(1)
        .ok_or("usage: scan <vault-root>")?
        .into();

    let vault = Vault::open(&root)?;
    let notes = vault.scan()?;

    println!("vault : {}", vault.root());
    println!("notes : {}\n", notes.len());

    let (mut v, mut u, mut k) = (0, 0, 0);
    let (mut links, mut tasks, mut done, mut words) = (0usize, 0usize, 0usize, 0usize);

    for n in &notes {
        match n.status {
            VerifyStatus::Verified => v += 1,
            VerifyStatus::Unverified => u += 1,
            VerifyStatus::Unknown => k += 1,
        }
        links += n.links.len();
        tasks += n.tasks_total;
        done += n.tasks_done;
        words += n.word_count;
    }

    println!("{:<52} {:<11} {:>6} {:>6}", "NOTE", "STATUS", "LINKS", "WORDS");
    println!("{}", "-".repeat(78));
    for n in &notes {
        let status = match n.status {
            VerifyStatus::Verified => "verified",
            VerifyStatus::Unverified => "unverified",
            VerifyStatus::Unknown => "-",
        };
        let p = n.path.as_str();
        let shown = if p.len() > 50 { &p[p.len() - 50..] } else { p };
        println!(
            "{:<52} {:<11} {:>6} {:>6}",
            shown,
            status,
            n.links.len(),
            n.word_count
        );
    }

    println!("\n{}", "-".repeat(78));
    println!("verified {v}  ·  unverified {u}  ·  no status {k}");
    println!("links {links}  ·  tasks {done}/{tasks}  ·  words {words}");

    // Broken-link check. Wikilinks may target assets too — `[[04 Profile - Annotated]]`
    // points at a .png — so resolve against every file, not just notes.
    let all = vault.all_paths()?;
    let stems: std::collections::HashSet<&str> =
        all.iter().filter_map(|p| p.file_stem()).collect();
    let mut broken = Vec::new();
    for n in &notes {
        for l in &n.links {
            let target = l.target.split(['#', '^']).next().unwrap_or(&l.target).trim();
            if !target.is_empty() && !stems.contains(target) {
                broken.push((n.path.as_str(), target.to_string()));
            }
        }
    }
    if broken.is_empty() {
        println!("no broken wikilinks");
    } else {
        println!("\nbroken wikilinks ({}):", broken.len());
        for (from, target) in broken.iter().take(20) {
            println!("  {from}  ->  [[{target}]]");
        }
    }

    Ok(())
}
