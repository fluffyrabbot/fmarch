use std::{
    fmt,
    io::{self, Read},
    process::{Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

const POLL_INTERVAL: Duration = Duration::from_millis(20);
const READER_SHUTDOWN_GRACE: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProcessLimits {
    pub timeout: Duration,
    pub max_stdout_bytes: usize,
    pub max_stderr_bytes: usize,
}

impl ProcessLimits {
    pub const fn new(timeout: Duration, max_stdout_bytes: usize, max_stderr_bytes: usize) -> Self {
        Self {
            timeout,
            max_stdout_bytes,
            max_stderr_bytes,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedBytes {
    pub bytes: Vec<u8>,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct BoundedProcessOutput {
    pub status: ExitStatus,
    pub stdout: CapturedBytes,
    pub stderr: CapturedBytes,
    pub elapsed: Duration,
}

#[derive(Debug)]
pub enum BoundedProcessError {
    Io(io::Error),
    TimedOut {
        command: String,
        timeout: Duration,
        stdout: CapturedBytes,
        stderr: CapturedBytes,
    },
}

impl fmt::Display for BoundedProcessError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "bounded child process failed: {error}"),
            Self::TimedOut {
                command,
                timeout,
                stdout,
                stderr,
            } => write!(
                formatter,
                "bounded child process timed out after {:.3}s: {command}\nstdout{}:\n{}\nstderr{}:\n{}",
                timeout.as_secs_f64(),
                truncation_label(stdout),
                String::from_utf8_lossy(&stdout.bytes),
                truncation_label(stderr),
                String::from_utf8_lossy(&stderr.bytes),
            ),
        }
    }
}

impl std::error::Error for BoundedProcessError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::TimedOut { .. } => None,
        }
    }
}

impl From<io::Error> for BoundedProcessError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

pub fn run_bounded_process(
    command: &mut Command,
    limits: ProcessLimits,
) -> Result<BoundedProcessOutput, BoundedProcessError> {
    let command_label = format!("{command:?}");
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);

    let started = Instant::now();
    let mut child = command.spawn()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| io::Error::other("bounded child stdout was not piped"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| io::Error::other("bounded child stderr was not piped"))?;
    let stdout_reader = thread::spawn(move || read_capped(stdout, limits.max_stdout_bytes));
    let stderr_reader = thread::spawn(move || read_capped(stderr, limits.max_stderr_bytes));

    let mut status = None;
    let timed_out = loop {
        if status.is_none() {
            status = child.try_wait()?;
        }
        if status.is_some() && stdout_reader.is_finished() && stderr_reader.is_finished() {
            break false;
        }
        if started.elapsed() >= limits.timeout {
            terminate_process_group(&mut child)?;
            if status.is_none() {
                status = Some(child.wait()?);
            }
            break true;
        }
        thread::sleep(POLL_INTERVAL);
    };

    if timed_out {
        wait_for_readers(&stdout_reader, &stderr_reader);
    }
    let stdout = collect_capture(stdout_reader, "stdout", timed_out)?;
    let stderr = collect_capture(stderr_reader, "stderr", timed_out)?;
    if timed_out {
        return Err(BoundedProcessError::TimedOut {
            command: command_label,
            timeout: limits.timeout,
            stdout,
            stderr,
        });
    }

    Ok(BoundedProcessOutput {
        status: status.expect("bounded child status is available after stream closure"),
        stdout,
        stderr,
        elapsed: started.elapsed(),
    })
}

fn wait_for_readers(
    stdout_reader: &thread::JoinHandle<io::Result<CapturedBytes>>,
    stderr_reader: &thread::JoinHandle<io::Result<CapturedBytes>>,
) {
    let deadline = Instant::now() + READER_SHUTDOWN_GRACE;
    while !(stdout_reader.is_finished() && stderr_reader.is_finished()) && Instant::now() < deadline
    {
        thread::sleep(POLL_INTERVAL);
    }
}

fn read_capped(mut reader: impl Read, max_bytes: usize) -> io::Result<CapturedBytes> {
    let mut bytes = Vec::with_capacity(max_bytes.min(64 * 1024));
    let mut truncated = false;
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        let remaining = max_bytes.saturating_sub(bytes.len());
        let retained = remaining.min(read);
        bytes.extend_from_slice(&chunk[..retained]);
        truncated |= retained < read;
    }
    Ok(CapturedBytes { bytes, truncated })
}

fn collect_capture(
    reader: thread::JoinHandle<io::Result<CapturedBytes>>,
    stream: &str,
    timed_out: bool,
) -> Result<CapturedBytes, BoundedProcessError> {
    if !reader.is_finished() {
        debug_assert!(timed_out);
        return Ok(CapturedBytes {
            bytes: format!("<{stream} pipe remained open after process-group termination>")
                .into_bytes(),
            truncated: true,
        });
    }
    reader
        .join()
        .map_err(|_| io::Error::other(format!("bounded child {stream} reader panicked")))?
        .map_err(BoundedProcessError::Io)
}

#[cfg(unix)]
fn terminate_process_group(child: &mut std::process::Child) -> io::Result<()> {
    let process_group = -(child.id() as libc::pid_t);
    // The child is placed in a fresh process group immediately before spawn, so
    // this negative pid targets only that child and its descendants.
    let result = unsafe { libc::kill(process_group, libc::SIGKILL) };
    if result == 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    if error.raw_os_error() == Some(libc::ESRCH) {
        return Ok(());
    }
    child.kill().or(Err(error))
}

#[cfg(not(unix))]
fn terminate_process_group(child: &mut std::process::Child) -> io::Result<()> {
    child.kill()
}

fn truncation_label(capture: &CapturedBytes) -> &'static str {
    if capture.truncated {
        " (truncated)"
    } else {
        ""
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn bounded_process_caps_output_without_stopping_pipe_drain() {
        let output = run_bounded_process(
            Command::new("sh").args([
                "-c",
                "i=0; while [ $i -lt 4096 ]; do printf x; i=$((i + 1)); done; printf err >&2",
            ]),
            ProcessLimits::new(Duration::from_secs(2), 128, 128),
        )
        .expect("bounded process completes");

        assert!(output.status.success());
        assert_eq!(output.stdout.bytes.len(), 128);
        assert!(output.stdout.truncated);
        assert_eq!(output.stderr.bytes, b"err");
        assert!(!output.stderr.truncated);
    }

    #[test]
    fn bounded_process_times_out_and_kills_child_process_group() {
        let started = Instant::now();
        let error = run_bounded_process(
            Command::new("sh").args(["-c", "sleep 30 & wait"]),
            ProcessLimits::new(Duration::from_millis(100), 128, 128),
        )
        .expect_err("bounded process should time out");

        assert!(matches!(error, BoundedProcessError::TimedOut { .. }));
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn bounded_process_times_out_when_descendant_keeps_pipe_open_after_parent_exit() {
        let started = Instant::now();
        let error = run_bounded_process(
            Command::new("sh").args(["-c", "sleep 30 & exit 0"]),
            ProcessLimits::new(Duration::from_millis(100), 128, 128),
        )
        .expect_err("inherited descendant pipe should remain bounded");

        assert!(matches!(error, BoundedProcessError::TimedOut { .. }));
        assert!(started.elapsed() < Duration::from_secs(2));
    }
}
