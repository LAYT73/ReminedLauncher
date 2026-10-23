package dev.remined.companion;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.DoubleConsumer;
import java.util.function.IntConsumer;

/**
 * Remined settings screen. A dark panel on the left holds the options; the HUD preview covers the whole
 * screen and can be dragged (it snaps to the margins and the center). Changes apply live and are saved
 * when the screen closes.
 */
final class Settings implements Surface {
    private static final int PANEL_W = 214;
    private static final int TOP = 8;
    private static final int FOOTER_H = 80;
    private static final int ROW_H = 16;
    private static final int TRACK = 0xFF2B2B2B;
    private static final int ON = 0xFF2E7D32;
    private static final int ON_HOVER = 0xFF3D9A40;
    private static final int HOVER = 0xFF3A3A3A;
    private static final int TEXT = 0xFFE6E6E6;
    private static final int DIM = 0xFF9A9A9A;
    private static final int HEAD_TEXT = 0xFF8CFF8C;

    private interface Action {
        void run();
    }

    /** One clickable control, rebuilt every frame so it always reflects the current config. */
    private static final class Ctl {
        static final int TOGGLE = 0;
        static final int SEG = 1;
        static final int SLIDER = 2;
        static final int BUTTON = 3;

        final int kind;
        final int x;
        final int y;
        final int w;
        final int h;
        final boolean scrolls;
        String label;
        String[] opts;
        int sel;
        boolean on;
        double value;
        double min;
        double max;
        Action onClick;
        IntConsumer onSeg;
        DoubleConsumer onSlide;

        Ctl(int kind, int x, int y, int w, int h, boolean scrolls) {
            this.kind = kind;
            this.x = x;
            this.y = y;
            this.w = w;
            this.h = h;
            this.scrolls = scrolls;
        }
    }

    private final Hub hub;
    private final List<Ctl> ctls = new ArrayList<>();
    private int scroll;
    private int maxScroll;
    private int panelX;
    private int panelY;
    private int panelW;
    private int panelH;
    private int clipTop;
    private int clipBottom;
    private int screenW;
    private int screenH;
    private int mouseX;
    private int mouseY;
    private int[] hudBox;
    private Ctl dragging;
    private boolean dragHud;
    private int grabX;
    private int grabY;
    private int guideX = -1;
    private int guideY = -1;

    Settings(Hub hub) {
        this.hub = hub;
    }

