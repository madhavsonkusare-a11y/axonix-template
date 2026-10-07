//! Agent layer — Axonix drives Hermes, it does not reimplement it.
//!
//! # The boundary
//!
//! Hermes is a third-party dependency under active development. **Nothing about
//! Hermes may leak past this crate**: no Hermes types, no CLI flags, no output
//! formats in any other crate's public API. Callers see [`AgentRun`] and talk to
//! the [`AgentBackend`] trait. If Hermes changes, or is replaced, only this file
//! changes.
//!
//! # Structure
//!
//! Argument construction ([`HermesBackend::build_args`]) is deliberately split
//! from process execution ([`run_process`]) so the former can be unit-tested
//! exhaustively without spawning an agent — running a real Hermes turn costs
//! money and takes tens of seconds, which is not something a test suite should do.

use std::process::Stdio;
use std::time::{Duration, Instant};

use camino::Utf8PathBuf;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, thiserror::Error)]
pub enum AgentError {
    #[error("agent binary not found: {0}")]
    BinaryMissing(Utf8PathBuf),
    #[error("failed to spawn agent: {0}")]
    Spawn(#[source] std::io::Error),
    #[error("agent timed out after {0:?}")]
    Timeout(Duration),
    #[error("agent exited with status {code}: {stderr}")]
    Failed { code: i32, stderr: String },
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// How a run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunOutcome {
    Completed,
    TimedOut,
    Failed,
}

/// The result of one agent invocation.
///
/// Deliberately backend-agnostic — there is no Hermes session type here.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentRun {
    pub id: String,
    pub prompt: String,
    pub outcome: RunOutcome,
    /// Everything the agent printed on stdout.
    pub output: String,
    pub stderr: String,
    pub started_at: String,
    pub duration_ms: u64,
    pub exit_code: Option<i32>,
    /// Backend session identifier, when the backend reports one.
    ///
    /// Hermes prints `session_id: <id>` on stderr. Captured so a run can later be
    /// resumed or cross-referenced from the agents dashboard — without which every
    /// run is an island.
    pub session_id: Option<String>,
}

impl AgentRun {
    /// Render as a vault session note body.
    ///
    /// Frontmatter is *not* included: notes are written through the vault layer,
    /// which owns the AI-draft stamping. This crate must not be able to produce a
    /// note that claims to be verified.
    pub fn to_markdown(&self) -> String {
        let status = match self.outcome {
            RunOutcome::Completed => "completed",
            RunOutcome::TimedOut => "timed out",
            RunOutcome::Failed => "failed",
        };
        let mut s = format!(
            "# Agent run {}\n\n{} · {} · {:.1}s\n\n## Prompt\n\n```\n{}\n```\n\n## Output\n\n{}\n",
            self.id,
            self.started_at,
            status,
            self.duration_ms as f64 / 1000.0,
            self.prompt.trim(),
            self.output.trim()
        );
        if !self.stderr.trim().is_empty() {
            s.push_str(&format!("\n## Diagnostics\n\n```\n{}\n```\n", self.stderr.trim()));
        }
        s
    }
}

/// Anything that can run a prompt and return a result.
pub trait AgentBackend: Send + Sync {
    fn run(
        &self,
        prompt: &str,
    ) -> impl std::future::Future<Output = Result<AgentRun, AgentError>> + Send;
}

// ---------------------------------------------------------------------------
// Hermes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct HermesConfig {
    /// Path to the `hermes` executable.
    pub binary: Utf8PathBuf,
    /// Model override, e.g. `anthropic/claude-sonnet-4`. `None` uses Hermes' default.
    pub model: Option<String>,
    /// Reasoning effort: none | minimal | low | medium | high | xhigh | max | ultra.
    pub reasoning: Option<String>,
    /// Hard cap on agent turns. **Always set this.** An unbounded agent loop with
    /// vault write access is not something to leave to chance.
    pub max_turns: Option<u32>,
    /// Working directory for the run.
    pub cwd: Option<Utf8PathBuf>,
    /// Wall-clock limit. The process is killed when it expires.
    pub timeout: Duration,
}

impl Default for HermesConfig {
    fn default() -> Self {
        Self {
            binary: Utf8PathBuf::from("hermes"),
            model: None,
            reasoning: None,
            max_turns: Some(10),
            cwd: None,
            timeout: Duration::from_secs(300),
        }
    }
}

