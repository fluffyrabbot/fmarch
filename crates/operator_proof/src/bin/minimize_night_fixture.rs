#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    operator_proof::minimizer::run_cli(std::env::args().skip(1)).await
}