    @Override
    public void render(Gfx g, int mx, int my, float partial) {
        mouseX = mx;
        mouseY = my;
        screenW = g.width();
        screenH = g.height();
        ctls.clear();
        Config cfg = hub.cfg();

        g.fill(0, 0, screenW, screenH, 0x66000000);
        panelW = Math.min(PANEL_W, screenW - 16);
        panelX = 8;
        panelY = TOP;
        panelH = screenH - 16;
        drawPanel(g, panelX, panelY, panelW, panelH);
        g.text(tr("remined.settings.title"), panelX + 10, panelY + 7, 0xFFFFFFFF, true);
        g.fill(panelX + 1, panelY + 19, panelX + panelW - 1, panelY + 20, 0xFF3A3A3A);

        int cx = panelX + 10;
        int cw = panelW - 20;
        int top = panelY + 24;
        int footerTop = panelY + panelH - FOOTER_H;
        clipTop = top;
        clipBottom = footerTop;
        g.scissor(panelX + 1, top, panelX + panelW - 1, footerTop);
        int y = top - scroll;
        y = section(g, cx, y, cw, tr("remined.section.hud"));
        y = toggle(g, cx, y, cw, tr("remined.hud.enabled"), cfg.hudEnabled, () -> cfg.hudEnabled = !cfg.hudEnabled);
        y = seg(g, cx, y, cw, tr("remined.hud.layout"),
            new String[] {tr("remined.layout.column"), tr("remined.layout.row")}, cfg.hudRow ? 1 : 0,
            i -> cfg.hudRow = i == 1);
        y = seg(g, cx, y, cw, tr("remined.hud.names"),
            new String[] {tr("remined.names.always"), tr("remined.names.speaking"), tr("remined.names.never")},
            cfg.names, i -> cfg.names = i);
        y = toggle(g, cx, y, cw, tr("remined.hud.only_speaking"), cfg.onlySpeaking, () -> cfg.onlySpeaking = !cfg.onlySpeaking);
        y = toggle(g, cx, y, cw, tr("remined.hud.hide_in_menus"), cfg.hideInMenus, () -> cfg.hideInMenus = !cfg.hideInMenus);
        y = slider(g, cx, y, cw, tr("remined.hud.scale"), String.format(Locale.ROOT, "%.2fx", cfg.scale), cfg.scale, 0.5, 2.0,
            v -> cfg.scale = Math.round(v * 20) / 20.0);
        y = slider(g, cx, y, cw, tr("remined.hud.opacity"), cfg.opacity + "%", cfg.opacity, 0, 100,
            v -> cfg.opacity = (int) Math.round(v));
        y += 6;
        y = section(g, cx, y, cw, tr("remined.section.notices"));
        y = toggle(g, cx, y, cw, tr("remined.notice.enabled"), cfg.noticesEnabled, () -> cfg.noticesEnabled = !cfg.noticesEnabled);
        y = seg(g, cx, y, cw, tr("remined.notice.corner"),
            new String[] {tr("remined.corner.tl"), tr("remined.corner.tr"), tr("remined.corner.bl"), tr("remined.corner.br")},
            cfg.noticeCorner, i -> cfg.noticeCorner = i);
        y = slider(g, cx, y, cw, tr("remined.notice.seconds"), cfg.noticeSeconds + " s", cfg.noticeSeconds, 3, 10,
            v -> cfg.noticeSeconds = (int) Math.round(v));
        button(g, cx, y, cw, tr("remined.notice.test"), () -> hub.info("remined.notice.test_body"), true);
        y += 16 + 6;
        int contentH = y + scroll - top;
        maxScroll = Math.max(0, contentH - (footerTop - top));
        if (scroll > maxScroll) scroll = maxScroll;
        g.unscissor();

        drawFooter(g, cx, footerTop, cw);
        hudBox = hub.hud.render(g, true);
        if (dragHud && guideX >= 0) g.fill(guideX, 0, guideX + 1, screenH, 0xCC55FF55);
        if (dragHud && guideY >= 0) g.fill(0, guideY, screenW, guideY + 1, 0xCC55FF55);
        if (hudBox != null) {
            String hint = tr("remined.preview.hint");
            int tw = g.textWidth(hint);
            int tx = Anchor.right(cfg.hudCorner) ? hudBox[0] + hudBox[2] - tw : hudBox[0];
            tx = Math.max(2, Math.min(tx, screenW - tw - 2));
            int ty = hudBox[1] - 11;
            if (ty < 2) ty = hudBox[1] + hudBox[3] + 2;
            g.text(hint, tx, ty, DIM, true);
        }
        hub.notices.render(g, hub, cfg.noticeCorner);
    }

    private void drawFooter(Gfx g, int cx, int footerTop, int cw) {
        int half = (cw - 4) / 2;
        int y1 = footerTop + 6;
        int y2 = y1 + 20;
        button(g, cx, y1, half, tr("remined.btn.mic") + ": " + stateText(hub.voice().active, hub.voice().selfMuted),
            () -> hub.sendAction("mute"));
        button(g, cx + half + 4, y1, half, tr("remined.btn.deafen") + ": "
            + stateText(hub.voice().active, hub.voice().selfDeafened), () -> hub.sendAction("deafen"));
        button(g, cx, y2, half, tr("remined.btn.reset"), () -> hub.resetConfig());
        button(g, cx + half + 4, y2, half, tr("remined.btn.done"), this::close);
        String hint = String.format(tr("remined.hint"), hub.keyName("menu"), hub.keyName("mute"), hub.keyName("join"));
        int ty = y2 + 24;
        for (String line : Notices.wrap(g, hint, cw, 2)) {
            g.text(line, cx, ty, DIM, false);
            ty += 9;
        }
    }