pub struct HermesBackend {
    cfg: HermesConfig,
}

impl HermesBackend {
    pub fn new(cfg: HermesConfig) -> Self {
        Self { cfg }
    }

    /// The default Windows install location, if present.
    pub fn discover() -> Option<Utf8PathBuf> {
        let local = std::env::var("LOCALAPPDATA").ok()?;
        let p = Utf8PathBuf::from(local.replace('\\', "/"))
            .join("hermes/hermes-agent/venv/Scripts/hermes.exe");
        p.exists().then_some(p)
    }

    /// Build the argument vector for a prompt.
    ///
    /// `-q` is single-query mode and `-Q` is quiet mode, documented by Hermes as
    /// "for programmatic use: suppress banner, spinner, and tool previews".
    /// Without `-Q` the output is interleaved with UI chrome and is not parseable.
    pub fn build_args(&self, prompt: &str) -> Vec<String> {
        let mut a = vec![
            "chat".into(),
            "-q".into(),
            prompt.to_owned(),
            "-Q".into(),
        ];
        if let Some(m) = &self.cfg.model {
            a.push("-m".into());
            a.push(m.clone());
        }
        if let Some(r) = &self.cfg.reasoning {
            a.push("--reasoning".into());
            a.push(r.clone());
        }
        if let Some(t) = self.cfg.max_turns {
            a.push("--max-turns".into());
            a.push(t.to_string());
        }
        if let Some(d) = &self.cfg.cwd {
            a.push("--in".into());
            a.push(d.to_string());
        }
        a
    }
}

impl AgentBackend for HermesBackend {
    async fn run(&self, prompt: &str) -> Result<AgentRun, AgentError> {
        if self.cfg.binary.as_str().contains('/') && !self.cfg.binary.exists() {
            return Err(AgentError::BinaryMissing(self.cfg.binary.clone()));
        }
        let args = self.build_args(prompt);
        let out = run_process(
            self.cfg.binary.as_str(),
            &args,
            self.cfg.cwd.as_deref().map(|p| p.as_str()),
            self.cfg.timeout,
            |line| tracing::debug!(target: "axonix::agent", "{line}"),
        )
        .await?;

        Ok(AgentRun {
            id: run_id(),
            prompt: prompt.to_owned(),
            outcome: out.outcome,
            session_id: parse_session_id(&out.stderr),
            output: out.stdout,
            stderr: out.stderr,
            started_at: out.started_at,
            duration_ms: out.duration_ms,
            exit_code: out.exit_code,
        })
    }
}

/// Extract `session_id: <id>` from Hermes' stderr.
///
/// Kept private to this crate — the shape of Hermes' output must not become part
/// of any public API. Callers see `AgentRun::session_id`.
fn parse_session_id(stderr: &str) -> Option<String> {
    stderr.lines().find_map(|l| {
        l.trim()
            .strip_prefix("session_id:")
            .map(|v| v.trim().to_owned())
            .filter(|v| !v.is_empty())
    })
}

// ---------------------------------------------------------------------------
// Process running — generic, so tests can point it at a stub command
// ---------------------------------------------------------------------------

pub struct ProcessOutput {
    pub outcome: RunOutcome,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub started_at: String,
    pub duration_ms: u64,
}

