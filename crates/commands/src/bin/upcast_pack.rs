use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<(), String> {
    let mut check_only = false;
    let mut path = None;
    for arg in env::args().skip(1) {
        if arg == "--check" {
            check_only = true;
        } else if path.replace(arg).is_some() {
            return Err("usage: upcast_pack [--check] <pack.json>".to_string());
        }
    }
    let path = path.ok_or_else(|| "usage: upcast_pack [--check] <pack.json>".to_string())?;
    let raw = fs::read_to_string(&path).map_err(|err| format!("read {path}: {err}"))?;
    let value: serde_json::Value =
        serde_json::from_str(&raw).map_err(|err| format!("parse {path}: {err}"))?;
    let upcasted =
        domain::upcast_pack_json(value).map_err(|err| format!("upcast {path}: {err}"))?;
    let upcasted_raw =
        serde_json::to_string(&upcasted).map_err(|err| format!("encode {path}: {err}"))?;
    let pack = domain::load_pack_from_json(&upcasted_raw)
        .map_err(|err| format!("load upcasted {path}: {err}"))?;

    if check_only {
        println!(
            "ok: {} pack_version={} ir_version={}",
            pack.name, pack.version, pack.ir_version
        );
        return Ok(());
    }

    let pretty =
        serde_json::to_string_pretty(&upcasted).map_err(|err| format!("encode {path}: {err}"))?;
    println!("{pretty}");
    Ok(())
}