    private String stateText(boolean active, boolean flag) {
        if (!active) return tr("remined.state.none");
        return flag ? tr("remined.state.off") : tr("remined.state.on");
    }

    private void drawPanel(Gfx g, int x, int y, int w, int h) {
        g.fill(x, y, x + w, y + h, 0xE6101010);
        g.fill(x, y, x + w, y + 1, 0xFF4A4A4A);
        g.fill(x, y, x + 1, y + h, 0xFF4A4A4A);
        g.fill(x, y + h - 1, x + w, y + h, 0xFF000000);
        g.fill(x + w - 1, y, x + w, y + h, 0xFF000000);
    }

    private int section(Gfx g, int x, int y, int w, String title) {
        g.text(title, x, y, HEAD_TEXT, false);
        g.fill(x, y + 11, x + w, y + 12, 0xFF3A3A3A);
        return y + 17;
    }

    private int toggle(Gfx g, int x, int y, int w, String label, boolean on, Action act) {
        Ctl c = add(Ctl.TOGGLE, x, y, w, ROW_H, true);
        c.label = label;
        c.on = on;
        c.onClick = act;
        boolean hover = hovered(c);
        g.text(label, x, y + 4, hover ? 0xFFFFFFFF : TEXT, false);
        int tx = x + w - 24;
        g.fill(tx, y + 3, tx + 24, y + 13, on ? (hover ? ON_HOVER : ON) : TRACK);
        int kx = on ? tx + 13 : tx + 1;
        g.fill(kx, y + 4, kx + 10, y + 12, 0xFFEEEEEE);
        return y + ROW_H + 2;
    }

    private int seg(Gfx g, int x, int y, int w, String label, String[] opts, int sel, IntConsumer set) {
        g.text(label, x, y, DIM, false);
        Ctl c = add(Ctl.SEG, x, y + 11, w, 14, true);
        c.opts = opts;
        c.sel = sel;
        c.onSeg = set;
        int n = opts.length;
        int cell = (w - (n - 1) * 2) / n;
        for (int i = 0; i < n; i++) {
            int cx = x + i * (cell + 2);
            boolean hover = hovered(c) && mouseX >= cx && mouseX < cx + cell;
            int bg = i == sel ? (hover ? ON_HOVER : ON) : (hover ? HOVER : TRACK);
            g.fill(cx, y + 11, cx + cell, y + 25, bg);
            int tw = g.textWidth(opts[i]);
            g.text(opts[i], cx + (cell - tw) / 2, y + 14, i == sel ? 0xFFFFFFFF : DIM, false);
        }
        return y + 11 + 14 + 6;
    }

    private int slider(Gfx g, int x, int y, int w, String label, String value, double v, double min, double max,
                       DoubleConsumer set) {
        g.text(label, x, y, DIM, false);
        g.text(value, x + w - g.textWidth(value), y, TEXT, false);
        Ctl c = add(Ctl.SLIDER, x, y + 11, w, 10, true);
        c.value = v;
        c.min = min;
        c.max = max;
        c.onSlide = set;
        double f = (v - min) / (max - min);
        g.fill(x, y + 15, x + w, y + 17, TRACK);
        g.fill(x, y + 15, x + (int) Math.round(w * f), y + 17, hovered(c) ? ON_HOVER : ON);
        int kx = x + (int) Math.round(w * f) - 2;
        g.fill(kx, y + 12, kx + 4, y + 20, 0xFFEEEEEE);
        return y + 11 + 10 + 6;
    }

    private void button(Gfx g, int x, int y, int w, String label, Action act) {
        button(g, x, y, w, label, act, false);
    }

