use std::path::Path;

fn main() {
    let jar = Path::new("resources/remined-companion.jar");
    if !jar.exists() {
        panic!("missing resources/remined-companion.jar: run `npm run mod:build` (needs JDK 25) to build the Remined Companion mod");
    }
    println!("cargo:rerun-if-changed=resources/remined-companion.jar");
    tauri_build::build();
}
