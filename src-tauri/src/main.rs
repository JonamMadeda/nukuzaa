// Tauri v2 binary entry point.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nukuzaa_lib::run()
}
