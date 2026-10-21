//! Windows console-subsystem helpers.
//!
//! `java.exe`, Relay, Porthole, and LiveKit are console apps. Spawning them from a
//! GUI Remined process without `CREATE_NO_WINDOW` opens a black terminal; closing
//! that window kills the child (and Minecraft with it). macOS/Linux are unaffected.

use std::process::Command;

/// Hide the console window for console-subsystem children on Windows.
/// Keeps stdout/stderr pipes working (unlike `DETACHED_PROCESS`).
pub fn hide_console(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
