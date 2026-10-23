package dev.remined.companion;

/**
 * Version services implemented by the mc1201 and mc26 backends. Core never imports Minecraft.
 * Everything runs on the client thread.
 */
public interface Platform {
    /** HUD hook, called every frame with a Gfx bound to that frame. */
    interface Hud {
        void render(Gfx g);
    }

    /** Registers a keybinding in the Remined category. defaultKey is a key name (e.g. "V") or null. */
    void registerKey(String id, String translationKey, String defaultKey);

    /** Consumes one click of the binding. Returns false when there is none. */
    boolean consumeClick(String id);

    /** Display name of the key bound to id (e.g. "J"), or an empty string. */
    String keyName(String id);

    /** Code of InputConstants.KEY_name (e.g. "ESCAPE"), or Integer.MIN_VALUE when unknown. */
    int keyCode(String name);

    /** Value of InputConstants.MOUSE_BUTTON_LEFT. */
    int mouseLeft();

    void onTick(Runnable tick);

    void onHud(Hud hud);

    boolean hudHidden();

    boolean screenOpen();

    /** Shows the surface on a Remined screen. */
    void openSettings(Surface surface);

    /** Closes the Remined screen if it is showing. */
    void closeSettings();

    /** Uploads an 8x8 ARGB head under key, replacing any previous texture. */
    void uploadHead(String key, int[] argb);

    void releaseHead(String key);

    /** Translates a lang key. */
    String translate(String key);
}
