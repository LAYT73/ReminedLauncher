package dev.remined.companion;

import java.nio.file.Path;

/**
 * Client-side controller for the in-game UI: keybindings, voice HUD, notification cards and the settings
 * screen. Every method runs on the client thread (Bridge hands work over with Reflect.execute).
 */
final class Hub {
    /** Writes one JSON line to the launcher. */
    interface Sender {
        void send(String json);
    }

    private final Platform platform;
    private final Path file;
    private final Companion log;
    final Heads heads;
    final VoiceHud hud;
    final Notices notices = new Notices();
    private Config cfg = new Config();
    private Protocol.Voice voice = Protocol.Voice.off();
    private final BatteryHud battery = new BatteryHud();
    private volatile Protocol.Battery batteryState;
    private Sender sender;
    private boolean settingsOpen;
    private String inviteId;
    private long inviteUntilMs;

    Hub(Platform platform, Path file, Companion log) {
        this.platform = platform;
        this.file = file;
        this.log = log;
        this.heads = new Heads(platform);
        this.hud = new VoiceHud(this);
    }

    /** Registers keys, the HUD and the tick hook. Call once during client init. */
    void init() {
        platform.registerKey("menu", "key.remined.menu", "V");
        platform.registerKey("mute", "key.remined.mute", "M");
        platform.registerKey("deafen", "key.remined.deafen", null);
        platform.registerKey("join", "key.remined.join", "J");
        if (net.fabricmc.loader.api.FabricLoader.getInstance().isModLoaded("echo_compass_hud")) {
            HudToggle.COMPASS.init(file.getParent());
            platform.registerKey("compass", "key.remined.compass", null);
        }
        if (java.nio.file.Files.exists(file.resolveSibling("remined-crosshair-hints"))) {
            HudToggle.HINTS.init(file.getParent());
            platform.registerKey("hints", "key.remined.hints", null);
        }
        cfg = Config.load(file);
        platform.onTick(this::tick);
        platform.onHud(this::renderHud);
        try {
            platform.onContainerScreen(this::renderBattery);
        } catch (Throwable e) {
            log.log("battery hook unavailable", e);
        }
    }

    void setSender(Sender sender) {
        this.sender = sender;
    }

    Platform platform() {
        return platform;
    }

    Config cfg() {
        return cfg;
    }

    Protocol.Voice voice() {
        return voice;
    }

    String keyName(String id) {
        try {
            return platform.keyName(id);
        } catch (Throwable e) {
            return "?";
        }
    }

    String translate(String key) {
        try {
            return platform.translate(key);
        } catch (Throwable e) {
            return key;
        }
    }

    void resetConfig() {
        cfg = new Config();
    }

    void onVoice(Protocol.Voice v) {
        voice = v;
    }

    /** Drops an armed join invite (the launcher went away). */
    void clearInvite() {
        inviteId = null;
    }

    /** Latest laptop battery state from the launcher; null clears it (the launcher went away). */
    void onBattery(Protocol.Battery b) {
        batteryState = b;
    }

    void onHead(String id, int[] argb) {
        heads.put(id, argb);
    }

    void onNotify(Protocol.Notice n) {
        if (!cfg.noticesEnabled) return;
        boolean info = "info".equals(n.kind);
        String headKey = info ? null : heads.keyFor(n.head);
        boolean joinable = "join".equals(n.actionType) && n.actionId != null && !n.actionId.isEmpty();
        long life = cfg.noticeSeconds * 1000L;
        if (joinable) {
            inviteId = n.actionId;
            inviteUntilMs = System.currentTimeMillis() + n.ttl;
            life = n.ttl;
        }
        notices.add(n.kind, n.title, n.body, headKey, life, joinable);
    }

    /** Shows a short info card (default title). */
    void info(String key) {
        notices.add("info", translate("remined.notice.default_title"), translate(key), null,
            cfg.noticeSeconds * 1000L, false);
    }

    /** Sends a mute or deafen toggle when in a voice room, otherwise shows an info card. */
    void sendAction(String action) {
        if (!voice.active) {
            info("remined.notice.no_voice");
            return;
        }
        Sender s = sender;
        if (s != null) s.send("{\"t\":\"key\",\"action\":\"" + action + "\"}");
    }

    void toggleSettings() {
        if (settingsOpen) {
            closeSettings();
        } else {
            settingsOpen = true;
            platform.openSettings(new Settings(this));
        }
    }

    /** Saves the config and closes the settings screen. Idempotent. */
    void closeSettings() {
        settingsClosed();
        platform.closeSettings();
    }

    void settingsClosed() {
        if (!settingsOpen) return;
        settingsOpen = false;
        try {
            cfg.save(file);
        } catch (Throwable e) {
            log.log("config save failed", e);
        }
    }

    private void tick() {
        try {
            heads.ensureDefault();
            for (int i = 0; i < 8 && platform.consumeClick("menu"); i++) toggleSettings();
            for (int i = 0; i < 8 && platform.consumeClick("mute"); i++) sendAction("mute");
            for (int i = 0; i < 8 && platform.consumeClick("deafen"); i++) sendAction("deafen");
            for (int i = 0; i < 8 && platform.consumeClick("join"); i++) sendJoin();
            for (int i = 0; i < 8 && platform.consumeClick("compass"); i++) HudToggle.COMPASS.toggle();
            for (int i = 0; i < 8 && platform.consumeClick("hints"); i++) HudToggle.HINTS.toggle();
        } catch (Throwable e) {
            log.log("tick failed", e);
        }
    }

    /** Joins the armed invite once. Silent when nothing is armed. */
    private void sendJoin() {
        if (inviteId == null || System.currentTimeMillis() >= inviteUntilMs) {
            inviteId = null;
            return;
        }
        String id = inviteId;
        inviteId = null;
        Sender s = sender;
        if (s != null) s.send("{\"t\":\"key\",\"action\":\"join\",\"id\":" + Snapshot.str(id) + "}");
    }

    private void renderHud(Gfx g) {
        try {
            if (platform.hudHidden() || settingsOpen) return;
            boolean screen = platform.screenOpen();
            if (cfg.hudEnabled && !(screen && cfg.hideInMenus) && !voice.members.isEmpty() && voice.active) {
                hud.render(g, false);
            }
            notices.render(g, this, cfg.noticeCorner);
        } catch (Throwable e) {
            log.log("hud failed", e);
        }
    }

    private void renderBattery(Gfx g) {
        try {
            Protocol.Battery b = batteryState;
            if (b != null && b.present) battery.render(g, b);
        } catch (Throwable e) {
            log.log("battery hud failed", e);
        }
    }
}
