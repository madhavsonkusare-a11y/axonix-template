//! Run one Hermes prompt from Rust.
//!
//!     cargo run -p axonix-agent --example run -- "your prompt here"
//!
//! Costs API credits. `--max-turns` is capped low on purpose.

use axonix_agent::{AgentBackend, HermesBackend, HermesConfig};
use std::time::Duration;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber_init();

    let prompt: String = std::env::args().skip(1).collect::<Vec<_>>().join(" ");
    let prompt = if prompt.trim().is_empty() {
        "Use the axonix vault_stats tool and report the numbers in one line.".to_string()
    } else {
        prompt
    };

    let binary = HermesBackend::discover().ok_or("hermes not found in LOCALAPPDATA")?;
    println!("binary : {binary}");
    println!("prompt : {prompt}\n");

    let backend = HermesBackend::new(HermesConfig {
        binary,
        max_turns: Some(3),
        reasoning: Some("low".into()),
        timeout: Duration::from_secs(180),
        ..Default::default()
    });

    let run = backend.run(&prompt).await?;

    println!("--- outcome ---");
    println!("{:?} in {:.1}s (exit {:?})", run.outcome, run.duration_ms as f64 / 1000.0, run.exit_code);
    println!("\n--- output ---\n{}", run.output.trim());
    if !run.stderr.trim().is_empty() {
        println!("\n--- stderr ---\n{}", run.stderr.trim());
    }
    Ok(())
}

fn tracing_subscriber_init() {
    // Keep the example dependency-light; tracing output is not needed here.
}
