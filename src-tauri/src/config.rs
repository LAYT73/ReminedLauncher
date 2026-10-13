use serde::Deserialize;
use std::sync::OnceLock;

#[derive(Debug, Clone, Deserialize)]
pub struct ReminedConfig {
    pub packs_catalog_url: String,
    pub packs_release_base: String,
}

fn default_config() -> ReminedConfig {
    ReminedConfig {
        packs_catalog_url: "https://github.com/LAYT73/ReminedPacks/releases/latest/download/catalog.json"
            .into(),
        packs_release_base: "https://github.com/LAYT73/ReminedPacks/releases/latest/download"
            .into(),
    }
}

pub fn remined_config() -> &'static ReminedConfig {
    static CFG: OnceLock<ReminedConfig> = OnceLock::new();
    CFG.get_or_init(|| {
        let embedded = include_str!("../remined.config.json");
        serde_json::from_str(embedded).unwrap_or_else(|_| default_config())
    })
}
