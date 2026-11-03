package dev.remined.companion;

import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Optional;

/** Iris and Distant Horizons through reflection, so the mod needs neither on the classpath. */
final class PerfLive {
    private static final String IRIS = "net.irisshaders.iris.";
    private static final String DH = "com.seibel.distanthorizons.api.";

    private PerfLive() {
    }

    private static Class<?> cls(String name) throws ClassNotFoundException {
        return Class.forName(name, false, PerfLive.class.getClassLoader());
    }

    private static Object irisConfig() throws Exception {
        Object api = cls(IRIS + "api.v0.IrisApi").getMethod("getInstance").invoke(null);
        return cls(IRIS + "api.v0.IrisApi").getMethod("getConfig").invoke(api);
    }

    /** Whether Iris shaders are enabled, or null when Iris is not installed or not usable. */
    static Boolean shadersEnabled() {
        try {
            Object cfg = irisConfig();
            if (cfg == null) return null;
            return (Boolean) cls(IRIS + "api.v0.IrisApiConfig").getMethod("areShadersEnabled").invoke(cfg);
        } catch (Throwable e) {
            return null;
        }
    }

    /** Turns shaders on or off. Turning on selects pack when no usable shader pack is set. */
    static void setShaders(boolean on, String pack, Path shaderpacks) throws Exception {
        if (on && pack != null) {
            Class<?> iris = cls(IRIS + "Iris");
            Object config = iris.getMethod("getIrisConfig").invoke(null);
            Class<?> cfgCls = cls(IRIS + "config.IrisConfig");
            Optional<?> name = (Optional<?>) cfgCls.getMethod("getShaderPackName").invoke(config);
            String current = name.isPresent() ? String.valueOf(name.get()) : "";
            boolean usable = !current.isEmpty() && ("(internal)".equals(current)
                || Files.exists(shaderpacks.resolve(current)));
            if (!usable) {
                if (!Files.exists(shaderpacks.resolve(pack))) throw new IllegalStateException("shader pack missing: " + pack);
                cfgCls.getMethod("setShaderPackName", String.class).invoke(config, pack);
                cfgCls.getMethod("save").invoke(config);
            }
        }
        Object cfg = irisConfig();
        cls(IRIS + "api.v0.IrisApiConfig").getMethod("setShadersEnabledAndApply", boolean.class).invoke(cfg, on);
    }

    private static Object dhValue(String name) throws Exception {
        Object configs = cls(DH + "DhApi$Delayed").getField("configs").get(null);
        if (configs == null) return null;
        Object graphics = cls(DH + "interfaces.config.IDhApiConfig").getMethod("graphics").invoke(configs);
        return cls(DH + "interfaces.config.client.IDhApiGraphicsConfig").getMethod(name).invoke(graphics);
    }

    /** Distant Horizons graphics value ("renderingEnabled" or "chunkRenderDistance"), or null when unavailable. */
    static Object dhGet(String name) {
        try {
            Object v = dhValue(name);
            if (v == null) return null;
            Method get = cls(DH + "interfaces.config.IDhApiConfigValue").getMethod("getValue");
            return PerfProfile.norm(get.invoke(v));
        } catch (Throwable e) {
            return null;
        }
    }

    static void dhSet(String name, Object value) throws Exception {
        Object v = dhValue(name);
        if (v == null) throw new IllegalStateException("Distant Horizons is not ready");
        Object arg = value instanceof Number ? (Object) Integer.valueOf(((Number) value).intValue()) : value;
        Method set = cls(DH + "interfaces.config.IDhApiConfigValue").getMethod("setValue", Object.class);
        set.invoke(v, arg);
    }
}