    private void button(Gfx g, int x, int y, int w, String label, Action act, boolean scrolls) {
        Ctl c = add(Ctl.BUTTON, x, y, w, 16, scrolls);
        c.label = label;
        c.onClick = act;
        boolean hover = hovered(c);
        g.fill(x, y, x + w, y + 16, 0xFF000000);
        g.fill(x + 1, y + 1, x + w - 1, y + 15, hover ? 0xFF484848 : 0xFF2A2A2A);
        int tw = g.textWidth(label);
        g.text(label, x + (w - tw) / 2, y + 4, hover ? 0xFFFFFFFF : TEXT, false);
    }

    private Ctl add(int kind, int x, int y, int w, int h, boolean scrolls) {
        Ctl c = new Ctl(kind, x, y, w, h, scrolls);
        ctls.add(c);
        return c;
    }

    private boolean hovered(Ctl c) {
        return inside(c.x, c.y, c.w, c.h, mouseX, mouseY) && (!c.scrolls || (mouseY >= clipTop && mouseY < clipBottom));
    }

    private boolean hit(Ctl c, double x, double y) {
        if (c.scrolls && (y < clipTop || y >= clipBottom)) return false;
        return x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
    }

    private static boolean inside(int x, int y, int w, int h, int px, int py) {
        return px >= x && px < x + w && py >= y && py < y + h;
    }

    @Override
    public boolean mouseDown(double x, double y, int button) {
        if (button != hub.platform().mouseLeft()) return false;
        for (int i = ctls.size() - 1; i >= 0; i--) {
            Ctl c = ctls.get(i);
            if (!hit(c, x, y)) continue;
            switch (c.kind) {
                case Ctl.SEG: {
                    int idx = (int) ((x - c.x) * c.opts.length / c.w);
                    c.onSeg.accept(Math.max(0, Math.min(c.opts.length - 1, idx)));
                    break;
                }
                case Ctl.SLIDER:
                    dragging = c;
                    slide(c, x);
                    break;
                default:
                    c.onClick.run();
                    break;
            }
            return true;
        }
        if (hudBox != null && inside(hudBox[0], hudBox[1], hudBox[2], hudBox[3], (int) x, (int) y)) {
            dragHud = true;
            grabX = (int) x - hudBox[0];
            grabY = (int) y - hudBox[1];
            return true;
        }
        return false;
    }

    private void slide(Ctl c, double x) {
        double f = Math.max(0, Math.min(1, (x - c.x) / c.w));
        c.onSlide.accept(c.min + f * (c.max - c.min));
    }

    @Override
    public void mouseDrag(double x, double y, int button) {
        if (dragging != null) {
            slide(dragging, x);
            return;
        }
        if (!dragHud || hudBox == null) return;
        int w = hudBox[2];
        int h = hudBox[3];
        Anchor.Snap s = Anchor.snap((int) x - grabX, (int) y - grabY, w, h, screenW, screenH);
        guideX = s.guideX;
        guideY = s.guideY;
        int[] p = Anchor.fromPosition(s.x, s.y, w, h, screenW, screenH);
        Config cfg = hub.cfg();
        cfg.hudCorner = p[0];
        cfg.hudDx = p[1];
        cfg.hudDy = p[2];
    }

    @Override
    public void mouseUp(double x, double y, int button) {
        dragging = null;
        dragHud = false;
        guideX = -1;
        guideY = -1;
    }

    @Override
    public boolean scroll(double x, double y, double delta) {
        if (!inside(panelX, panelY, panelW, panelH, (int) x, (int) y)) return false;
        scroll = (int) Math.max(0, Math.min(maxScroll, scroll - delta * 12));
        return true;
    }

    @Override
    public boolean key(int keyCode) {
        if (keyCode == hub.platform().keyCode("ESCAPE")) {
            close();
            return true;
        }
        return false;
    }

    @Override
    public void closed() {
        hub.settingsClosed();
    }

    private void close() {
        hub.closeSettings();
    }

    private String tr(String key) {
        return hub.translate(key);
    }
}