/// Spawn a command, stream stdout line by line, and enforce a wall-clock timeout.
///
/// On timeout the child is killed rather than left running — an orphaned agent
/// process holding vault write access is worse than a failed run.
pub async fn run_process<F>(
    program: &str,
    args: &[String],
    cwd: Option<&str>,
    timeout: Duration,
    mut on_line: F,
) -> Result<ProcessOutput, AgentError>
where
    F: FnMut(&str) + Send,
{
    let started_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let t0 = Instant::now();

    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Required for the timeout path to actually terminate the agent. Without
        // this, `tokio::time::timeout` drops the future, we return TimedOut, and
        // the child keeps running — an orphaned agent process still holding vault
        // write access. Not optional.
        .kill_on_drop(true);
    if let Some(d) = cwd {
        cmd.current_dir(d);
    }
    #[cfg(windows)]
    {
        // Don't flash a console window when spawned from the GUI.
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }

    let mut child = cmd.spawn().map_err(AgentError::Spawn)?;
    let stdout = child.stdout.take().expect("stdout piped");
    let stderr = child.stderr.take().expect("stderr piped");

    let mut out_lines = BufReader::new(stdout).lines();
    let mut err_reader = BufReader::new(stderr).lines();

    let mut collected = String::new();
    let mut errs = String::new();

    let work = async {
        loop {
            tokio::select! {
                line = out_lines.next_line() => match line? {
                    Some(l) => { on_line(&l); collected.push_str(&l); collected.push('\n'); }
                    None => break,
                },
                line = err_reader.next_line() => {
                    if let Some(l) = line? { errs.push_str(&l); errs.push('\n'); }
                }
            }
        }
        // Drain anything left on stderr after stdout closed.
        while let Some(l) = err_reader.next_line().await? {
            errs.push_str(&l);
            errs.push('\n');
        }
        child.wait().await.map_err(AgentError::Io)
    };

    let status = match tokio::time::timeout(timeout, work).await {
        Ok(r) => Some(r?),
        Err(_) => None,
    };

    let duration_ms = t0.elapsed().as_millis() as u64;

    let (outcome, exit_code) = match status {
        None => (RunOutcome::TimedOut, None),
        Some(s) if s.success() => (RunOutcome::Completed, s.code()),
        Some(s) => (RunOutcome::Failed, s.code()),
    };

    Ok(ProcessOutput {
        outcome,
        stdout: collected,
        stderr: errs,
        exit_code,
        started_at,
        duration_ms,
    })
}

fn run_id() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M%S").to_string()
}

// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn backend(cfg: HermesConfig) -> HermesBackend {
        HermesBackend::new(cfg)
    }

    #[test]
    fn args_use_single_query_and_quiet_mode() {
        let b = backend(HermesConfig {
            max_turns: None,
            ..Default::default()
        });
        let a = b.build_args("hello world");
        assert_eq!(a, vec!["chat", "-q", "hello world", "-Q"]);
    }

    #[test]
    fn quiet_flag_is_always_present() {
        // Without -Q, Hermes interleaves banner and spinner output and the result
        // is not parseable. Any future edit that drops it must fail here.
        let b = backend(HermesConfig::default());
        assert!(b.build_args("x").contains(&"-Q".to_string()));
    }

    #[test]
    fn max_turns_defaults_to_bounded() {
        // An unbounded agent loop with vault write access is not acceptable.
        let b = backend(HermesConfig::default());
        let a = b.build_args("x");
        let i = a.iter().position(|s| s == "--max-turns").expect("no cap");
        assert_eq!(a[i + 1], "10");
    }

    #[test]
    fn prompt_is_a_single_argv_entry_not_shell_interpolated() {
        // The prompt is attacker-influenced in the research workflow. It must never
        // be concatenated into a shell string.
        let b = backend(HermesConfig::default());
        let nasty = "hi\" && rm -rf / && echo \"";
        let a = b.build_args(nasty);
        assert!(a.contains(&nasty.to_string()));
        assert_eq!(a.iter().filter(|s| s.contains("rm -rf")).count(), 1);
    }

    #[test]
    fn optional_flags_are_passed_through() {
        let b = backend(HermesConfig {
            model: Some("anthropic/claude-sonnet-4".into()),
            reasoning: Some("low".into()),
            cwd: Some(Utf8PathBuf::from("D:/vault")),
            ..Default::default()
        });
        let a = b.build_args("x");
        assert!(a.windows(2).any(|w| w[0] == "-m" && w[1] == "anthropic/claude-sonnet-4"));
        assert!(a.windows(2).any(|w| w[0] == "--reasoning" && w[1] == "low"));
        assert!(a.windows(2).any(|w| w[0] == "--in" && w[1] == "D:/vault"));
    }

    #[tokio::test]
    async fn run_process_captures_stdout_and_streams_lines() {
        let (prog, args) = stub(&["one", "two"]);
        let mut seen = Vec::new();
        let out = run_process(prog, &args, None, Duration::from_secs(30), |l| {
            seen.push(l.to_owned())
        })
        .await
        .unwrap();
        assert_eq!(out.outcome, RunOutcome::Completed);
        assert!(out.stdout.contains("one"));
        assert!(seen.iter().any(|l| l.contains("one")));
    }

    #[tokio::test]
    async fn run_process_reports_failure_exit_code() {
        let (prog, args) = fail_stub();
        let out = run_process(prog, &args, None, Duration::from_secs(30), |_| {})
            .await
            .unwrap();
        assert_eq!(out.outcome, RunOutcome::Failed);
        assert_eq!(out.exit_code, Some(3));
    }

    #[tokio::test]
    async fn run_process_times_out_and_kills_child() {
        let (prog, args) = sleep_stub(30);
        let wall = Instant::now();
        let out = run_process(prog, &args, None, Duration::from_millis(600), |_| {})
            .await
            .unwrap();
        assert_eq!(out.outcome, RunOutcome::TimedOut);
        assert!(out.duration_ms < 10_000, "did not abort promptly");
        // The child must actually be dead, not merely abandoned. Without
        // kill_on_drop the call returns fast but the process lingers for its full
        // 30s, which this whole-test wall-clock check catches.
        drop(out);
        assert!(
            wall.elapsed() < Duration::from_secs(10),
            "child outlived the timeout — kill_on_drop missing?"
        );
    }

    #[tokio::test]
    async fn missing_binary_is_reported_clearly() {
        let b = backend(HermesConfig {
            binary: Utf8PathBuf::from("./definitely/not/here.exe"),
            ..Default::default()
        });
        assert!(matches!(
            b.run("x").await,
            Err(AgentError::BinaryMissing(_))
        ));
    }

    #[test]
    fn parses_hermes_session_id_from_stderr() {
        // Verbatim shape observed from a real run.
        assert_eq!(
            parse_session_id("session_id: 20260816_185222_03ae48\n").as_deref(),
            Some("20260816_185222_03ae48")
        );
        assert_eq!(parse_session_id("no id here\n"), None);
        assert_eq!(parse_session_id("session_id:   \n"), None);
    }

    #[test]
    fn markdown_render_includes_prompt_and_output() {
        let r = AgentRun {
            id: "20260816-120000".into(),
            prompt: "summarise the vault".into(),
            outcome: RunOutcome::Completed,
            output: "done".into(),
            stderr: String::new(),
            started_at: "2026-08-16 12:00:00".into(),
            duration_ms: 1500,
            exit_code: Some(0),
            session_id: None,
        };
        let md = r.to_markdown();
        assert!(md.contains("summarise the vault"));
        assert!(md.contains("done"));
        assert!(md.contains("1.5s"));
        // Must not fabricate frontmatter — the vault layer owns that.
        assert!(!md.contains("status:"));
    }

    // --- platform stubs -------------------------------------------------

    #[cfg(windows)]
    fn stub(lines: &[&str]) -> (&'static str, Vec<String>) {
        let body = lines
            .iter()
            .map(|l| format!("echo {l}"))
            .collect::<Vec<_>>()
            .join(" & ");
        ("cmd", vec!["/C".into(), body])
    }
    #[cfg(not(windows))]
    fn stub(lines: &[&str]) -> (&'static str, Vec<String>) {
        let body = lines
            .iter()
            .map(|l| format!("echo {l}"))
            .collect::<Vec<_>>()
            .join("; ");
        ("sh", vec!["-c".into(), body])
    }

    #[cfg(windows)]
    fn fail_stub() -> (&'static str, Vec<String>) {
        ("cmd", vec!["/C".into(), "exit 3".into()])
    }
    #[cfg(not(windows))]
    fn fail_stub() -> (&'static str, Vec<String>) {
        ("sh", vec!["-c".into(), "exit 3".into()])
    }

    #[cfg(windows)]
    fn sleep_stub(secs: u32) -> (&'static str, Vec<String>) {
        // Invoked directly, NOT via `cmd /C`. Two reasons:
        //   1. `timeout /T` refuses to run with redirected stdin (always the case
        //      here) and exits instantly, which would pass this test for the wrong
        //      reason. `ping` genuinely blocks.
        //   2. `kill_on_drop` kills only the direct child. Wrapping in `cmd /C`
        //      means we kill cmd and orphan the real process — which is precisely
        //      the failure mode this test exists to catch, so it must not be
        //      masked by the stub.
        (
            "ping",
            vec!["-n".into(), (secs + 1).to_string(), "127.0.0.1".into()],
        )
    }
    #[cfg(not(windows))]
    fn sleep_stub(secs: u32) -> (&'static str, Vec<String>) {
        ("sh", vec!["-c".into(), format!("sleep {secs}")])
    }
}
