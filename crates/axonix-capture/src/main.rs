//! Axonix capture server.
//!
//!     axonix-capture <vault-root> [--port 8787] [--no-agent]
//!
//! Binds to 127.0.0.1 only. Prints the bearer token the extension needs.

use std::sync::Arc;

use axonix_agent::{HermesBackend, HermesConfig};
use axonix_capture::{
    AppState, MAX_BODY_BYTES, Shared, ask, clip, health, notes, open_note, random_token, runs,
    search, session_finish, session_start, session_visit, token_path,
};
use axonix_index::Index;
use axonix_vault::Vault;
use axum::Router;
use axum::routing::{get, post};
use camino::Utf8PathBuf;
use tokio::sync::Mutex;
use tower_http::cors::{Any, CorsLayer};
use tower_http::limit::RequestBodyLimitLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "axonix_capture=info".into()),
        )
        .init();

    let mut args = std::env::args().skip(1);
    let root: Utf8PathBuf = args
        .next()
        .or_else(|| std::env::var("AXONIX_VAULT").ok())
        .ok_or_else(|| anyhow::anyhow!("usage: axonix-capture <vault-root> [--port N] [--no-agent]"))?
        .into();

    let rest: Vec<String> = args.collect();
    let port: u16 = rest
        .iter()
        .position(|a| a == "--port")
        .and_then(|i| rest.get(i + 1))
        .and_then(|s| s.parse().ok())
        .unwrap_or(8787);
    let no_agent = rest.iter().any(|a| a == "--no-agent");

    let vault = Vault::open(&root)?;
    let mut index = Index::open(Index::default_path(vault.root()))?;
    index.sync(&vault)?;

    let agent = if no_agent {
        None
    } else {
        HermesBackend::discover().map(|binary| {
            Arc::new(HermesBackend::new(HermesConfig {
                binary,
                max_turns: Some(12),
                timeout: std::time::Duration::from_secs(600),
                ..Default::default()
            }))
        })
    };

    // Reuse a stored token so the extension does not need reconfiguring on restart.
    let tp = token_path();
    let token = match std::fs::read_to_string(tp.as_std_path()) {
        Ok(t) if t.trim().len() == 64 => t.trim().to_owned(),
        _ => {
            let t = random_token();
            if let Some(p) = tp.parent() {
                let _ = std::fs::create_dir_all(p.as_std_path());
            }
            std::fs::write(tp.as_std_path(), &t)?;
            t
        }
    };

    let state: Shared = Arc::new(AppState {
        vault: Arc::new(vault),
        index: Arc::new(Mutex::new(index)),
        agent,
        token: token.clone(),
        sessions: Mutex::new(Default::default()),
        capture_dir: std::env::var("AXONIX_CAPTURE_DIR").unwrap_or_else(|_| "Captures".into()),
        runs: Mutex::new(Vec::new()),
    });

    // The extension origin is chrome-extension://<id>, which is not known until
    // the extension is loaded. Auth is the bearer token, not the origin; CORS is
    // permissive because the listener is loopback-only and token-gated.
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_headers(Any)
        .allow_methods(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/notes", get(notes))
        .route("/search", get(search))
        .route("/open", post(open_note))
        .route("/agent/ask", post(ask))
        .route("/agent/runs", get(runs))
        .route("/clip", post(clip))
        .route("/session/start", post(session_start))
        .route("/session/visit", post(session_visit))
        .route("/session/finish", post(session_finish))
        .layer(RequestBodyLimitLayer::new(MAX_BODY_BYTES))
        .layer(cors)
        // Without this there is no way to tell "the client never called" from
        // "the call failed" — which cost real time diagnosing the packaged build.
        .layer(
            tower_http::trace::TraceLayer::new_for_http()
                .make_span_with(|r: &axum::http::Request<_>| {
                    tracing::info_span!("req", method = %r.method(), path = %r.uri().path())
                })
                .on_response(
                    |res: &axum::http::Response<_>, latency: std::time::Duration, _: &tracing::Span| {
                        tracing::info!(status = res.status().as_u16(), ?latency, "handled");
                    },
                ),
        )
        .with_state(state.clone());

    // Loopback only. Never 0.0.0.0 — this writes to the vault.
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;

    println!("axonix-capture listening on http://{addr}");
    println!("vault : {}", state.vault.root());
    println!("agent : {}", if state.agent.is_some() { "hermes" } else { "disabled" });
    println!("token : {token}");
    println!("        (also at {tp})");

    axum::serve(listener, app).await?;
    Ok(())
}
