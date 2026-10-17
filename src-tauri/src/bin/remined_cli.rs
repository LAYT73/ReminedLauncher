//! `cargo run --bin remined-cli -- second-client`

#[tokio::main]
async fn main() -> std::process::ExitCode {
    app_lib::cli::run_async().await
}
